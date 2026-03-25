"""
Live market scanner.

Polls a set of markets at a configurable interval, runs the chosen strategy
on a rolling price window, and emits a signal whenever the strategy fires a
new entry or exit that hasn't been signalled before.

The scanner reuses PredictionMarketBacktester strategy methods directly —
no duplicate logic. Each market gets its own rolling state object so the
strategy's internal windows (z-score, Kelly win-rate, etc.) stay warm between ticks.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from ..models.schemas import BacktestRequest, SignalSchema, ExecutionMode
from .backtest_engine import PredictionMarketBacktester
from .exchange_router import get_exchange_client
from .signal_queue import add_signal

log = logging.getLogger(__name__)

# Number of candles fetched per scan tick — enough to warm rolling windows
_WARMUP_CANDLES = 60


class _MarketState:
    """Tracks per-market scanner state between ticks."""
    def __init__(self):
        self.in_position:       bool = False
        self.last_signal_date:  str  = ""
        self.last_price:        float = 0.0
        self.ticks_scanned:     int  = 0


class LiveScanner:
    def __init__(self):
        self._task:    Optional[asyncio.Task] = None
        self._running: bool = False

        # Configurable state (set on start)
        self.interval_seconds: float = 60.0
        self.markets:          list[dict] = []
        self.strategy:         str  = "zscore_reversion"
        self.params:           dict = {}
        self.execution_mode:   str  = "confirm"
        self.exchange:         str  = "kalshi"

        # Runtime diagnostics
        self.signals_fired:  int = 0
        self.ticks_total:    int = 0
        self.last_scan_at:   Optional[str] = None
        self.recent_errors:  list[str] = []

        self._state: dict[str, _MarketState] = {}

    # ── Control ───────────────────────────────────────────────────────────────

    def start(
        self,
        markets:          list[dict],
        strategy:         str,
        params:           dict,
        interval_seconds: float,
        execution_mode:   str,
        exchange:         str,
    ) -> None:
        if self._task and not self._task.done():
            self._task.cancel()

        self.markets          = markets
        self.strategy         = strategy
        self.params           = {k: v for k, v in params.items() if v is not None}
        self.interval_seconds = max(1.0, float(interval_seconds))
        self.execution_mode   = execution_mode
        self.exchange         = exchange
        self._running         = True
        self._state           = {}  # reset per-market state on (re)start
        self._task            = asyncio.create_task(self._loop())
        log.info(
            "Scanner started: %d market(s), strategy=%s, interval=%.1fs, mode=%s",
            len(markets), strategy, self.interval_seconds, execution_mode,
        )

    def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
        log.info("Scanner stopped after %d ticks, %d signals fired", self.ticks_total, self.signals_fired)

    def update_interval(self, seconds: float) -> None:
        self.interval_seconds = max(1.0, float(seconds))
        log.info("Scanner interval updated to %.1fs", self.interval_seconds)

    @property
    def is_running(self) -> bool:
        return self._running and self._task is not None and not self._task.done()

    def status(self) -> dict:
        return {
            "running":          self.is_running,
            "strategy":         self.strategy,
            "exchange":         self.exchange,
            "interval_seconds": self.interval_seconds,
            "execution_mode":   self.execution_mode,
            "markets":          [m.get("condition_id") for m in self.markets],
            "signals_fired":    self.signals_fired,
            "ticks_total":      self.ticks_total,
            "last_scan_at":     self.last_scan_at,
            "recent_errors":    self.recent_errors[-5:],
        }

    # ── Scan loop ─────────────────────────────────────────────────────────────

    async def _loop(self) -> None:
        while self._running:
            try:
                await self._scan_all()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                log.error("Scanner loop error: %s", exc)
            await asyncio.sleep(self.interval_seconds)

    async def _scan_all(self) -> None:
        self.last_scan_at = datetime.now(timezone.utc).isoformat()
        self.ticks_total += 1
        tasks = [self._scan_market(m) for m in self.markets]
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _scan_market(self, market: dict) -> None:
        cid      = market["condition_id"]
        token_id = market.get("token_id", cid)
        title    = market.get("title", cid)

        try:
            client  = get_exchange_client(self.exchange)
            history = await client.get_price_history(cid, token_id=token_id, interval="1d")
        except Exception as exc:
            self._log_error(cid, f"history fetch failed: {exc}")
            return

        if not history or len(history) < 5:
            return

        # Keep a rolling window — enough to warm the strategy's internal buffers
        window = history[-_WARMUP_CANDLES:]

        try:
            req = BacktestRequest(
                condition_id=cid,
                token_id=token_id,
                strategy=self.strategy,
                **self.params,
            )
            engine = PredictionMarketBacktester(req, window)
            result = engine.run()
        except Exception as exc:
            self._log_error(cid, f"engine error: {exc}")
            return

        if not result.success or not result.trades:
            return

        last_trade = result.trades[-1]
        state      = self._state.setdefault(cid, _MarketState())
        action     = last_trade["action"]
        trade_date = last_trade["date"]

        # Skip if we've already signalled this trade
        if trade_date <= state.last_signal_date:
            state.ticks_scanned += 1
            return

        is_buy   = action.startswith("BUY")
        is_sell  = action.startswith("SELL") or action.startswith("COVER")
        is_short = action.startswith("SHORT")

        if is_buy and not state.in_position:
            self._emit(market, last_trade, "BUY", title)
            state.in_position      = True
            state.last_signal_date = trade_date
        elif (is_sell or is_short) and state.in_position:
            self._emit(market, last_trade, "SELL", title)
            state.in_position      = False
            state.last_signal_date = trade_date
        elif is_short and not state.in_position:
            # Short entry when no long position open
            self._emit(market, last_trade, "SELL", title)
            state.in_position      = True   # treat short as a position
            state.last_signal_date = trade_date

        state.last_price    = float(last_trade["price"])
        state.ticks_scanned += 1

    def _emit(self, market: dict, trade: dict, side: str, title: str) -> None:
        price = float(trade["price"])
        cid   = market["condition_id"]

        # Estimate target / stop from current price
        target    = round(price * 1.05, 4) if side == "BUY" else round(price * 0.95, 4)
        stop      = round(price * 0.93, 4) if side == "BUY" else round(price * 1.05, 4)
        shares    = round(float(self.params.get("initial_capital", 1000)) / price, 6)

        sig = SignalSchema(
            market_id        = cid,
            strategy         = self.strategy,
            side             = side,
            entry_price      = price,
            target_price     = target,
            stop_loss        = stop,
            suggested_size   = int(self.params.get("initial_capital", 1000)),
            suggested_shares = shares,
            expected_edge    = 0.0,
            maker_edge       = 0.0,
            delta_taker      = 0.0,
            confidence       = 0.7,
            reasoning        = f"Live scan · {trade['action']} · {trade['date']}",
            execution_mode   = ExecutionMode(self.execution_mode),
        )
        add_signal(sig)
        self.signals_fired += 1
        log.info("Signal emitted: %s %s @ %.4f (%s)", side, cid, price, trade["date"])

    def _log_error(self, cid: str, msg: str) -> None:
        entry = f"[{cid}] {msg}"
        log.warning("Scanner: %s", entry)
        self.recent_errors.append(entry)
        if len(self.recent_errors) > 50:
            self.recent_errors = self.recent_errors[-50:]


# ── Singleton ──────────────────────────────────────────────────────────────────

_scanner = LiveScanner()


def get_scanner() -> LiveScanner:
    return _scanner
