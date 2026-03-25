"""
Kelly Criterion — dip-threshold sensitivity sweep.

Runs the Kelly backtest at dip thresholds of 5 %, 10 %, and 15 % on a chosen
asset and writes results to kelly_threshold_sweep.csv.

Usage:
    cd /home/robert-nichols/quant_project/Polymarket
    python -m tools.quant_improvement.kelly_threshold_sweep --asset BTC-USD --period 5y

The script fetches price history directly via yfinance (no server required) and
calls the backtest engine in-process.

Metrics logged per threshold:
  - entry_count       : number of positions opened
  - total_return_pct  : cumulative return on $1 000 capital
  - sharpe            : annualised Sharpe (sqrt-252 daily)
  - max_drawdown_pct  : worst peak-to-trough decline in equity curve
"""

import argparse
import csv
import sys
from pathlib import Path

# Allow running as `python -m tools.quant_improvement.kelly_threshold_sweep`
# from the project root without installing the package.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

import numpy as np
import yfinance as yf

from backend.models.schemas import BacktestRequest
from backend.services.backtest_engine import PredictionMarketBacktester

_PERIOD_MAP = {
    "1y": "1y",
    "2y": "2y",
    "5y": "5y",
    "max": "max",
}


def fetch_history(ticker: str, period: str) -> list[dict]:
    """Return [{t, p}, ...] for the given ticker and period (daily candles)."""
    df = yf.Ticker(ticker).history(period=_PERIOD_MAP.get(period, "5y"), interval="1d", auto_adjust=True)
    if df is None or df.empty:
        raise SystemExit(f"No data returned for {ticker!r}")
    pts = []
    for ts, price in df["Close"].dropna().items():
        try:
            pts.append({"t": int(ts.timestamp()), "p": round(float(price), 4)})
        except Exception:
            pass
    return sorted(pts, key=lambda x: x["t"])


def max_drawdown(equity: list[float]) -> float:
    """Return max peak-to-trough drawdown as a positive fraction."""
    peak = equity[0]
    worst = 0.0
    for v in equity:
        peak = max(peak, v)
        dd = (peak - v) / peak if peak > 0 else 0.0
        worst = max(worst, dd)
    return worst


def run_sweep(
    ticker: str,
    period: str,
    thresholds: list[float],
    initial_capital: float = 1000.0,
    kelly_fraction: float = 0.5,
    kelly_min_roi: float = 0.002,   # 0.2 % minimum expected ROI guard
    exit_threshold: float = 0.20,   # 20 % gain target for stocks
    stop_loss: float = 0.08,        # 8 % hard stop
) -> list[dict]:
    print(f"\nFetching history: {ticker}  period={period}")
    history = fetch_history(ticker, period)
    print(f"  {len(history)} daily candles  "
          f"price range ${history[0]['p']:,.0f} → ${history[-1]['p']:,.0f}")

    rows = []
    for thr in thresholds:
        req = BacktestRequest(
            condition_id=ticker,
            token_id=ticker,
            strategy="kelly",
            entry_threshold=thr,          # used by PM path; stock path uses kelly_dip_threshold
            kelly_dip_threshold=thr,      # explicit override for stock/crypto
            exit_threshold=exit_threshold,
            stop_loss=stop_loss,
            initial_capital=initial_capital,
            kelly_fraction=kelly_fraction,
            kelly_min_roi=kelly_min_roi,
            interval="1d",
        )
        engine = PredictionMarketBacktester(req, history)
        result = engine.run()

        # Extract equity curve from trades to compute max drawdown
        eq = [initial_capital]
        for trade in result.trades:
            pnl = trade.get("pnl", 0.0) or 0.0
            eq.append(eq[-1] + pnl)
        mdd = max_drawdown(eq)

        row = {
            "threshold_pct":    round(thr * 100, 1),
            "entry_count":      result.total_trades,
            "total_return_pct": round(result.total_return, 2),   # already a percentage
            "sharpe":           round(result.sharpe_ratio, 3),
            "max_drawdown_pct": round(mdd * 100, 2),
            "win_rate_pct":     round(result.win_rate * 100, 1) if result.win_rate else 0.0,
        }
        rows.append(row)
        print(
            f"  threshold={thr*100:.0f}%  entries={row['entry_count']:2d}  "
            f"return={row['total_return_pct']:+.1f}%  sharpe={row['sharpe']:.2f}  "
            f"maxDD={row['max_drawdown_pct']:.1f}%"
        )

    return rows


def main():
    parser = argparse.ArgumentParser(description="Kelly dip-threshold sensitivity sweep")
    parser.add_argument("--asset",  default="BTC-USD",       help="yfinance ticker (e.g. BTC-USD, AAPL)")
    parser.add_argument("--period", default="5y",            help="History period (1y/2y/5y/max)")
    parser.add_argument("--thresholds", default="5,10,15",   help="Comma-separated dip %% values")
    parser.add_argument("--capital",    type=float, default=1000.0)
    parser.add_argument("--out",    default="kelly_threshold_sweep.csv")
    args = parser.parse_args()

    thresholds = [float(t) / 100.0 for t in args.thresholds.split(",")]
    rows = run_sweep(args.asset, args.period, thresholds, initial_capital=args.capital)

    out_path = Path(args.out)
    with open(out_path, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nResults written to {out_path.resolve()}")

    # Simple recommendation
    best = max(rows, key=lambda r: r["sharpe"])
    print(f"\nRecommended threshold: {best['threshold_pct']:.0f}%  "
          f"(Sharpe={best['sharpe']:.2f}, entries={best['entry_count']})")


if __name__ == "__main__":
    main()
