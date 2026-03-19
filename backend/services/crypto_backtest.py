"""
Crypto backtest engine — intraday strategy simulation on Coinbase candle data.

Differences from prediction-market backtest:
  - Prices are real dollar values (not 0-1 probabilities)
  - Z-score is computed on log returns (scale-invariant across assets/prices)
  - Positions are sized in USD (quote_size), converted to fractional crypto
  - Long-only (Coinbase spot — no shorting)
  - Supports intraday intervals: 1m, 5m, 15m, 30m, 1h, 6h, 1d

Strategies supported:
  zscore_reversion  — buy when return z-score < -entry_z, sell at exit_z
  momentum          — buy when return z-score > +entry_z, sell at exit_z
  threshold         — buy when price drops X% from rolling high, sell at recovery
"""

import logging
import math
from dataclasses import dataclass, field
from typing import Optional

log = logging.getLogger(__name__)

# Minimum candles needed before any trade can be made
MIN_CANDLES = 10


@dataclass
class CryptoBacktestRequest:
    product_id:      str            # e.g. "BTC-USD"
    strategy:        str   = "zscore_reversion"
    interval:        str   = "1h"
    initial_capital: float = 1000.0
    position_pct:    float = 0.50   # fraction of capital per trade (0.5 = 50%)

    # Z-score params (zscore_reversion / momentum)
    zscore_window:   int   = 20
    zscore_entry:    float = 1.5    # enter when |z| > this
    zscore_exit:     float = 0.5    # exit when |z| < this
    zscore_stop:     float = 3.5    # emergency stop when |z| > this (trend too strong)

    # Threshold params (threshold strategy)
    entry_pct:       float = 0.03   # buy when price drops 3% from rolling high
    exit_pct:        float = 0.02   # sell when price recovers 2% from entry
    stop_pct:        float = 0.04   # stop-loss if price drops 4% from entry


@dataclass
class _Trade:
    entry_idx:   int
    entry_price: float
    entry_time:  int
    size_usd:    float
    shares:      float
    exit_idx:    int    = 0
    exit_price:  float  = 0.0
    exit_time:   int    = 0
    exit_reason: str    = ""
    pnl:         float  = 0.0
    ret:         float  = 0.0


@dataclass
class CryptoBacktestResult:
    success:         bool
    error:           Optional[str]   = None
    product_id:      str             = ""
    interval:        str             = ""
    strategy:        str             = ""
    candles:         int             = 0
    initial_capital: float           = 0.0
    final_value:     float           = 0.0
    total_return:    float           = 0.0
    sharpe_ratio:    float           = 0.0
    max_drawdown:    float           = 0.0
    total_trades:    int             = 0
    winning_trades:  int             = 0
    win_rate:        float           = 0.0
    avg_return:      float           = 0.0
    equity_curve:    list            = field(default_factory=list)
    trades:          list            = field(default_factory=list)


def _log_returns(prices: list[float]) -> list[float]:
    """Compute log returns: r_t = log(p_t / p_{t-1})."""
    returns = []
    for i in range(1, len(prices)):
        if prices[i - 1] > 0 and prices[i] > 0:
            returns.append(math.log(prices[i] / prices[i - 1]))
        else:
            returns.append(0.0)
    return returns


def _rolling_zscore(values: list[float], window: int, idx: int) -> Optional[float]:
    """Z-score of values[idx] relative to values[idx-window:idx]."""
    if idx < window:
        return None
    window_vals = values[idx - window: idx]
    n = len(window_vals)
    if n < 2:
        return None
    mean = sum(window_vals) / n
    var = sum((v - mean) ** 2 for v in window_vals) / (n - 1)
    std = math.sqrt(var) if var > 0 else None
    if std is None or std < 1e-10:
        return None
    return (values[idx] - mean) / std


def _rolling_high(prices: list[float], window: int, idx: int) -> float:
    start = max(0, idx - window)
    return max(prices[start:idx + 1])


def run_crypto_backtest(
    req: CryptoBacktestRequest,
    candle_data: list[dict],   # [{t: unix_ts, p: price}, ...] ascending
) -> CryptoBacktestResult:
    """
    Run a crypto backtest on pre-fetched candle data.
    candle_data must be sorted oldest-first.
    """

    def _err(msg: str) -> CryptoBacktestResult:
        return CryptoBacktestResult(success=False, error=msg,
                                    product_id=req.product_id,
                                    interval=req.interval,
                                    strategy=req.strategy)

    if not candle_data or len(candle_data) < MIN_CANDLES:
        return _err(f"Insufficient candle data ({len(candle_data)} candles, need {MIN_CANDLES}+)")

    prices = [float(c["p"]) for c in candle_data]
    times  = [int(c["t"])   for c in candle_data]
    n      = len(prices)

    # ── Compute log returns ────────────────────────────────────────────────
    rets = _log_returns(prices)  # len = n-1; rets[i] corresponds to prices[i+1]

    # ── Simulation state ───────────────────────────────────────────────────
    cash      = req.initial_capital
    position  = None      # _Trade or None
    trades:   list[_Trade] = []
    equity:   list[dict]   = []
    peak_val  = req.initial_capital

    def _portfolio_value(idx: int) -> float:
        if position is None:
            return cash
        return cash + position.shares * prices[idx]

    def _enter(idx: int) -> None:
        nonlocal cash, position
        if position is not None:
            return  # already in a trade
        size_usd = cash * req.position_pct
        if size_usd < 1.0:
            return
        shares = size_usd / prices[idx]
        cost   = shares * prices[idx]
        cash  -= cost
        position = _Trade(
            entry_idx=idx, entry_price=prices[idx],
            entry_time=times[idx], size_usd=size_usd, shares=shares,
        )

    def _exit(idx: int, reason: str) -> None:
        nonlocal cash, position
        if position is None:
            return
        proceeds        = position.shares * prices[idx]
        cash           += proceeds
        pnl             = proceeds - position.size_usd
        ret             = pnl / position.size_usd
        position.exit_idx   = idx
        position.exit_price = prices[idx]
        position.exit_time  = times[idx]
        position.exit_reason = reason
        position.pnl        = pnl
        position.ret        = ret
        trades.append(position)
        position = None

    # ── Strategy loop ──────────────────────────────────────────────────────
    strat = req.strategy.lower()

    for i in range(req.zscore_window + 1, n):
        # ret index: rets[i-1] = log(prices[i] / prices[i-1])
        ret_idx = i - 1  # index into rets array (len = n-1)

        if strat in ("zscore_reversion", "mean_reversion", "zscore"):
            if ret_idx >= len(rets):
                continue
            z = _rolling_zscore(rets, req.zscore_window, ret_idx)
            if z is None:
                continue

            if position is None:
                # Buy the dip: abnormally large negative return → expect reversion
                if z < -req.zscore_entry:
                    _enter(i)
            else:
                # Exit: z reverted toward zero OR emergency stop (trend too strong)
                if z > -req.zscore_exit:
                    _exit(i, "zscore_exit")
                elif z < -req.zscore_stop:
                    _exit(i, "zscore_stop")
                # Also apply price-based stop: if down >stop_pct% from entry, exit
                elif prices[i] < position.entry_price * (1 - req.stop_pct):
                    _exit(i, "price_stop")

        elif strat == "momentum":
            if ret_idx >= len(rets):
                continue
            z = _rolling_zscore(rets, req.zscore_window, ret_idx)
            if z is None:
                continue

            if position is None:
                # Chase the rip: abnormally large positive return → momentum continues
                if z > req.zscore_entry:
                    _enter(i)
            else:
                # Exit when momentum fades
                if z < req.zscore_exit:
                    _exit(i, "momentum_fade")
                elif prices[i] < position.entry_price * (1 - req.stop_pct):
                    _exit(i, "price_stop")

        elif strat == "threshold":
            window = min(req.zscore_window, i)
            rolling_high = _rolling_high(prices, window, i - 1)

            if position is None:
                if rolling_high > 0 and prices[i] < rolling_high * (1 - req.entry_pct):
                    _enter(i)
            else:
                if prices[i] >= position.entry_price * (1 + req.exit_pct):
                    _exit(i, "target_hit")
                elif prices[i] < position.entry_price * (1 - req.stop_pct):
                    _exit(i, "stop_loss")

        # Track equity
        val = _portfolio_value(i)
        peak_val = max(peak_val, val)
        equity.append({"t": times[i], "v": round(val, 4), "p": round(prices[i], 4)})

    # Close any open position at last price
    if position is not None:
        _exit(n - 1, "end_of_data")

    # ── Compute statistics ─────────────────────────────────────────────────
    final_val    = cash
    total_return = (final_val - req.initial_capital) / req.initial_capital

    rets_list    = [t.ret for t in trades]
    winning      = [r for r in rets_list if r > 0]
    win_rate     = len(winning) / len(rets_list) if rets_list else 0.0
    avg_ret      = sum(rets_list) / len(rets_list) if rets_list else 0.0

    if len(rets_list) > 1:
        std_r = math.sqrt(sum((r - avg_ret) ** 2 for r in rets_list) / len(rets_list))
        sharpe = (avg_ret / std_r) * math.sqrt(365 * 24) if std_r > 0 else 0.0
    else:
        sharpe = 0.0

    # Max drawdown from equity curve
    peak = req.initial_capital
    max_dd = 0.0
    for e in equity:
        peak = max(peak, e["v"])
        dd = (peak - e["v"]) / peak if peak > 0 else 0
        max_dd = max(max_dd, dd)

    trades_out = [
        {
            "entry_time":  t.entry_time,
            "exit_time":   t.exit_time,
            "entry_price": round(t.entry_price, 4),
            "exit_price":  round(t.exit_price, 4),
            "size_usd":    round(t.size_usd, 2),
            "shares":      round(t.shares, 8),
            "pnl":         round(t.pnl, 4),
            "return":      round(t.ret * 100, 2),
            "reason":      t.exit_reason,
        }
        for t in trades
    ]

    return CryptoBacktestResult(
        success=True,
        product_id=req.product_id,
        interval=req.interval,
        strategy=req.strategy,
        candles=n,
        initial_capital=req.initial_capital,
        final_value=round(final_val, 4),
        total_return=round(total_return * 100, 4),
        sharpe_ratio=round(sharpe, 4),
        max_drawdown=round(max_dd * 100, 4),
        total_trades=len(trades),
        winning_trades=len(winning),
        win_rate=round(win_rate * 100, 2),
        avg_return=round(avg_ret * 100, 4),
        equity_curve=equity,
        trades=trades_out,
    )
