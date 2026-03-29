"""
Insider detection scanner.

Analyses order-book depth, recent trade flow, and price velocity to detect
markets with unusual activity patterns consistent with informed positioning.

Five signals, each scored 0–100:
  book_imbalance  — bid depth >> ask depth → buyers loading up
  whale_trade     — single fill dominates recent volume
  price_velocity  — recent candle range >> prior candle range
  spread_widening — bid-ask spread elevated → LPs stepping back
  book_thinness   — total depth low → easy for big players to move price

smart_money_score = weighted sum (0–100).

Thresholds:
  0–30   noise / normal
  30–60  watch — some signal present
  60–80  elevated — multiple signals corroborating
  80–100 strong — high conviction informed flow

Output per market: InsiderResult dataclass.
"""

import asyncio
import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from .job_registry import registry
from .exchange_router import get_exchange_client

log = logging.getLogger(__name__)

_JOB = "insider_scanner"

registry.register(
    name=_JOB,
    description="Scores markets for informed-flow signals (book imbalance, whale trades, velocity)",
    category="signal",
    interval_seconds=300,   # 5-minute scan cadence
)

# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class InsiderSignals:
    book_imbalance:  float = 0.0   # 0-100
    whale_trade:     float = 0.0   # 0-100
    price_velocity:  float = 0.0   # 0-100
    spread_widening: float = 0.0   # 0-100
    book_thinness:   float = 0.0   # 0-100

    # Raw values (for display)
    bid_depth:       float = 0.0
    ask_depth:       float = 0.0
    max_trade_pct:   float = 0.0   # whale trade as % of recent volume
    spread:          Optional[float] = None
    velocity_range:  float = 0.0   # recent 5-candle range
    total_depth:     float = 0.0


@dataclass
class InsiderResult:
    market_id:            str
    title:                str
    exchange:             str
    smart_money_score:    float            # 0–100 EMA-smoothed composite
    raw_score:            float            # 0–100 instantaneous composite
    interpretation:       str              # "noise" | "watch" | "elevated" | "strong"
    signals:              InsiderSignals   = field(default_factory=InsiderSignals)
    flags:                list[str]        = field(default_factory=list)
    scanned_at:           str             = ""
    error:                Optional[str]   = None

    def as_dict(self) -> dict:
        return {
            "market_id":         self.market_id,
            "title":             self.title,
            "exchange":          self.exchange,
            "smart_money_score": round(self.smart_money_score, 1),
            "raw_score":         round(self.raw_score, 1),
            "score_divergence":  round(self.raw_score - self.smart_money_score, 1),
            "interpretation":    self.interpretation,
            "flags":             self.flags,
            "scanned_at":        self.scanned_at,
            "error":             self.error,
            "signals": {
                "book_imbalance":  round(self.signals.book_imbalance,  1),
                "whale_trade":     round(self.signals.whale_trade,     1),
                "price_velocity":  round(self.signals.price_velocity,  1),
                "spread_widening": round(self.signals.spread_widening, 1),
                "book_thinness":   round(self.signals.book_thinness,   1),
            },
            "raw": {
                "bid_depth":      round(self.signals.bid_depth, 2),
                "ask_depth":      round(self.signals.ask_depth, 2),
                "max_trade_pct":  round(self.signals.max_trade_pct * 100, 1),
                "spread":         round(self.signals.spread, 4) if self.signals.spread else None,
                "velocity_range": round(self.signals.velocity_range * 100, 2),
                "total_depth":    round(self.signals.total_depth, 2),
            },
        }


# ── Signal computation ────────────────────────────────────────────────────────

def _safe(v: float) -> float:
    return v if math.isfinite(v) else 0.0


def _book_imbalance_score(bids: list, asks: list) -> tuple[float, float, float]:
    """
    Returns (score 0-100, bid_depth, ask_depth).
    Score > 50 = net buying pressure; < 50 = net selling pressure.
    Extreme imbalance (> 70 or < 30) suggests directional intent.
    """
    bid_depth = sum(b.get("size", 0) for b in bids)
    ask_depth = sum(a.get("size", 0) for a in asks)
    total     = bid_depth + ask_depth
    if total < 1.0:
        return 50.0, bid_depth, ask_depth
    ratio = (bid_depth - ask_depth) / total   # -1 to +1
    score = _safe((ratio + 1.0) / 2.0 * 100.0)
    return score, bid_depth, ask_depth


def _whale_trade_score(trades: list) -> tuple[float, float]:
    """
    Returns (score 0-100, max_trade_pct).
    Scores the largest single trade as a fraction of total recent volume.
    A whale filling 25%+ of recent volume scores near 100.
    """
    if not trades:
        return 0.0, 0.0
    sizes     = [t.get("size", 0.0) for t in trades]
    total_vol = sum(sizes)
    if total_vol < 1e-9:
        return 0.0, 0.0
    max_trade = max(sizes)
    pct       = max_trade / total_vol
    # 33% of volume = score 100; scales linearly below
    score = _safe(min(100.0, pct * 300.0))
    return score, pct


def _spread_score(bids: list, asks: list) -> tuple[float, Optional[float]]:
    """
    Returns (score 0-100, spread).
    Wide spread (LPs stepping back) scores higher.
    Normal binary-market spread ≈ 2–4¢; elevated > 8¢; extreme > 15¢.
    """
    best_bid = bids[0]["price"] if bids else None
    best_ask = asks[0]["price"] if asks else None
    if best_bid is None or best_ask is None:
        return 50.0, None
    spread = best_ask - best_bid
    if spread < 0:
        spread = 0.0
    # 10-cent spread → score 100
    score = _safe(min(100.0, spread * 1000.0))
    return score, spread


def _thinness_score(bid_depth: float, ask_depth: float) -> tuple[float, float]:
    """
    Returns (score 0-100, total_depth).
    Thin books are easier for informed traders to sweep; they tend to trade
    earlier and let the book fill behind them.
    """
    total = bid_depth + ask_depth
    # Scale: 0 depth = 100, 2000+ depth = 0
    score = _safe(max(0.0, 100.0 - total / 20.0))
    return score, total


def _velocity_score(history: list) -> tuple[float, float]:
    """
    Returns (score 0-100, recent_range).
    Compares the price range of the most recent 5 candles to the prior 5.
    A sudden spike in range signals an informed move.
    """
    if len(history) < 6:
        return 0.0, 0.0
    prices = [max(0.0, min(1.0, float(h.get("p", 0)))) for h in history]
    recent = prices[-5:]
    prior  = prices[-10:-5] if len(prices) >= 10 else prices[:-5]
    if not prior:
        return 0.0, 0.0

    recent_range = max(recent) - min(recent)
    prior_range  = max(max(prior) - min(prior), 0.005)  # floor at 0.5¢ to avoid div/0
    ratio = recent_range / prior_range
    score = _safe(min(100.0, ratio * 50.0))   # 2× typical range = 100
    return score, recent_range


# ── Per-market analysis ───────────────────────────────────────────────────────

WEIGHTS = {
    "book_imbalance":  0.30,
    "whale_trade":     0.25,
    "price_velocity":  0.20,
    "spread_widening": 0.15,
    "book_thinness":   0.10,
}

# EMA smoothing — persists across scan cycles, keyed by market_id.
# α = 0.33 → ~15-min half-life at 5-min scan interval (default for prediction markets).
# α = 0.50 → ~10-min half-life for equity/crypto (thicker books, faster signal decay).
_ema_state: dict[str, float] = {}

_ALPHA_DEFAULT = 0.33   # prediction markets — thin books, deliberate accumulation
_ALPHA_EQUITY  = 0.50   # stocks/crypto — higher liquidity, noise decays faster

_EQUITY_EXCHANGES = {"yahoo", "coinbase"}


def _alpha(exchange: str) -> float:
    return _ALPHA_EQUITY if exchange.lower() in _EQUITY_EXCHANGES else _ALPHA_DEFAULT


def _apply_ema(market_id: str, raw: float, exchange: str) -> float:
    """Apply EMA smoothing. Seeds at raw score on first observation (no cold-start drag)."""
    α = _alpha(exchange)
    prev = _ema_state.get(market_id, raw)
    smoothed = α * raw + (1.0 - α) * prev
    _ema_state[market_id] = smoothed
    return smoothed


def _interpret(score: float) -> str:
    if score >= 80:
        return "strong"
    if score >= 60:
        return "elevated"
    if score >= 30:
        return "watch"
    return "noise"


async def analyse_market(
    market_id: str,
    title: str,
    exchange: str,
    token_id: Optional[str] = None,
) -> InsiderResult:
    """Fetch live data and compute all five signals for a single market."""
    scanned_at = datetime.now(timezone.utc).isoformat()

    try:
        client = get_exchange_client(exchange)
        token  = token_id or market_id

        # Fetch order book, recent trades, and price history concurrently
        book_task    = asyncio.create_task(_safe_fetch(client.get_order_book(token), {"bids": [], "asks": []}))
        trades_task  = asyncio.create_task(_safe_fetch(_get_trades(client, market_id, token), []))
        history_task = asyncio.create_task(_safe_fetch(
            client.get_price_history(market_id, token_id=token, interval="1d"),
            []
        ))

        book, trades, history = await asyncio.gather(book_task, trades_task, history_task)

        bids = book.get("bids", [])
        asks = book.get("asks", [])

        sig = InsiderSignals()

        sig.book_imbalance,  sig.bid_depth, sig.ask_depth = _book_imbalance_score(bids, asks)
        sig.whale_trade,     sig.max_trade_pct             = _whale_trade_score(trades)
        sig.spread_widening, sig.spread                    = _spread_score(bids, asks)
        sig.book_thinness,   sig.total_depth               = _thinness_score(sig.bid_depth, sig.ask_depth)
        sig.price_velocity,  sig.velocity_range            = _velocity_score(history)

        # Book imbalance is centred at 50 (neutral); only score above neutral as a signal
        imbalance_signal = max(0.0, sig.book_imbalance - 50.0) * 2.0   # 0-100

        composite = (
            WEIGHTS["book_imbalance"]  * imbalance_signal   +
            WEIGHTS["whale_trade"]     * sig.whale_trade     +
            WEIGHTS["price_velocity"]  * sig.price_velocity  +
            WEIGHTS["spread_widening"] * sig.spread_widening +
            WEIGHTS["book_thinness"]   * sig.book_thinness
        )
        raw_composite = _safe(min(100.0, composite))
        smoothed      = _apply_ema(market_id, raw_composite, exchange)

        flags = _build_flags(sig, smoothed)

        return InsiderResult(
            market_id=market_id,
            title=title,
            exchange=exchange,
            smart_money_score=smoothed,
            raw_score=raw_composite,
            interpretation=_interpret(smoothed),
            signals=sig,
            flags=flags,
            scanned_at=scanned_at,
        )

    except Exception as exc:
        log.warning("Insider scan failed %s: %s", market_id[:20], exc)
        return InsiderResult(
            market_id=market_id,
            title=title,
            exchange=exchange,
            smart_money_score=0.0,
            raw_score=0.0,
            interpretation="noise",
            scanned_at=scanned_at,
            error=str(exc),
        )


async def _safe_fetch(coro, fallback):
    try:
        return await coro
    except Exception:
        return fallback


async def _get_trades(client, market_id: str, token_id: str) -> list:
    """get_recent_trades signature differs between clients."""
    try:
        return await client.get_recent_trades(token_id, limit=50)
    except TypeError:
        try:
            return await client.get_recent_trades(market_id, token_id=token_id, limit=50)
        except Exception:
            return []


def _build_flags(sig: InsiderSignals, score: float) -> list[str]:
    flags = []
    if sig.book_imbalance > 70:
        flags.append(
            f"Bid loading: {sig.bid_depth:.0f} bid vs {sig.ask_depth:.0f} ask — "
            f"buyers dominating ({sig.book_imbalance:.0f}/100)"
        )
    elif sig.book_imbalance < 30:
        flags.append(
            f"Ask loading: {sig.ask_depth:.0f} ask vs {sig.bid_depth:.0f} bid — "
            f"sellers dominating ({100 - sig.book_imbalance:.0f}/100)"
        )
    if sig.whale_trade > 50:
        flags.append(
            f"Whale trade: single fill = {sig.max_trade_pct * 100:.1f}% of recent volume "
            f"({sig.whale_trade:.0f}/100)"
        )
    if sig.spread_widening > 50 and sig.spread is not None:
        flags.append(
            f"Spread widening: {sig.spread * 100:.1f}¢ — liquidity providers stepping back "
            f"({sig.spread_widening:.0f}/100)"
        )
    if sig.book_thinness > 70:
        flags.append(
            f"Thin book: {sig.total_depth:.0f} total depth — "
            f"easy to move ({sig.book_thinness:.0f}/100)"
        )
    if sig.price_velocity > 60:
        flags.append(
            f"Price velocity: {sig.velocity_range * 100:.1f}¢ range in last 5 candles "
            f"({sig.price_velocity:.0f}/100)"
        )
    if not flags and score >= 30:
        flags.append("Multiple weak signals — monitor")
    return flags


# ── Batch scan ────────────────────────────────────────────────────────────────

async def scan_markets(markets: list[dict], exchange: str = "polymarket") -> list[InsiderResult]:
    """
    Scan a list of markets concurrently and return results sorted by
    smart_money_score descending.
    """
    tasks = [
        analyse_market(
            market_id=m.get("condition_id") or m.get("market_id", ""),
            title=m.get("title", m.get("condition_id", ""))[:60],
            exchange=exchange,
            token_id=m.get("token_id"),
        )
        for m in markets
        if m.get("condition_id") or m.get("market_id")
    ]
    results = await asyncio.gather(*tasks)
    return sorted(results, key=lambda r: r.smart_money_score, reverse=True)


# ── Background job ────────────────────────────────────────────────────────────
# Stores the most recent scan results in memory so the API can serve them
# without firing a fresh scan on every request.

_last_results:   list[InsiderResult] = []
_scan_markets_cache: list[dict]      = []
_scan_exchange_cache: str            = "polymarket"


def set_scan_targets(markets: list[dict], exchange: str) -> None:
    """Called when the user configures the insider scan from the UI."""
    global _scan_markets_cache, _scan_exchange_cache
    _scan_markets_cache  = markets
    _scan_exchange_cache = exchange


def get_last_results() -> list[InsiderResult]:
    return _last_results


async def run_insider_scanner() -> None:
    """Long-running background coroutine. Start via asyncio.create_task()."""
    log.info("Insider scanner started (interval: 5m)")
    await asyncio.sleep(15)   # Let other startup tasks settle

    while True:
        if registry.is_enabled(_JOB) and _scan_markets_cache:
            try:
                async with registry.run_context(_JOB):
                    global _last_results
                    _last_results = await scan_markets(
                        _scan_markets_cache,
                        _scan_exchange_cache,
                    )
                    log.info(
                        "Insider scan complete: %d markets, top score=%.1f (%s)",
                        len(_last_results),
                        _last_results[0].smart_money_score if _last_results else 0,
                        _last_results[0].market_id[:20] if _last_results else "—",
                    )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("Insider scanner error: %s", exc)
        await asyncio.sleep(300)   # 5 minutes
