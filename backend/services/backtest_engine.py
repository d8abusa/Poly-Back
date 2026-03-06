"""
Prediction market backtest engine.

In prediction markets prices = probabilities (0–1).
A YES contract bought at price p pays $1 on YES resolution, $0 on NO.

For backtesting we treat positions as tradeable (enter/exit before resolution),
measuring P&L as (exit_price - entry_price) × shares.
This mirrors how market makers and active traders operate on Polymarket.
"""

import numpy as np
import pandas as pd
from datetime import datetime, timezone
from typing import List

from ..models.schemas import BacktestRequest, BacktestResult


class PredictionMarketBacktester:
    def __init__(self, request: BacktestRequest, history: List[dict]):
        self.req = request
        self.history = history       # [{t: unix_ts, p: probability}]
        self.cash = request.initial_capital
        self.position = 0.0          # YES shares held
        self.avg_entry = 0.0
        self.trades: list = []
        self.equity_curve: list = []

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

        # Force-close any open position at last price
        if self.position > 0:
            last = self.history[-1]
            self._sell(float(last["p"]), self._ts_to_date(int(last["t"])), forced=True)

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

    # ── Trade execution ───────────────────────────────────────────────────────

    def _buy(self, prob: float, date: str):
        shares = self.cash / prob
        self.avg_entry = prob
        self.position = shares
        self.cash = 0.0
        self.trades.append({
            "date": date,
            "action": "BUY",
            "price": round(prob, 4),
            "shares": round(shares, 4),
            "value": round(shares * prob, 4),
            "pnl": None,
        })

    def _sell(self, prob: float, date: str, forced: bool = False):
        pnl = (prob - self.avg_entry) * self.position
        self.cash = self.position * prob
        self.trades.append({
            "date": date,
            "action": "SELL" if not forced else "SELL (forced close)",
            "price": round(prob, 4),
            "shares": round(self.position, 4),
            "value": round(self.position * prob, 4),
            "pnl": round(pnl, 4),
        })
        self.position = 0.0
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
