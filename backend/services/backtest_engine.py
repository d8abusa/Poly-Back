"""
Prediction market backtest engine.

In prediction markets prices = probabilities (0–1).
A YES contract bought at price p pays $1 on YES resolution, $0 on NO.

For backtesting we treat positions as tradeable (enter/exit before resolution),
measuring P&L as (exit_price - entry_price) × shares.
This mirrors how market makers and active traders operate on Polymarket.
"""

import logging
import numpy as np
import pandas as pd
from collections import deque
from datetime import datetime, timezone
from typing import List

try:
    from xgboost import XGBClassifier
    _XGB_AVAILABLE = True
except ImportError:
    _XGB_AVAILABLE = False

from ..models.schemas import BacktestRequest, BacktestResult, BatchBacktestResult

log = logging.getLogger(__name__)


def run_batch(
    requests_with_histories: list[tuple[BacktestRequest, list]],
    fetch_duration_ms: float = 0.0,
) -> BatchBacktestResult:
    """
    Run a backtest for each (request, history) pair and collect results.

    Failures in individual markets are recorded as failed BacktestResults
    without aborting the rest of the batch.
    """
    results: list[BacktestResult] = []
    for req, history in requests_with_histories:
        try:
            engine = PredictionMarketBacktester(req, history)
            result = engine.run()
        except Exception as exc:
            log.error("batch run: engine failed for %s — %s", req.condition_id, exc)
            result = BacktestResult(
                success=False,
                error=str(exc),
                condition_id=req.condition_id,
                initial_capital=req.initial_capital,
                final_value=req.initial_capital,
                total_return=0, sharpe_ratio=0, max_drawdown=0,
                total_trades=0, win_rate=0,
                equity_curve=[], trades=[],
            )
        results.append(result)

    succeeded = sum(1 for r in results if r.success)
    failed = len(results) - succeeded
    log.info(
        "batch run complete: %d succeeded, %d failed (fetch %.0f ms)",
        succeeded, failed, fetch_duration_ms,
    )
    return BatchBacktestResult(
        total=len(results),
        succeeded=succeeded,
        failed=failed,
        fetch_duration_ms=round(fetch_duration_ms, 1),
        results=results,
    )


class PredictionMarketBacktester:
    def __init__(self, request: BacktestRequest, history: List[dict]):
        self.req = request
        self.history = history       # [{t: unix_ts, p: probability}]
        self.cash = request.initial_capital
        self.position = 0.0          # YES shares held
        self.avg_entry = 0.0
        self.trades: list = []
        self.equity_curve: list = []

        # ── Per-strategy state ─────────────────────────────────────────────

        # Z-Score Reversion: rolling window of probabilities
        self._zscore_window: deque = deque(maxlen=request.zscore_window if hasattr(request, "zscore_window") else 20)

        # Mean Reversion: separate rolling window using its own lookback_window param
        self._mr_window: deque = deque(maxlen=request.lookback_window)

        # Kelly: tracks consecutive wins/losses for fractional sizing
        self._kelly_last_pnls: deque = deque(maxlen=20)

        # Cooldown: track tick index to enforce min_hold_days between buys
        self._tick_idx: int = 0
        self._last_buy_idx: int = -9999   # far in the past so first buy is always allowed

        # Short selling state (stocks only)
        # Model: cash acts as margin. On cover: cash += (entry - cover) * shares.
        self.short_position: float = 0.0
        self.short_entry: float = 0.0

        # XGBoost: model + feature buffer
        self._xgb_model = None
        self._xgb_probs: list = []   # raw probability history for feature building

        # Market Making: tracks our two open legs
        # Each leg: {"side": "YES"|"NO", "entry": float, "shares": float}
        self._mm_bid_leg: dict | None = None   # long YES at bid
        self._mm_ask_leg: dict | None = None   # short via cash reserve at ask
        self._mm_spread_target: float = getattr(request, "mm_spread", 0.04)
        self._mm_max_inventory: float = 0.30   # max prob-units of inventory

    # ── Public entry point ───────────────────────────────────────────────────

    def run(self) -> BacktestResult:
        if not self.history:
            return self._error("No price history available for this market/interval.")

        # Detect stock/crypto mode: PM probabilities are always in [0, 1].
        # Stocks and crypto have prices >> 1 (e.g. $254, $70 000).
        # Use the LAST price, not the first — early history (e.g. 1980s AAPL splits)
        # can have prices below $1 even for assets that currently trade at hundreds.
        self._is_stock: bool = float(self.history[-1]["p"]) > 1.0
        self._stock_ref_high: float = float(self.history[0]["p"])    # rolling high for dip detection — starts at first price, advances forward in time

        history = self.history
        date_from = getattr(self.req, "date_from", None)
        date_to   = getattr(self.req, "date_to",   None)
        if date_from or date_to:
            history = [
                pt for pt in history
                if (not date_from or self._ts_to_date(int(pt["t"])) >= date_from)
                and (not date_to   or self._ts_to_date(int(pt["t"])) <= date_to)
            ]
            if not history:
                return self._error(f"No data in the selected window ({date_from} – {date_to}).")

        # Wizard: run all long strategies and return the best
        if self.req.strategy == "wizard":
            return self._wizard(history)

        for pt in history:
            prob = float(pt["p"])
            date = self._ts_to_date(int(pt["t"]))
            self._tick_idx += 1

            long_val  = self.position * prob
            short_pnl = (self.short_entry - prob) * self.short_position
            portfolio_val = self.cash + long_val + short_pnl
            self.equity_curve.append({
                "date": date,
                "value": round(portfolio_val, 4),
                "price": round(prob, 4),
            })

            if self.req.strategy == "threshold":
                self._threshold(prob, date)
            elif self.req.strategy == "momentum":
                self._momentum(prob, date)
            elif self.req.strategy in ("zscore_reversion", "zscore"):
                self._zscore_reversion(prob, date)
            elif self.req.strategy == "mean_reversion":
                self._mean_reversion(prob, date)
            elif self.req.strategy == "kelly":
                self._kelly(prob, date)
            elif self.req.strategy == "market_making":
                self._market_making(prob, date)
            elif self.req.strategy == "xgboost":
                self._xgboost(prob, date)
            elif self.req.strategy == "swing_reversion":
                self._swing_reversion(prob, date)
            elif self.req.strategy == "short_momentum":
                self._short_momentum(prob, date)
            elif self.req.strategy == "short_zscore":
                self._short_zscore(prob, date)

        # Force-close any open position at last price
        if self.position > 0:
            last = history[-1]
            self._sell(float(last["p"]), self._ts_to_date(int(last["t"])), forced=True)

        # Force-cover any open short at last price
        if self.short_position > 0:
            last = history[-1]
            self._short_cover(float(last["p"]), self._ts_to_date(int(last["t"])), forced=True)

        # Market making: close any open bid leg
        if self._mm_bid_leg is not None and self.position > 0:
            last = history[-1]
            self._sell(float(last["p"]), self._ts_to_date(int(last["t"])), forced=True)
            self._mm_bid_leg = None

        equity_series = pd.Series([pt["value"] for pt in self.equity_curve])
        daily_ret = equity_series.pct_change().dropna()
        ann_factor = self._annualization_factor(history)

        return BacktestResult(
            success=True,
            condition_id=self.req.condition_id,
            initial_capital=self.req.initial_capital,
            final_value=round(self.cash, 4),
            total_return=round((self.cash - self.req.initial_capital) / self.req.initial_capital * 100, 2),
            sharpe_ratio=round(self._sharpe(daily_ret, ann_factor=ann_factor), 3),
            max_drawdown=round(self._max_drawdown(equity_series) * 100, 2),
            total_trades=len(self.trades),
            win_rate=round(self._win_rate() * 100, 2),
            equity_curve=self.equity_curve,
            trades=self.trades,
        )

    # ── Strategies ────────────────────────────────────────────────────────────

    def _threshold(self, prob: float, date: str):
        """
        Prediction markets: buy when prob ≤ entry_threshold (e.g. 30¢), sell at exit_threshold.
        Stocks: entry_threshold = % dip from rolling high to buy; exit_threshold = % gain to sell.
        """
        stop = self.req.stop_loss
        if self._is_stock:
            self._stock_ref_high = max(self._stock_ref_high, prob)
            if self.position == 0 and self.cash > 0 and not self._on_cooldown():
                dip = (self._stock_ref_high - prob) / self._stock_ref_high
                macro_ok, size_mult = self._macro_stock_gate()
                if dip >= self.req.entry_threshold and macro_ok:
                    cost = self.cash * size_mult
                    self._buy_partial(prob, date, shares=cost / prob, cost=cost,
                                      note=f"dip={dip*100:.1f}% macro={size_mult:.0%}")
                    self._stock_ref_high = prob   # reset after entry
            elif self.position > 0:
                gain = (prob - self.avg_entry) / self.avg_entry
                loss = (self.avg_entry - prob) / self.avg_entry
                if gain >= self.req.exit_threshold:
                    self._sell(prob, date, note=f"gain={gain*100:.1f}%")
                elif stop is not None and loss >= stop:
                    self._sell(prob, date, forced=True, note=f"loss={loss*100:.1f}%")
        else:
            if prob <= self.req.entry_threshold and self.position == 0 and self.cash > 0 and not self._on_cooldown():
                self._buy(prob, date)
            elif self.position > 0:
                if prob >= self.req.exit_threshold:
                    self._sell(prob, date)
                elif stop is not None and prob <= stop:
                    self._sell(prob, date, forced=True)

    def _momentum(self, prob: float, date: str):
        """
        Breakout Momentum.

        Stocks:
          - Entry: price closes above the rolling N-candle high AND the breakout
            magnitude exceeds momentum_min%.  Avoids chasing — only fires on a
            genuine new high, not every up-tick.
          - Exit: trailing stop (trail_pct% below peak) or hard stop_loss.

        Prediction markets:
          - Simpler tick-direction approach is fine here; PM prices are 0–1 and
            you want to ride directional flow without a magnitude requirement.

        Parameters (BacktestRequest):
          window        int    14    candles for rolling-high lookback
          momentum_min  float   5.0  min % breakout above rolling high to enter
          trail_pct     float  10.0  % drop from peak that fires trailing stop
          stop_loss     float  None  hard stop (% loss from entry)
        """
        window       = self.req.window
        momentum_min = self.req.momentum_min   # %
        trail_pct    = self.req.trail_pct / 100.0
        stop         = self.req.stop_loss

        if self._is_stock:
            # Need at least `window` candles to compute rolling high
            if len(self.equity_curve) < window:
                return

            # Rolling high over the lookback window (exclude current tick)
            lookback = [pt["price"] for pt in self.equity_curve[-window:-1]]
            if not lookback:
                return
            rolling_high = max(lookback)

            if self.position == 0 and self.cash > 0 and not self._on_cooldown():
                # Breakout: price exceeds rolling high by at least momentum_min%
                breakout_pct = (prob - rolling_high) / rolling_high * 100.0
                macro_ok, size_mult = self._macro_stock_gate()
                if prob > rolling_high and breakout_pct >= momentum_min and macro_ok:
                    cost = self.cash * size_mult
                    self._buy_partial(prob, date, shares=cost / prob, cost=cost,
                                      note=f"breakout +{breakout_pct:.1f}% macro={size_mult:.0%}")
                    self._stock_ref_high = prob   # begin tracking peak for trail

            elif self.position > 0:
                # Update trailing peak
                self._stock_ref_high = max(self._stock_ref_high, prob)
                # Trailing stop: price pulled back trail_pct% from peak
                trail_drawdown = (self._stock_ref_high - prob) / self._stock_ref_high
                if trail_drawdown >= trail_pct:
                    self._sell(prob, date, note=f"trail stop -{trail_drawdown*100:.1f}% from peak")
                elif stop is not None:
                    loss = (self.avg_entry - prob) / self.avg_entry
                    if loss >= stop:
                        self._sell(prob, date, forced=True, note=f"hard stop -{loss*100:.1f}%")

        else:
            # Prediction markets: tick-direction momentum (fine for 0–1 probabilities)
            if len(self.equity_curve) < 2:
                return
            prev_price = self.equity_curve[-2]["price"]
            if prob > prev_price and self.position == 0 and self.cash > 0 and not self._on_cooldown():
                self._buy(prob, date)
            elif prob <= prev_price and self.position > 0:
                self._sell(prob, date)

    def _zscore_reversion(self, prob: float, date: str):
        """
        Z-Score Mean Reversion.

        Theory: prediction market probabilities revert to a rolling mean when
        temporarily dislocated by noise, thin liquidity, or overreaction to news.

        Logic:
          - Maintain a rolling window of recent probabilities (default 20 ticks).
          - Compute z-score = (prob - mean) / std.
          - BUY  when z-score < -entry_z  (prob unusually depressed → expect reversion up).
          - SELL when z-score >  exit_z   (prob reverted to or above mean).
          - STOP if z-score < -stop_z     (dislocation deepening → cut loss).

        Parameters on BacktestRequest (with defaults):
          zscore_window   int   20     rolling window length
          zscore_entry    float 1.5    z-score threshold to enter long
          zscore_exit     float 0.0    z-score threshold to exit (mean reversion)
          zscore_stop     float 3.0    z-score floor for stop-loss
        """
        self._zscore_window.append(prob)

        # Need a full window before trading
        if len(self._zscore_window) < self._zscore_window.maxlen:
            return

        arr  = np.array(self._zscore_window)
        mean = arr.mean()
        std  = arr.std()

        if std < 1e-6:
            # Flat market — no edge, stay out
            return

        z = (prob - mean) / std

        base_entry_z = getattr(self.req, "zscore_entry", 1.5)
        # Widen entry threshold in uncertain macro regimes (macro_zscore_mult >= 1.0)
        macro_mult = getattr(self.req, "macro_zscore_mult", 1.0)
        entry_z = base_entry_z * macro_mult
        exit_z  = getattr(self.req, "zscore_exit",  0.0)
        stop_z  = getattr(self.req, "zscore_stop",  3.0)

        stop = self.req.stop_loss

        if self.position == 0 and self.cash > 0 and not self._on_cooldown():
            if z < -entry_z:
                # Probability is significantly below its rolling mean — buy the dip
                self._buy(prob, date, note=f"z={z:.2f}")
        elif self.position > 0:
            if z >= exit_z:
                # Reversion achieved — take profit
                self._sell(prob, date, note=f"z={z:.2f} reversion")
            elif z < -stop_z:
                # Dislocation deepening past stop — cut loss
                self._sell(prob, date, forced=True, note=f"z={z:.2f} stop")
            elif self._stop_triggered(prob):
                self._sell(prob, date, forced=True, note="stop-loss")

    def _mean_reversion(self, prob: float, date: str):
        """
        Mean Reversion.

        Theory: probabilities oscillate around a rolling mean in stationary markets.
        Fade deviations beyond a threshold standard deviations from the mean.

        Logic:
          - Maintain a rolling window of recent probabilities (lookback_window ticks).
          - Compute deviation = (prob - mean) / std.
          - BUY  when deviation < -reversion_threshold (prob below mean by k std devs).
          - SELL when prob reverts to rolling mean (deviation >= 0).

        Parameters on BacktestRequest (with defaults):
          lookback_window      int   15    rolling window length
          reversion_threshold  float 2.0   std devs from mean to trigger entry
        """
        self._mr_window.append(prob)

        if len(self._mr_window) < self._mr_window.maxlen:
            return

        arr  = np.array(self._mr_window)
        mean = arr.mean()
        std  = arr.std()

        if std < 1e-6:
            return

        deviation = (prob - mean) / std
        threshold = self.req.reversion_threshold
        stop      = self.req.stop_loss

        if self.position == 0 and self.cash > 0 and not self._on_cooldown():
            if deviation < -threshold:
                self._buy(prob, date, note=f"dev={deviation:.2f}")
        elif self.position > 0:
            if deviation >= 0.0:
                self._sell(prob, date, note=f"dev={deviation:.2f} reverted")
            elif self._stop_triggered(prob):
                self._sell(prob, date, forced=True, note="stop-loss")

    def _kelly(self, prob: float, date: str):
        """
        Kelly Criterion Sizing.

        Theory: bet the fraction of capital that maximises expected log-wealth,
        based on an estimated edge derived from the entry/exit thresholds.

        f* = (bp - q) / b
          where b = (exit_threshold / entry_prob) - 1  (net odds if prob reaches target)
                p = estimated win probability (we use the implied edge from thresholds)
                q = 1 - p

        We use a *fractional Kelly* (half-Kelly by default) to reduce variance.

        Entry/exit still use threshold logic so it composites cleanly with
        the existing parameter set. The difference from plain threshold:
        position size is dynamic rather than always all-in.

        Parameters on BacktestRequest (with defaults):
          kelly_fraction  float  0.5   fraction of full Kelly to bet (0.5 = half-Kelly)
          entry_threshold float  0.30  same as threshold strategy
          exit_threshold  float  0.70  same as threshold strategy
        """
        base_fraction  = getattr(self.req, "kelly_fraction", 0.5)
        # Apply macro caution factor (0 < caution <= 1.0) — reduces fraction in risky regimes
        macro_caution  = getattr(self.req, "macro_kelly_caution", 1.0)
        kelly_fraction = base_fraction * macro_caution
        stop = self.req.stop_loss

        if self._is_stock:
            self._stock_ref_high = max(self._stock_ref_high, prob)

        if self.position == 0 and self.cash > 0 and not self._on_cooldown():
            # Use kelly_dip_threshold override when set; fall back to entry_threshold.
            dip_thr = getattr(self.req, "kelly_dip_threshold", None) or self.req.entry_threshold
            entry_hit = (
                ((self._stock_ref_high - prob) / self._stock_ref_high >= dip_thr)
                if self._is_stock else (prob <= self.req.entry_threshold)
            )
            if entry_hit:
                self._stock_ref_high = prob
                # Estimate edge: net fractional gain if target is hit.
                # PM:     exit_threshold is an absolute probability (e.g. 0.70),
                #         so net odds = exit / entry_prob - 1.
                # Stocks: exit_threshold is already a % gain target (e.g. 0.20 = 20%),
                #         so b = exit_threshold directly.
                if self._is_stock:
                    b = self.req.exit_threshold          # already fractional gain
                else:
                    b = (self.req.exit_threshold / prob) - 1.0

                # Minimum ROI guard — skip tiny moves that don't justify the trade
                min_roi = getattr(self.req, "kelly_min_roi", 0.0)
                if min_roi > 0.0 and b < min_roi:
                    return

                # Win probability: prefer FRED-calibrated p_true when available + confident
                fred_p     = getattr(self.req, "fred_p_true", None)
                fred_conf  = getattr(self.req, "fred_confidence", None)
                use_fred   = (
                    fred_p is not None
                    and fred_conf is not None
                    and fred_conf >= 0.4
                )
                if use_fred:
                    p_win = fred_p
                else:
                    p_win = self._recent_win_rate()
                q_win = 1.0 - p_win

                if self._is_stock and stop is not None and stop > 0:
                    # Asymmetric Kelly with bounded loss: f* = p/a - q/b
                    # where a = stop_loss fraction, b = exit_threshold fraction.
                    # This correctly captures that we don't lose 100% on a loss —
                    # we only lose `stop` % of the position.
                    a = stop  # downside per unit (stop_loss fraction)
                    full_kelly = p_win / a - q_win / b if b > 0 else 0.0
                else:
                    # Standard Kelly: assumes full loss if wrong (correct for PM)
                    full_kelly = (b * p_win - q_win) / b if b > 0 else 0.0
                fraction   = max(0.0, min(1.0, full_kelly * kelly_fraction))

                if fraction < 0.01:
                    # No edge — skip
                    return

                capital_to_deploy = self.cash * fraction
                shares = capital_to_deploy / prob
                self._buy_partial(prob, date, shares, capital_to_deploy,
                                  note=f"kelly_f={fraction:.2f}")

        elif self.position > 0:
            if self._is_stock:
                gain = (prob - self.avg_entry) / self.avg_entry
                loss = (self.avg_entry - prob) / self.avg_entry
                if gain >= self.req.exit_threshold:
                    self._sell(prob, date, note=f"kelly gain={gain*100:.1f}%")
                elif stop is not None and loss >= stop:
                    self._sell(prob, date, forced=True, note=f"kelly loss={loss*100:.1f}%")
            else:
                if prob >= self.req.exit_threshold:
                    self._sell(prob, date, note="kelly exit")
                elif stop is not None and prob <= stop:
                    self._sell(prob, date, forced=True, note="kelly stop")

    def _market_making(self, prob: float, date: str):
        """
        Simplified Market Making (inventory management model).

        Theory: post a bid below and an ask above the mid-price. Collect the
        spread when both sides fill. Manage inventory to avoid directional risk.

        Simplified for backtesting (no order book):
          - Each tick, decide whether to open a long (bid) position if prob is
            sufficiently below our estimated fair value (rolling mean).
          - Exit the long when prob rises by at least the spread target.
          - Hard inventory cap prevents over-exposure.
          - Skew: if already long, require a wider dip before adding more.

        Parameters on BacktestRequest (with defaults):
          mm_spread       float  0.04   minimum spread to collect (entry discount)
          entry_threshold / exit_threshold used as fair-value anchors
        """
        # Rolling fair-value estimate (20-tick EMA proxy)
        self._zscore_window.append(prob)   # reuse window for fair-value
        if len(self._zscore_window) < 5:
            return

        arr       = np.array(self._zscore_window)
        fair      = float(arr[-5:].mean())    # short-term mean as fair value
        # For stocks/crypto, spread is a fraction of fair value (e.g. 0.04 = 4%)
        # For PM (0–1 probabilities), spread is absolute (e.g. 0.04 = 4 cents)
        spread    = fair * self._mm_spread_target if self._is_stock else self._mm_spread_target
        bid_price = fair - spread / 2
        ask_price = fair + spread / 2
        stop      = self.req.stop_loss

        inventory_value = self.position * prob   # current long exposure in $

        if self.position == 0 and self.cash > 0 and not self._on_cooldown():
            if prob <= bid_price:
                # Price crossed our bid — open long leg (simulate bid fill)
                # Size: at most mm_max_inventory × capital
                max_deploy = self.cash * self._mm_max_inventory
                shares = max_deploy / prob
                self._buy_partial(prob, date, shares, max_deploy,
                                  note=f"mm_bid fair={fair:.3f}")
                self._mm_bid_leg = {"entry": prob, "shares": shares}

        elif self.position > 0 and self._mm_bid_leg is not None:
            entry = self._mm_bid_leg["entry"]
            # Exit when price has risen by at least the spread (collected full spread)
            if prob >= entry + spread:
                self._sell(prob, date, note=f"mm_ask collected spread={prob-entry:.3f}")
                self._mm_bid_leg = None
            # Stop: price moved against us by more than 2× the spread
            elif prob <= entry - spread * 2:
                self._sell(prob, date, forced=True, note="mm stop")
                self._mm_bid_leg = None
            elif self._stop_triggered(prob):
                self._sell(prob, date, forced=True, note="stop-loss")
                self._mm_bid_leg = None

    def _xgb_features(self, probs: list) -> np.ndarray | None:
        """
        Build a feature vector from the probability history.
        Requires at least 21 data points (20-tick window + current).
        Features: rolling stats, momentum at multiple lags, volatility,
                  distance from 0.5, time index.
        """
        if len(probs) < 21:
            return None
        arr = np.array(probs, dtype=float)

        # Normalize price-based assets (stocks/crypto) so all features are
        # scale-invariant. PM probabilities (0–1) need no normalization.
        # Dividing by the window mean converts raw prices to relative ratios
        # (1.0 = at mean), making momentum diffs and std percentage-like.
        if self._is_stock:
            ref = arr.mean()
            if ref < 1e-9:
                return None
            arr = arr / ref

        p   = arr[-1]
        w20 = arr[-20:]
        w10 = arr[-10:]
        w5  = arr[-5:]

        mean20 = w20.mean()
        std20  = w20.std() + 1e-9
        z20    = (p - mean20) / std20

        features = [
            p,                                        # current price (normalized ratio for stocks)
            mean20,                                   # 20-tick mean
            std20,                                    # 20-tick std (relative volatility)
            z20,                                      # z-score vs 20-tick mean (scale-invariant)
            w10.mean(),                               # 10-tick mean
            w10.std() + 1e-9,                         # 10-tick std
            w5.mean(),                                # 5-tick mean
            p - arr[-2],                              # 1-tick momentum (relative for stocks)
            p - arr[-4],                              # 3-tick momentum
            p - arr[-6],                              # 5-tick momentum
            p - arr[-11],                             # 10-tick momentum
            p - arr[-21],                             # 20-tick momentum
            abs(z20),                                 # distance from mean in std units (replaces abs(p-0.5))
            1.0 if p > mean20 else 0.0,               # above/below mean flag
            float(np.sum(np.diff(w20) > 0)) / 19,    # directional ratio (% up ticks)
            float(len(probs)),                        # time index (progress)
        ]

        # Append FRED macro features when available (5 normalised values).
        # These are pre-computed and stored on the request by the backtest route.
        macro_feats = getattr(self.req, "macro_features", [])
        if macro_feats:
            features.extend(macro_feats)

        return np.array(features, dtype=float).reshape(1, -1)

    def _xgboost(self, prob: float, date: str):
        """
        XGBoost Gradient Boosting strategy.

        Walk-forward approach — no lookahead bias:
          1. Accumulate probability history.
          2. After xgb_train_frac of the series, train an initial model on
             (features[t], label[t]) where label = 1 if prob[t+1] > prob[t].
          3. For each subsequent tick: predict → trade → optionally retrain.
          4. Enter long when predicted_proba >= xgb_confidence.
          5. Exit when predicted_proba drops below 0.5, or stop-loss hit.

        Parameters (BacktestRequest):
          xgb_n_estimators   int    330   boosting rounds (correction cycles)
          xgb_learning_rate  float  0.1   η — step size per correction
          xgb_max_depth      int    3     tree depth (keep shallow to reduce overfit)
          xgb_train_frac     float  0.30  fraction of series used for initial training
          xgb_retrain_every  int    20    retrain every N ticks on expanded history
          xgb_confidence     float  0.55  min predicted P(up) to enter long
        """
        if not _XGB_AVAILABLE:
            return

        self._xgb_probs.append(prob)
        n        = len(self._xgb_probs)
        n_total  = len(self.history)
        train_n  = max(22, int(n_total * getattr(self.req, "xgb_train_frac", 0.30)))

        # ── Phase 1: accumulate until we have enough history to train ─────────
        if n < train_n + 1:
            return

        # ── Phase 2: initial training (once) ─────────────────────────────────
        retrain_every = getattr(self.req, "xgb_retrain_every", 20)
        if self._xgb_model is None or (n - train_n) % retrain_every == 0:
            X, y = [], []
            probs_so_far = self._xgb_probs[:-1]   # exclude current tick
            for i in range(20, len(probs_so_far) - 1):
                feat = self._xgb_features(probs_so_far[:i+1])
                if feat is None:
                    continue
                label = 1 if probs_so_far[i + 1] > probs_so_far[i] else 0
                X.append(feat[0])
                y.append(label)

            if len(X) < 10:
                return

            X_arr, y_arr = np.array(X), np.array(y)
            # Skip training if only one class present (flat market)
            if len(np.unique(y_arr)) < 2:
                return

            self._xgb_model = XGBClassifier(
                n_estimators=getattr(self.req, "xgb_n_estimators", 330),
                learning_rate=getattr(self.req, "xgb_learning_rate", 0.1),
                max_depth=getattr(self.req, "xgb_max_depth", 3),
                use_label_encoder=False,
                eval_metric="logloss",
                verbosity=0,
                random_state=42,
            )
            self._xgb_model.fit(X_arr, y_arr)

        # ── Phase 3: predict and trade ────────────────────────────────────────
        if self._xgb_model is None:
            return

        feat = self._xgb_features(self._xgb_probs)
        if feat is None:
            return

        try:
            proba_up = float(self._xgb_model.predict_proba(feat)[0][1])
        except Exception:
            return

        confidence = getattr(self.req, "xgb_confidence", 0.55)
        stop       = self.req.stop_loss

        if self.position == 0 and self.cash > 0 and not self._on_cooldown():
            if proba_up >= confidence:
                self._buy(prob, date, note=f"xgb_p={proba_up:.2f}")
        elif self.position > 0:
            if proba_up < 0.50:
                self._sell(prob, date, note=f"xgb_p={proba_up:.2f} exit")
            elif self._stop_triggered(prob):
                self._sell(prob, date, forced=True, note="stop-loss")

    # ── Wizard ────────────────────────────────────────────────────────────────

    def _wizard(self, history: list) -> BacktestResult:
        """
        Run every long strategy on the same (pre-filtered) history, rank by
        total_return, and return the winner's full result with all rankings attached.

        When req.wizard_windows > 1 the history is split into N equal time windows.
        Each window gets its own strategy ranking.  The overall ranking adds a
        `wins` counter (how many windows each strategy topped) and a `consistency`
        score (wins / windows) to guide regime-robust strategy selection.
        Sub-engines receive the already-filtered history with date params cleared
        to avoid double-filtering.
        """
        ALL_STRATEGIES = [
            ("threshold",        "Threshold"),
            ("momentum",         "Momentum Chaser"),
            ("zscore_reversion", "Z-Score Reversion"),
            ("kelly",            "Kelly Criterion"),
            ("mean_reversion",   "Mean Reversion"),
            ("market_making",    "Market Making"),
            ("swing_reversion",  "Swing Reversion"),
            ("short_momentum",   "Short Momentum"),
            ("short_zscore",     "Short Z-Score"),
        ]

        _selected = getattr(self.req, "wizard_strategies", [])
        STRATEGIES = (
            [(sid, sname) for sid, sname in ALL_STRATEGIES if sid in _selected]
            if _selected
            else [(sid, sname) for sid, sname in ALL_STRATEGIES if not sid.startswith("short_")]
        )

        def _run_one_window(window_history: list) -> tuple[list[dict], dict[str, BacktestResult]]:
            """Run all strategies on a single history slice. Returns (rankings, results)."""
            ranks: list[dict] = []
            res:   dict[str, BacktestResult] = {}
            for sid, sname in STRATEGIES:
                try:
                    sub_req = self.req.model_copy(update={"strategy": sid, "date_from": None, "date_to": None})
                    result  = PredictionMarketBacktester(sub_req, window_history).run()
                    if result.success:
                        ranks.append({
                            "strategy":     sid,
                            "name":         sname,
                            "total_return": result.total_return,
                            "sharpe_ratio": result.sharpe_ratio,
                            "max_drawdown": result.max_drawdown,
                            "win_rate":     result.win_rate,
                            "total_trades": result.total_trades,
                        })
                        res[sid] = result
                except Exception as exc:
                    log.warning("wizard: %s failed — %s", sid, exc)
            ranks.sort(key=lambda x: (x["total_return"], x["sharpe_ratio"]), reverse=True)
            return ranks, res

        n_windows = max(1, getattr(self.req, "wizard_windows", 1))

        if n_windows == 1 or len(history) < n_windows * 10:
            # Classic single-window mode
            rankings, results = _run_one_window(history)
            if not rankings:
                return self._error("Wizard: all strategies failed on this history.")
            rankings.sort(key=lambda x: (x["total_return"], x["sharpe_ratio"]), reverse=True)
            winner = results[rankings[0]["strategy"]]
            return BacktestResult(
                success=True,
                condition_id=self.req.condition_id,
                initial_capital=self.req.initial_capital,
                final_value=winner.final_value,
                total_return=winner.total_return,
                sharpe_ratio=winner.sharpe_ratio,
                max_drawdown=winner.max_drawdown,
                total_trades=winner.total_trades,
                win_rate=winner.win_rate,
                equity_curve=winner.equity_curve,
                trades=winner.trades,
                wizard_rankings=rankings,
            )

        # ── Regime mode: split into N windows ─────────────────────────────────
        chunk = len(history) // n_windows
        regime_splits: list[dict] = []
        win_counts:    dict[str, int] = {sid: 0 for sid, _ in STRATEGIES}
        full_rankings, full_results = _run_one_window(history)   # for the overall winner

        for i in range(n_windows):
            start = i * chunk
            end   = start + chunk if i < n_windows - 1 else len(history)
            window = history[start:end]
            if len(window) < 5:
                continue

            # Label window by trend direction (first vs last price)
            try:
                p_start = float(window[0]["p"])
                p_end   = float(window[-1]["p"])
                trend   = "bull" if p_end > p_start * 1.05 else "bear" if p_end < p_start * 0.95 else "sideways"
            except Exception:
                trend = "unknown"

            w_ranks, _ = _run_one_window(window)
            if w_ranks:
                win_counts[w_ranks[0]["strategy"]] += 1
            regime_splits.append({
                "window":    i + 1,
                "start":     window[0].get("t"),
                "end":       window[-1].get("t"),
                "trend":     trend,
                "rankings":  w_ranks,
            })

        # Enrich overall rankings with consistency data
        n_valid = len(regime_splits)
        for r in full_rankings:
            wins = win_counts.get(r["strategy"], 0)
            r["wins"]        = wins
            r["consistency"] = round(wins / n_valid, 2) if n_valid else 0.0

        # Re-sort: weight consistency equally with return
        full_rankings.sort(
            key=lambda x: (x.get("consistency", 0) * 0.5 + (x["total_return"] / 100) * 0.5),
            reverse=True,
        )

        if not full_rankings or full_rankings[0]["strategy"] not in full_results:
            return self._error("Wizard: all strategies failed on this history.")

        winner = full_results[full_rankings[0]["strategy"]]
        return BacktestResult(
            success=True,
            condition_id=self.req.condition_id,
            initial_capital=self.req.initial_capital,
            final_value=winner.final_value,
            total_return=winner.total_return,
            sharpe_ratio=winner.sharpe_ratio,
            max_drawdown=winner.max_drawdown,
            total_trades=winner.total_trades,
            win_rate=winner.win_rate,
            equity_curve=winner.equity_curve,
            trades=winner.trades,
            wizard_rankings=full_rankings,
            regime_splits=regime_splits,
        )

    def _swing_reversion(self, prob: float, date: str):
        """
        Swing Reversion — designed for range-bound oscillations on trending stocks.

        Logic:
          The rolling-high anchor used by Threshold drifts downward on bearish stocks,
          making entries increasingly rare.  This strategy anchors to a short-window
          SMA instead, so entries remain valid throughout the trend.

          Entry:  price falls entry_threshold% below the SMA  →  buy the bounce
          Exit:   price recovers exit_threshold% above the entry price  →  take profit
          Stop:   hard stop_loss% below entry (prevents riding the downtrend)

        Works on stocks only; falls through to nothing on prediction markets
        (which are already 0–1 and don't exhibit the same oscillation pattern).

        Parameters (reuses existing BacktestRequest fields):
          window           int    10    SMA lookback window (candles)
          entry_threshold  float  0.03  % dip below SMA to trigger entry
          exit_threshold   float  0.05  % gain above entry price to take profit
          stop_loss        float  0.02  % loss below entry for hard stop (optional)
        """
        if not self._is_stock:
            return

        window     = self.req.window
        entry_pct  = self.req.entry_threshold   # e.g. 0.03 → enter when 3% below SMA
        target_pct = self.req.exit_threshold    # e.g. 0.05 → exit when 5% above entry
        stop       = self.req.stop_loss

        if len(self.equity_curve) < window:
            return

        recent = [pt["price"] for pt in self.equity_curve[-window:]]
        sma    = sum(recent) / len(recent)

        if self.position == 0 and self.cash > 0 and not self._on_cooldown():
            dip_from_sma = (sma - prob) / sma
            if dip_from_sma >= entry_pct:
                self._buy(prob, date, note=f"dip {dip_from_sma*100:.1f}% below SMA{window}")

        elif self.position > 0:
            gain = (prob - self.avg_entry) / self.avg_entry
            loss = (self.avg_entry - prob) / self.avg_entry
            if gain >= target_pct:
                self._sell(prob, date, note=f"target +{gain*100:.1f}%")
            elif stop is not None and loss >= stop:
                self._sell(prob, date, forced=True, note=f"stop -{loss*100:.1f}%")

    # ── Short strategies ──────────────────────────────────────────────────────

    def _short_momentum(self, prob: float, date: str):
        """
        Short Momentum: short when price is falling, cover when rising.
        Mirror of the long momentum strategy — profits from sustained downtrends.
        Stop loss applied as a % rise above short entry (for stocks).
        """
        if len(self.equity_curve) < 2:
            return
        prev_price = self.equity_curve[-2]["price"]
        falling = prob < prev_price
        stop = self.req.stop_loss

        if self.short_position == 0 and self.position == 0 and self.cash > 0 and not self._on_cooldown():
            if falling:
                self._short_entry(prob, date)
        elif self.short_position > 0:
            if not falling:
                self._short_cover(prob, date)
            elif self._short_stop_triggered(prob):
                self._short_cover(prob, date, forced=True, note="stop-loss")

    def _short_zscore(self, prob: float, date: str):
        """
        Short Z-Score: short overbought conditions (z > +entry_z), cover on reversion.
        Complement to zscore_reversion — longs the dip, this strategy shorts the spike.
        """
        self._zscore_window.append(prob)
        if len(self._zscore_window) < self._zscore_window.maxlen:
            return

        arr  = np.array(self._zscore_window)
        mean = arr.mean()
        std  = arr.std()
        if std < 1e-6:
            return

        z       = (prob - mean) / std
        entry_z = getattr(self.req, "zscore_entry", 1.5)
        exit_z  = getattr(self.req, "zscore_exit",  0.0)
        stop_z  = getattr(self.req, "zscore_stop",  3.0)
        stop    = self.req.stop_loss

        if self.short_position == 0 and self.position == 0 and self.cash > 0 and not self._on_cooldown():
            if z > entry_z:
                self._short_entry(prob, date, note=f"z={z:.2f} overbought")
        elif self.short_position > 0:
            if z <= exit_z:
                self._short_cover(prob, date, note=f"z={z:.2f} reverted")
            elif z > stop_z:
                self._short_cover(prob, date, forced=True, note=f"z={z:.2f} stop")
            elif self._is_stock and stop is not None:
                loss_pct = (prob - self.short_entry) / self.short_entry
                if loss_pct >= stop:
                    self._short_cover(prob, date, forced=True, note=f"loss stop {loss_pct*100:.1f}%")

    # ── Trade execution ───────────────────────────────────────────────────────

    def _short_entry(self, prob: float, date: str, note: str = ""):
        """Sell short — cash acts as margin; notional = cash / prob shares."""
        shares = self.cash / prob
        self.short_position = shares
        self.short_entry = prob
        self._last_buy_idx = self._tick_idx
        self.trades.append({
            "date":   date,
            "action": f"SHORT{(' · ' + note) if note else ''}",
            "price":  round(prob, 4),
            "shares": round(shares, 4),
            "value":  round(shares * prob, 4),
            "pnl":    None,
        })

    def _short_cover(self, prob: float, date: str, forced: bool = False, note: str = ""):
        """Cover a short position — P&L = (entry - cover) * shares.
        Cash was never reduced on entry (margin model), so only add the realized gain/loss."""
        pnl = (self.short_entry - prob) * self.short_position
        self.cash += pnl
        action = "COVER (forced)" if forced else "COVER"
        if note:
            action += f" · {note}"
        self.trades.append({
            "date":   date,
            "action": action,
            "price":  round(prob, 4),
            "shares": round(self.short_position, 4),
            "value":  round(self.short_position * prob, 4),
            "pnl":    round(pnl, 4),
        })
        self.short_position = 0.0
        self.short_entry = 0.0

    def _macro_stock_gate(self) -> tuple[bool, float]:
        """
        Macro regime gate for stock/index entries only.
        Returns (allow_entry, size_multiplier).

        Only active when _is_stock is True.  Prediction markets skip this —
        they use macro_zscore_mult and macro_kelly_caution directly instead.

        Rules (applied in order, first match wins):
          recession_risk=high                          → block all new longs
          recession_risk=medium + tightening Fed       → allow, size ×0.50
          recession_risk=medium                        → allow, size ×0.65
          tightening + above_target inflation          → allow, size ×0.70
          tightening                                   → allow, size ×0.85
          above_target inflation + rising trend        → allow, size ×0.80
          everything else (benign)                     → allow, size ×1.00
        """
        if not self._is_stock:
            return True, 1.0

        recession = getattr(self.req, "macro_recession_risk", "unknown")
        fed       = getattr(self.req, "macro_fed_stance",     "unknown")
        inflation = getattr(self.req, "macro_inflation",      "unknown")

        if recession == "high":
            return False, 0.0
        if recession == "medium" and fed == "tightening":
            return True, 0.50
        if recession == "medium":
            return True, 0.65
        if fed == "tightening" and inflation == "above_target":
            return True, 0.70
        if fed == "tightening":
            return True, 0.85
        if inflation == "above_target":
            return True, 0.80
        return True, 1.0

    def _on_cooldown(self) -> bool:
        """Return True if not enough candles have passed since the last buy."""
        min_hold = getattr(self.req, "min_hold_days", 1)
        return (self._tick_idx - self._last_buy_idx) < min_hold

    def _stop_triggered(self, prob: float) -> bool:
        """
        Unified stop-loss check for long positions.

        PM (price 0–1): fires when current probability falls below the absolute
        stop_loss level (e.g. stop=0.05 means exit at 5¢).

        Stocks / crypto (price > 1): fires when percentage loss from entry exceeds
        stop_loss (e.g. stop=0.10 means exit on 10% loss from avg_entry).

        Returns False when stop_loss is None or no position is held.
        """
        stop = self.req.stop_loss
        if stop is None or self.position == 0:
            return False
        if self._is_stock:
            return (self.avg_entry - prob) / self.avg_entry >= stop
        return prob <= stop

    def _short_stop_triggered(self, prob: float) -> bool:
        """
        Unified stop-loss check for short positions.

        PM: fires when price rises by stop_loss above the short entry.
        Stocks / crypto: fires when percentage rise from short entry >= stop_loss.
        """
        stop = self.req.stop_loss
        if stop is None or self.short_position == 0:
            return False
        if self._is_stock:
            return (prob - self.short_entry) / self.short_entry >= stop
        return prob >= self.short_entry + stop

    def _fill_price(self, raw_price: float, side: str) -> float:
        """
        Apply one-way slippage to a raw mid-price.
        BUY  fills at raw_price * (1 + slip)  — you pay more.
        SELL fills at raw_price * (1 - slip)  — you receive less.
        slip = slippage_bps / 10_000
        """
        slip = self.req.slippage_bps / 10_000
        if side == "BUY":
            return raw_price * (1.0 + slip)
        return raw_price * (1.0 - slip)

    def _buy(self, prob: float, date: str, note: str = ""):
        """Deploy all available cash into YES shares."""
        fill = self._fill_price(prob, "BUY")
        shares = self.cash / fill
        self.avg_entry = fill
        self.position  = shares
        self.cash      = 0.0
        self._last_buy_idx = self._tick_idx
        self.trades.append({
            "date":   date,
            "action": f"BUY{(' · ' + note) if note else ''}",
            "price":  round(fill, 4),
            "shares": round(shares, 4),
            "value":  round(shares * fill, 4),
            "pnl":    None,
        })

    def _buy_partial(self, prob: float, date: str, shares: float, cost: float, note: str = ""):
        """Deploy a specific amount of cash — used by Kelly and Market Making."""
        fill = self._fill_price(prob, "BUY")
        # Recalculate shares and cost using fill price
        shares = cost / fill
        if cost > self.cash:
            cost   = self.cash
            shares = cost / fill
        self.avg_entry = (
            (self.avg_entry * self.position + fill * shares)
            / (self.position + shares)
            if self.position > 0 else fill
        )
        self.position += shares
        self.cash     -= cost
        self._last_buy_idx = self._tick_idx
        self.trades.append({
            "date":   date,
            "action": f"BUY{(' · ' + note) if note else ''}",
            "price":  round(fill, 4),
            "shares": round(shares, 4),
            "value":  round(cost, 4),
            "pnl":    None,
        })

    def _sell(self, prob: float, date: str, forced: bool = False, note: str = ""):
        fill = self._fill_price(prob, "SELL")
        pnl = (fill - self.avg_entry) * self.position
        # Use += not = : for full positions cash is already 0 (no change in behavior),
        # but for partial positions (_buy_partial via Kelly/Market Making) the
        # undeployed cash must survive the sell.
        self.cash += self.position * fill
        action = "SELL (forced close)" if forced else "SELL"
        if note:
            action += f" · {note}"
        self.trades.append({
            "date":   date,
            "action": action,
            "price":  round(fill, 4),
            "shares": round(self.position, 4),
            "value":  round(self.position * fill, 4),
            "pnl":    round(pnl, 4),
        })
        self.position  = 0.0
        self.avg_entry = 0.0

    # ── Metrics ───────────────────────────────────────────────────────────────

    @staticmethod
    def _annualization_factor(history: list) -> float:
        """
        Derive periods-per-year from actual history timestamps instead of
        assuming 252 trading days.  Works correctly for daily, 6h, 1h candles
        and prediction-market tick data.

        Method: total candle count divided by the time span in years.
        Falls back to 252 if history is too short to measure reliably.
        """
        timestamps = [pt["t"] for pt in history if "t" in pt]
        if len(timestamps) < 10:
            return 252.0
        span_years = (timestamps[-1] - timestamps[0]) / (365.25 * 24 * 3600)
        if span_years < 0.01:
            return 252.0
        return len(timestamps) / span_years

    @staticmethod
    def _sharpe(returns: pd.Series, rf: float = 0.02, ann_factor: float = 252.0) -> float:
        if len(returns) < 2 or returns.std() == 0:
            return 0.0
        excess = returns - rf / ann_factor
        return float(np.sqrt(ann_factor) * excess.mean() / excess.std())

    @staticmethod
    def _max_drawdown(equity: pd.Series) -> float:
        cummax = equity.cummax()
        dd = (equity - cummax) / cummax
        return float(abs(dd.min()))

    def _win_rate(self) -> float:
        closes = [t for t in self.trades if (t["action"].startswith("SELL") or t["action"].startswith("COVER")) and t.get("pnl") is not None]
        if not closes:
            return 0.0
        return sum(1 for t in closes if t["pnl"] > 0) / len(closes)

    def _recent_win_rate(self, n: int = 10) -> float:
        """Win rate over last n closed trades — used by Kelly to estimate p_win."""
        sells = [t for t in self.trades if t["action"].startswith("SELL") and t.get("pnl") is not None]
        if not sells:
            return 0.55   # prior: slight edge assumed
        recent = sells[-n:]
        return sum(1 for t in recent if t["pnl"] > 0) / len(recent)

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _ts_to_date(ts: int) -> str:
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")

    def _error(self, msg: str) -> BacktestResult:
        return BacktestResult(
            success=False,
            error=msg,
            condition_id=self.req.condition_id,
            initial_capital=self.req.initial_capital,
            final_value=self.req.initial_capital,
            total_return=0, sharpe_ratio=0, max_drawdown=0,
            total_trades=0, win_rate=0,
            equity_curve=[], trades=[],
        )
