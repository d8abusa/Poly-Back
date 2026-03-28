"""
Crypto scanner — background loop that watches intraday price action on
Coinbase assets and emits signals when strategy thresholds are crossed.

Runs every CRYPTO_SCAN_INTERVAL seconds (default 900 = 15 min).
Uses 1h candles with a rolling zscore_window to detect abnormal moves.

Watched assets are configured via CRYPTO_WATCH env var (comma-separated):
    CRYPTO_WATCH=BTC-USD,ETH-USD,SOL-USD

Signal logic:
  - BUY  signal when 1h log-return z-score < -CRYPTO_ENTRY_Z  (buy the dip)
  - SELL signal when holding and z-score >  CRYPTO_EXIT_Z     (mean reversion)

One pending signal per asset at a time — won't spam duplicates.
"""

import asyncio
import logging
import math
import os
from datetime import datetime, timezone
from typing import Optional

from ..models.schemas import SignalSchema, ExecutionMode
from .exchange_router import get_exchange_client
from . import signal_queue as sq
from . import alert_service as alerts
from . import position_tracker as pt

log = logging.getLogger(__name__)

SCAN_INTERVAL   = int(os.getenv("CRYPTO_SCAN_INTERVAL", "900"))   # 15 min
WATCH_DEFAULT   = "BTC-USD,ETH-USD,SOL-USD"
ZSCORE_WINDOW   = int(os.getenv("CRYPTO_ZSCORE_WINDOW", "20"))
ENTRY_Z         = float(os.getenv("CRYPTO_ENTRY_Z", "1.5"))
EXIT_Z          = float(os.getenv("CRYPTO_EXIT_Z",  "0.5"))
TARGET_PCT      = float(os.getenv("CRYPTO_TARGET_PCT", "0.03"))   # 3% profit target
STOP_PCT        = float(os.getenv("CRYPTO_STOP_PCT",   "0.02"))   # 2% stop loss
POSITION_USD    = float(os.getenv("CRYPTO_POSITION_USD", "25.0")) # $ per signal

# In-memory state
_scanner_state: dict = {
    "running":     False,
    "last_scan":   None,
    "assets":      [],
    "last_signals": {},   # product_id → signal summary
    "errors":      [],
}

# Track which assets already have a pending signal (avoid duplicates)
_pending_for: set[str] = set()


def get_watched_assets() -> list[str]:
    raw = os.getenv("CRYPTO_WATCH", WATCH_DEFAULT)
    return [a.strip().upper() for a in raw.split(",") if a.strip()]


def get_scanner_status() -> dict:
    return {
        **_scanner_state,
        "watched_assets":   get_watched_assets(),
        "scan_interval_s":  SCAN_INTERVAL,
        "zscore_window":    ZSCORE_WINDOW,
        "entry_z":          ENTRY_Z,
        "exit_z":           EXIT_Z,
        "target_pct":       TARGET_PCT,
        "stop_pct":         STOP_PCT,
        "position_usd":     POSITION_USD,
    }


def _log_returns(prices: list[float]) -> list[float]:
    rets = []
    for i in range(1, len(prices)):
        if prices[i - 1] > 0 and prices[i] > 0:
            rets.append(math.log(prices[i] / prices[i - 1]))
        else:
            rets.append(0.0)
    return rets


def _zscore(values: list[float], window: int) -> Optional[float]:
    """Z-score of the last value relative to the prior `window` values."""
    if len(values) < window + 1:
        return None
    sample  = values[-(window + 1):-1]
    current = values[-1]
    n       = len(sample)
    if n < 2:
        return None
    mean = sum(sample) / n
    var  = sum((v - mean) ** 2 for v in sample) / (n - 1)
    std  = math.sqrt(var) if var > 0 else None
    if std is None or std < 1e-10:
        return None
    return (current - mean) / std


def _pct_change(prices: list[float], periods: int = 1) -> Optional[float]:
    if len(prices) < periods + 1:
        return None
    return (prices[-1] - prices[-(periods + 1)]) / prices[-(periods + 1)]


async def _scan_asset(product_id: str) -> Optional[dict]:
    """
    Fetch recent 1h candles and compute signal for one asset.
    Returns a signal summary dict if a signal was fired, else None.
    """
    client = get_exchange_client("coinbase")
    if client is None:
        return None

    try:
        history = await client.get_price_history(product_id, interval="1h")
    except Exception as exc:
        log.warning("crypto_scanner: history fetch failed %s: %s", product_id, exc)
        return None

    if not history or len(history) < ZSCORE_WINDOW + 2:
        log.debug("crypto_scanner: insufficient history for %s (%d candles)", product_id, len(history))
        return None

    # Sort ascending (oldest first)
    history.sort(key=lambda x: x["t"])
    prices = [float(c["p"]) for c in history]
    current_price = prices[-1]

    rets = _log_returns(prices)
    z    = _zscore(rets, ZSCORE_WINDOW)

    if z is None:
        return None

    pct_1h  = _pct_change(prices, 1)
    pct_4h  = _pct_change(prices, 4)
    pct_24h = _pct_change(prices, 24)

    summary = {
        "product_id":    product_id,
        "price":         round(current_price, 4),
        "z_score":       round(z, 3),
        "pct_1h":        round(pct_1h * 100, 2) if pct_1h else None,
        "pct_4h":        round(pct_4h * 100, 2) if pct_4h else None,
        "pct_24h":       round(pct_24h * 100, 2) if pct_24h else None,
        "scanned_at":    datetime.now(timezone.utc).isoformat(),
        "signal_fired":  False,
    }

    # ── Signal generation ──────────────────────────────────────────────────
    if product_id in _pending_for:
        log.debug("crypto_scanner: %s already has pending signal — skip", product_id)
        _scanner_state["last_signals"][product_id] = summary
        return summary

    # Don't open a new position if one is already open for this asset
    open_ids = {p["market_id"] for p in pt.get_open()}
    if product_id in open_ids:
        log.debug("crypto_scanner: %s already has an open position — skip", product_id)
        _scanner_state["last_signals"][product_id] = summary
        return summary

    fire_signal = False
    if z < -ENTRY_Z:
        fire_signal = True

    if fire_signal:
        target = round(current_price * (1 + TARGET_PCT), 4)
        stop   = round(current_price * (1 - STOP_PCT),   4)
        shares = POSITION_USD / current_price

        reasoning = (
            f"1h return z-score {z:.2f} < -{ENTRY_Z} on {product_id}. "
            f"Price {current_price:.4f} ({pct_1h:+.2f}% 1h, {pct_4h:+.2f}% 4h). "
            f"Mean-reversion long: target {target:.4f} (+{TARGET_PCT*100:.1f}%), "
            f"stop {stop:.4f} (-{STOP_PCT*100:.1f}%)."
        )

        sig = SignalSchema(
            market_id       = product_id,
            market_title    = f"{product_id} intraday reversion",
            strategy        = "zscore_reversion",
            side            = "BUY",
            entry_price     = current_price,
            target_price    = target,
            stop_loss       = stop,
            suggested_size  = int(POSITION_USD),
            suggested_shares= round(shares, 8),
            expected_edge   = round(TARGET_PCT * 100, 2),
            maker_edge      = 0.0,
            delta_taker     = 0.0,
            confidence      = min(0.95, abs(z) / (ENTRY_Z * 2)),
            reasoning       = reasoning,
            execution_mode  = ExecutionMode.confirm,
        )

        sq.add_signal(sig)
        _pending_for.add(product_id)
        alerts.send_alert_dict({
            "type":       "crypto_signal",
            "product_id": product_id,
            "price":      current_price,
            "z_score":    round(z, 3),
            "signal_id":  sig.id,
            "reasoning":  reasoning,
        })
        log.info(
            "CRYPTO SIGNAL: %s @ %.4f  z=%.2f  target=%.4f  stop=%.4f",
            product_id, current_price, z, target, stop,
        )

        summary["signal_fired"]  = True
        summary["signal_id"]     = sig.id
        summary["target"]        = target
        summary["stop"]          = stop

    _scanner_state["last_signals"][product_id] = summary
    return summary


async def _run_scan() -> None:
    """Scan all watched assets once."""
    assets = get_watched_assets()
    _scanner_state["assets"]    = assets
    _scanner_state["last_scan"] = datetime.now(timezone.utc).isoformat()

    # Prune _pending_for: remove assets whose signals are no longer pending
    current_pending_ids = {s.market_id for s in sq.get_pending()}
    stale = {a for a in _pending_for if a not in current_pending_ids}
    _pending_for.difference_update(stale)

    results = await asyncio.gather(*[_scan_asset(a) for a in assets], return_exceptions=True)

    for asset, result in zip(assets, results):
        if isinstance(result, Exception):
            log.error("crypto_scanner: scan failed for %s: %s", asset, result)
            _scanner_state["errors"].append(
                {"asset": asset, "error": str(result), "ts": datetime.now(timezone.utc).isoformat()}
            )
            # Keep last 20 errors
            _scanner_state["errors"] = _scanner_state["errors"][-20:]


async def run_crypto_scanner() -> None:
    """Long-running background coroutine. Start via asyncio.create_task()."""
    enabled = os.getenv("CRYPTO_SCANNER_ENABLED", "true").lower() not in ("false", "0", "no")
    if not enabled:
        log.info("Crypto scanner disabled via CRYPTO_SCANNER_ENABLED env var")
        return

    _scanner_state["running"] = True
    log.info("Crypto scanner started — watching %s every %ds", get_watched_assets(), SCAN_INTERVAL)

    while True:
        try:
            await _run_scan()
        except Exception as exc:
            log.error("crypto_scanner loop error: %s", exc)
        await asyncio.sleep(SCAN_INTERVAL)
