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
        self._mr_window: deque = deque(maxlen=getattr(request, "lookback_window", 15))

        # Kelly: tracks consecutive wins/losses for fractional sizing
        self._kelly_last_pnls: deque = deque(maxlen=20)

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

        for pt in self.history:
            prob = float(pt["p"])
            date = self._ts_to_date(int(pt["t"]))

            portfolio_val = self.cash + self.position * prob
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

        # Force-close any open position at last price
        if self.position > 0:
            last = self.history[-1]
            self._sell(float(last["p"]), self._ts_to_date(int(last["t"])), forced=True)

        # Market making: close any open bid leg
        if self._mm_bid_leg is not None and self.position > 0:
            last = self.history[-1]
            self._sell(float(last["p"]), self._ts_to_date(int(last["t"])), forced=True)
            self._mm_bid_leg = None

        equity_series = pd.Series([pt["value"] for pt in self.equity_curve])
        daily_ret = equity_series.pct_change().dropna()

        return BacktestResult(
            success=True,
            condition_id=self.req.condition_id,
            initial_capital=self.req.initial_capital,
            final_value=round(self.cash, 4),
            total_return=round((self.cash - self.req.initial_capital) / self.req.initial_capital * 100, 2),
            sharpe_ratio=round(self._sharpe(daily_ret), 3),
            max_drawdown=round(self._max_drawdown(equity_series) * 100, 2),
            total_trades=len(self.trades),
            win_rate=round(self._win_rate() * 100, 2),
            equity_curve=self.equity_curve,
            trades=self.trades,
        )

    # ── Strategies ────────────────────────────────────────────────────────────

    def _threshold(self, prob: float, date: str):
        """Buy when prob ≤ entry, sell when prob ≥ exit or stop-loss hit."""
        stop = self.req.stop_loss
        if prob <= self.req.entry_threshold and self.position == 0 and self.cash > 0:
            self._buy(prob, date)
        elif self.position > 0:
            if prob >= self.req.exit_threshold:
                self._sell(prob, date)
            elif stop is not None and prob <= stop:
                self._sell(prob, date, forced=True)

    def _momentum(self, prob: float, date: str):
        """
        Simple momentum: buy when prob is rising, sell when falling.
        Requires at least 2 points of history to detect direction.
        """
        if len(self.equity_curve) < 2:
            return
        prev_price = self.equity_curve[-2]["price"]
        rising = prob > prev_price
        if rising and self.position == 0 and self.cash > 0:
            self._buy(prob, date)
        elif not rising and self.position > 0:
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

        if self.position == 0 and self.cash > 0:
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
            elif stop is not None and prob <= stop:
                self._sell(prob, date, forced=True, note="prob stop-loss")

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
        threshold = getattr(self.req, "reversion_threshold", 2.0)
        stop      = self.req.stop_loss

        if self.position == 0 and self.cash > 0:
            if deviation < -threshold:
                self._buy(prob, date, note=f"dev={deviation:.2f}")
        elif self.position > 0:
            if deviation >= 0.0:
                self._sell(prob, date, note=f"dev={deviation:.2f} reverted")
            elif stop is not None and prob <= stop:
                self._sell(prob, date, forced=True, note="prob stop-loss")

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

        if self.position == 0 and self.cash > 0:
            if prob <= self.req.entry_threshold:
                # Estimate edge: target outcome is prob reaching exit_threshold
                b = (self.req.exit_threshold / prob) - 1.0   # net odds per share
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
        spread    = self._mm_spread_target
        bid_price = fair - spread / 2
        ask_price = fair + spread / 2
        stop      = self.req.stop_loss

        inventory_value = self.position * prob   # current long exposure in $

        if self.position == 0 and self.cash > 0:
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
            elif stop is not None and prob <= stop:
                self._sell(prob, date, forced=True, note="prob stop-loss")
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
        p   = arr[-1]
        w20 = arr[-20:]
        w10 = arr[-10:]
        w5  = arr[-5:]

        mean20 = w20.mean()
        std20  = w20.std() + 1e-9
        z20    = (p - mean20) / std20

        features = [
            p,                                        # current prob
            mean20,                                   # 20-tick mean
            std20,                                    # 20-tick std (volatility)
            z20,                                      # z-score vs 20-tick mean
            w10.mean(),                               # 10-tick mean
            w10.std() + 1e-9,                         # 10-tick std
            w5.mean(),                                # 5-tick mean
            p - arr[-2],                              # 1-tick momentum
            p - arr[-4],                              # 3-tick momentum
            p - arr[-6],                              # 5-tick momentum
            p - arr[-11],                             # 10-tick momentum
            p - arr[-21],                             # 20-tick momentum
            abs(p - 0.5),                             # anchoring distance
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

        if self.position == 0 and self.cash > 0:
            if proba_up >= confidence:
                self._buy(prob, date, note=f"xgb_p={proba_up:.2f}")
        elif self.position > 0:
            if proba_up < 0.50:
                self._sell(prob, date, note=f"xgb_p={proba_up:.2f} exit")
            elif stop is not None and prob <= stop:
                self._sell(prob, date, forced=True, note="prob stop-loss")

    # ── Trade execution ───────────────────────────────────────────────────────

    def _buy(self, prob: float, date: str, note: str = ""):
        """Deploy all available cash into YES shares."""
        shares = self.cash / prob
        self.avg_entry = prob
        self.position  = shares
        self.cash      = 0.0
        self.trades.append({
            "date":   date,
            "action": f"BUY{(' · ' + note) if note else ''}",
            "price":  round(prob, 4),
            "shares": round(shares, 4),
            "value":  round(shares * prob, 4),
            "pnl":    None,
        })

    def _buy_partial(self, prob: float, date: str, shares: float, cost: float, note: str = ""):
        """Deploy a specific amount of cash — used by Kelly and Market Making."""
        if cost > self.cash:
            cost   = self.cash
            shares = cost / prob
        self.avg_entry = (
            (self.avg_entry * self.position + prob * shares)
            / (self.position + shares)
            if self.position > 0 else prob
        )
        self.position += shares
        self.cash     -= cost
        self.trades.append({
            "date":   date,
            "action": f"BUY{(' · ' + note) if note else ''}",
            "price":  round(prob, 4),
            "shares": round(shares, 4),
            "value":  round(cost, 4),
            "pnl":    None,
        })

    def _sell(self, prob: float, date: str, forced: bool = False, note: str = ""):
        pnl = (prob - self.avg_entry) * self.position
        self.cash = self.position * prob
        action = "SELL (forced close)" if forced else "SELL"
        if note:
            action += f" · {note}"
        self.trades.append({
            "date":   date,
            "action": action,
            "price":  round(prob, 4),
            "shares": round(self.position, 4),
            "value":  round(self.position * prob, 4),
            "pnl":    round(pnl, 4),
        })
        self.position  = 0.0
        self.avg_entry = 0.0

    # ── Metrics ───────────────────────────────────────────────────────────────

    @staticmethod
    def _sharpe(returns: pd.Series, rf: float = 0.02) -> float:
        if len(returns) < 2 or returns.std() == 0:
            return 0.0
        excess = returns - rf / 252
        return float(np.sqrt(252) * excess.mean() / excess.std())

    @staticmethod
    def _max_drawdown(equity: pd.Series) -> float:
        cummax = equity.cummax()
        dd = (equity - cummax) / cummax
        return float(abs(dd.min()))

    def _win_rate(self) -> float:
        sells = [t for t in self.trades if t["action"].startswith("SELL") and t.get("pnl") is not None]
        if not sells:
            return 0.0
        return sum(1 for t in sells if t["pnl"] > 0) / len(sells)

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
