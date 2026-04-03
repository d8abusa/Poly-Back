"""
Kalshi market scanner — background loop enabling compounding returns.

Monitors configured prediction markets and automatically queues re-entry
signals after a position closes, replicating the compounding effect shown
in backtests.

Configuration (environment variables):
  KALSHI_WATCH            Comma-separated market tickers to monitor
                          e.g. "KXMUSKTRILLION-28,CHINAUSGDP-30"
  KALSHI_SCAN_INTERVAL    Seconds between full scans (default: 1800 = 30 min)
  KALSHI_POSITION_USD     Capital per position in dollars (default: 25.0)
  KALSHI_EXEC_MODE        confirm | auto | alert_only  (default: confirm)
  KALSHI_SCANNER_ENABLED  Set "false" to disable (default: true)

Strategy (market maker reversion):
  - Estimates fair value as rolling 20-period mean of recent prices
  - Fires BUY when current price is below fair value by >= threshold
  - Target = fair value + half spread
  - Stop   = entry  - 2x spread (floor at 0.01)
  - One pending signal per market — no duplicate queuing
  - Skips markets with an open position (re-entry happens next scan cycle)
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
from . import position_tracker as pt
from . import alert_service as alerts
from .job_registry import registry

log = logging.getLogger(__name__)

SCAN_INTERVAL  = int(os.getenv("KALSHI_SCAN_INTERVAL", "1800"))
POSITION_USD   = float(os.getenv("KALSHI_POSITION_USD", "25.0"))
EXEC_MODE_ENV  = os.getenv("KALSHI_EXEC_MODE", "confirm")
WARMUP_CANDLES = 30   # minimum price history needed

_JOB = "kalshi_scanner"
registry.register(
    name=_JOB,
    description="Monitors Kalshi prediction markets for re-entry signals (compounding)",
    category="signal",
    interval_seconds=SCAN_INTERVAL,
)

_scanner_state: dict = {
    "running":      False,
    "last_scan":    None,
    "markets":      [],
    "last_signals": {},
    "errors":       [],
}

_pending_for: set[str] = set()


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_watched_markets() -> list[str]:
    raw = os.getenv("KALSHI_WATCH", "")
    return [m.strip().upper() for m in raw.split(",") if m.strip()]


def get_scanner_status() -> dict:
    return {
        **_scanner_state,
        "watched_markets":  get_watched_markets(),
        "scan_interval_s":  SCAN_INTERVAL,
        "position_usd":     POSITION_USD,
        "exec_mode":        EXEC_MODE_ENV,
    }


def _resolve_exec_mode() -> ExecutionMode:
    return {
        "auto":       ExecutionMode.auto,
        "alert_only": ExecutionMode.alert_only,
    }.get(EXEC_MODE_ENV, ExecutionMode.confirm)


def _best_price(levels: list) -> Optional[float]:
    """Extract best price from an order book level list (handles dict or list format)."""
    if not levels:
        return None
    level = levels[0]
    try:
        if isinstance(level, dict):
            return float(
                level.get("price")
                or level.get("yes_price")
                or level.get("p")
                or 0
            ) or None
        if isinstance(level, (list, tuple)):
            return float(level[0]) if level else None
        return float(level)
    except (TypeError, ValueError, IndexError):
        return None


def _rolling_mean(prices: list[float], window: int) -> float:
    sample = prices[-window:]
    return sum(sample) / len(sample)


def _zscore_last(prices: list[float], window: int) -> Optional[float]:
    if len(prices) < window + 1:
        return None
    sample  = prices[-(window + 1):-1]
    current = prices[-1]
    n       = len(sample)
    mean    = sum(sample) / n
    var     = sum((v - mean) ** 2 for v in sample) / max(n - 1, 1)
    std     = math.sqrt(var) if var > 1e-10 else None
    if std is None:
        return None
    return (current - mean) / std


# ── Per-market scan ───────────────────────────────────────────────────────────

async def _scan_market(market_id: str) -> Optional[dict]:
    """
    Fetch current state for one Kalshi market and decide whether to queue
    an entry signal.  Returns a summary dict (always), or None on hard failure.
    """
    client = get_exchange_client("kalshi")
    if client is None:
        return None

    try:
        snapshot = await client.get_market_snapshot(market_id, token_id=None)
        history  = await client.get_price_history(market_id, token_id=None, interval="1d")
    except Exception as exc:
        log.warning("kalshi_scanner: fetch failed %s: %s", market_id, exc)
        return None

    if not history or len(history) < WARMUP_CANDLES:
        log.debug(
            "kalshi_scanner: insufficient history for %s (%d candles)",
            market_id, len(history) if history else 0,
        )
        return None

    history.sort(key=lambda x: x["t"])
    prices        = [float(c["p"]) for c in history]
    current_price = prices[-1]

    # Fair value: 20-period rolling mean
    fair_value = _rolling_mean(prices, min(20, len(prices)))

    # Spread from order book (best bid / ask)
    book     = snapshot.get("order_book", {}) if snapshot else {}
    best_bid = _best_price(book.get("bids", []))
    best_ask = _best_price(book.get("asks", []))

    if best_bid is None:
        best_bid = current_price * 0.98
    if best_ask is None:
        best_ask = current_price * 1.02

    spread    = max(best_ask - best_bid, 0.01)
    title     = (snapshot or {}).get("title") or (snapshot or {}).get("question") or market_id
    deviation = current_price - fair_value

    summary = {
        "market_id":    market_id,
        "title":        title,
        "price":        round(current_price, 4),
        "fair_value":   round(fair_value, 4),
        "deviation":    round(deviation, 4),
        "spread":       round(spread, 4),
        "scanned_at":   datetime.now(timezone.utc).isoformat(),
        "signal_fired": False,
    }

    # ── Skip guards ───────────────────────────────────────────────────────────

    if market_id in _pending_for:
        log.debug("kalshi_scanner: %s already has pending signal — skip", market_id)
        _scanner_state["last_signals"][market_id] = summary
        return summary

    open_ids = {p["market_id"] for p in pt.get_open()}
    if market_id in open_ids:
        log.debug("kalshi_scanner: %s has open position — skip", market_id)
        _scanner_state["last_signals"][market_id] = summary
        return summary

    # ── Entry condition ───────────────────────────────────────────────────────
    # Price must be below fair value by at least max(spread, 0.03)
    # This replicates the "mm_bid fair=X" logic from the backtest

    threshold  = max(spread, 0.03)
    fire_signal = deviation < -threshold   # current_price < fair_value - threshold

    if fire_signal:
        target = round(fair_value + spread * 0.5, 4)      # exit near fair value
        stop   = round(current_price - spread * 2.0, 4)   # 2x spread risk
        stop   = max(stop, 0.01)

        shares = round(POSITION_USD / current_price, 6) if current_price > 0 else 0
        edge   = round((target - current_price) / current_price * 100, 2)

        reasoning = (
            f"MM reversion on {market_id}: price {current_price:.4f} is "
            f"{abs(deviation):.4f} below fair value {fair_value:.4f} "
            f"(threshold {threshold:.4f}). Spread {spread:.4f}. "
            f"Target {target:.4f} (+{edge:.1f}%), stop {stop:.4f}."
        )

        sig = SignalSchema(
            market_id       = market_id,
            market_title    = title,
            strategy        = "kalshi_mm",
            side            = "YES",
            entry_price     = current_price,
            target_price    = target,
            stop_loss       = stop,
            suggested_size  = int(POSITION_USD),
            suggested_shares= shares,
            expected_edge   = edge,
            maker_edge      = round(spread * 100, 2),
            delta_taker     = 0.0,
            confidence      = min(0.9, abs(deviation) / fair_value * 5),
            reasoning       = reasoning,
            execution_mode  = _resolve_exec_mode(),
            exchange        = "kalshi",
            asset_type      = "prediction_market",
        )

        queued = sq.add_signal(sig)
        if queued is None:
            log.error("kalshi_scanner: add_signal returned None for %s — signal lost", market_id)
        else:
            _pending_for.add(market_id)

        alerts.send_alert_dict({
            "type":       "kalshi_signal",
            "market_id":  market_id,
            "title":      title,
            "price":      current_price,
            "fair_value": fair_value,
            "deviation":  round(deviation, 4),
            "signal_id":  sig.id,
            "reasoning":  reasoning,
        })

        log.info(
            "KALSHI SIGNAL: %s @ %.4f  fair=%.4f  dev=%.4f  target=%.4f  stop=%.4f",
            market_id, current_price, fair_value, deviation, target, stop,
        )

        summary["signal_fired"] = True
        summary["signal_id"]    = sig.id
        summary["target"]       = target
        summary["stop"]         = stop

    _scanner_state["last_signals"][market_id] = summary
    return summary


# ── Full scan cycle ───────────────────────────────────────────────────────────

async def _run_scan() -> None:
    markets = get_watched_markets()
    _scanner_state["markets"]   = markets
    _scanner_state["last_scan"] = datetime.now(timezone.utc).isoformat()

    # Prune _pending_for: remove markets whose signals are no longer pending
    current_pending_ids = {s.market_id for s in sq.get_pending()}
    stale = {m for m in _pending_for if m not in current_pending_ids}
    _pending_for.difference_update(stale)

    results = await asyncio.gather(
        *[_scan_market(m) for m in markets],
        return_exceptions=True,
    )

    for market, result in zip(markets, results):
        if isinstance(result, Exception):
            log.error("kalshi_scanner: scan failed for %s: %s", market, result)
            _scanner_state["errors"].append({
                "market": market,
                "error":  str(result),
                "ts":     datetime.now(timezone.utc).isoformat(),
            })
            _scanner_state["errors"] = _scanner_state["errors"][-20:]


# ── Long-running background coroutine ─────────────────────────────────────────

async def run_kalshi_scanner() -> None:
    """Start via asyncio.create_task() in main.py lifespan."""
    enabled = os.getenv("KALSHI_SCANNER_ENABLED", "true").lower() not in ("false", "0", "no")
    if not enabled:
        log.info("Kalshi scanner disabled via KALSHI_SCANNER_ENABLED env var")
        registry.set_enabled(_JOB, False)
        return

    markets = get_watched_markets()
    if not markets:
        log.info(
            "Kalshi scanner: no markets configured — "
            "set KALSHI_WATCH=TICKER1,TICKER2 in .env to enable"
        )
        return

    _scanner_state["running"] = True
    log.info(
        "Kalshi scanner started — watching %s every %ds",
        markets, SCAN_INTERVAL,
    )

    while True:
        if registry.is_enabled(_JOB):
            try:
                async with registry.run_context(_JOB):
                    await _run_scan()
            except asyncio.CancelledError:
                log.info("Kalshi scanner shutting down")
                raise
            except Exception:
                log.exception("Kalshi scanner loop error")
        await asyncio.sleep(SCAN_INTERVAL)
