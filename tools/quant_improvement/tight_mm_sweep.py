"""
Market-Making spread sensitivity sweep.

Compares the current 4 % spread (trend-capture variant) against realistic
0.02 % – 0.10 % spreads to determine whether a true MM edge exists.

Usage:
    cd /home/robert-nichols/quant_project/Polymarket
    python -m tools.quant_improvement.tight_mm_sweep --asset BTC-USD --period 5y

Spreads tested: 0.02 %, 0.04 %, 0.10 %, 0.25 %, 1.0 %, 4.0 % (current default)

Metrics per spread:
  - entry_count       : fills (round-trips)
  - total_return_pct
  - sharpe
  - max_drawdown_pct
  - win_rate_pct
  - avg_hold_days     : average candles held per position

Interpretation guide (printed at end):
  - tight spreads (≤ 0.10 %) with good Sharpe → genuine MM edge
  - good returns only at wide spreads (≥ 1 %) → trend-capture, document as such
"""

import argparse
import csv
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

import yfinance as yf

from backend.models.schemas import BacktestRequest
from backend.services.backtest_engine import PredictionMarketBacktester


def fetch_history(ticker: str, period: str) -> list[dict]:
    df = yf.Ticker(ticker).history(period=period, interval="1d", auto_adjust=True)
    if df is None or df.empty:
        raise SystemExit(f"No data for {ticker!r}")
    pts = []
    for ts, price in df["Close"].dropna().items():
        try:
            pts.append({"t": int(ts.timestamp()), "p": round(float(price), 4)})
        except Exception:
            pass
    return sorted(pts, key=lambda x: x["t"])


def max_drawdown(equity: list[float]) -> float:
    peak, worst = equity[0], 0.0
    for v in equity:
        peak = max(peak, v)
        worst = max(worst, (peak - v) / peak if peak > 0 else 0.0)
    return worst


def run_sweep(
    ticker: str,
    period: str,
    spreads: list[float],
    initial_capital: float = 1000.0,
) -> list[dict]:
    print(f"\nFetching history: {ticker}  period={period}")
    history = fetch_history(ticker, period)
    print(f"  {len(history)} daily candles  "
          f"${history[0]['p']:,.0f} → ${history[-1]['p']:,.0f}")

    rows = []
    for spread in spreads:
        req = BacktestRequest(
            condition_id=ticker,
            token_id=ticker,
            strategy="market_making",
            mm_spread=spread,
            initial_capital=initial_capital,
            interval="1d",
            stop_loss=0.08,
        )
        engine = PredictionMarketBacktester(req, history)
        result = engine.run()

        eq = [initial_capital]
        for trade in result.trades:
            eq.append(eq[-1] + (trade.get("pnl", 0.0) or 0.0))
        mdd = max_drawdown(eq)

        # Average hold duration from trades (entry/exit dates)
        hold_days = []
        for trade in result.trades:
            entry_t = trade.get("entry_t") or trade.get("entry_date")
            exit_t  = trade.get("exit_t")  or trade.get("exit_date")
            if entry_t and exit_t:
                try:
                    hold_days.append(abs(int(exit_t) - int(entry_t)) // 86400)
                except Exception:
                    pass
        avg_hold = round(sum(hold_days) / len(hold_days), 1) if hold_days else 0.0

        row = {
            "spread_pct":        round(spread * 100, 4),
            "entry_count":        result.total_trades,
            "total_return_pct":   round(result.total_return, 2),    # already a percentage
            "sharpe":             round(result.sharpe_ratio, 3),
            "max_drawdown_pct":   round(mdd * 100, 2),
            "win_rate_pct":       round((result.win_rate or 0.0) * 100, 1),
            "avg_hold_days":      avg_hold,
        }
        rows.append(row)

        tag = ""
        if spread <= 0.001:
            tag = "  ← tight MM territory"
        elif spread >= 0.01:
            tag = "  ← trend-capture territory"

        print(
            f"  spread={spread*100:.3f}%  fills={row['entry_count']:3d}  "
            f"return={row['total_return_pct']:+7.2f}%  sharpe={row['sharpe']:.2f}  "
            f"maxDD={row['max_drawdown_pct']:.1f}%{tag}"
        )

    return rows


def _interpret(rows: list[dict]):
    print("\n--- Interpretation ---")
    tight  = [r for r in rows if r["spread_pct"] <= 0.10]
    wide   = [r for r in rows if r["spread_pct"] >= 1.0]

    if tight:
        best_tight = max(tight, key=lambda r: r["sharpe"])
        if best_tight["sharpe"] >= 1.0:
            print(f"  GENUINE MM EDGE: tight spread {best_tight['spread_pct']:.3f}% "
                  f"achieves Sharpe {best_tight['sharpe']:.2f} — inventory mgmt worth pursuing")
        else:
            print(f"  No clear MM edge at tight spreads (best Sharpe={best_tight['sharpe']:.2f})")

    if wide:
        best_wide = max(wide, key=lambda r: r["total_return_pct"])
        print(f"  Wide-spread variant ({best_wide['spread_pct']:.1f}%) "
              f"return={best_wide['total_return_pct']:+.1f}%  — "
              f"document as TREND-CAPTURE, not market-making")


def main():
    parser = argparse.ArgumentParser(description="Market-making spread sensitivity sweep")
    parser.add_argument("--asset",    default="BTC-USD")
    parser.add_argument("--period",   default="5y")
    parser.add_argument("--spreads",  default="0.02,0.04,0.10,0.25,1.0,4.0",
                        help="Comma-separated spread %% values")
    parser.add_argument("--capital",  type=float, default=1000.0)
    parser.add_argument("--out",      default="tight_mm_sweep.csv")
    args = parser.parse_args()

    spreads = [float(s) / 100.0 for s in args.spreads.split(",")]
    rows = run_sweep(args.asset, args.period, spreads, initial_capital=args.capital)

    out_path = Path(args.out)
    with open(out_path, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nResults written to {out_path.resolve()}")
    _interpret(rows)


if __name__ == "__main__":
    main()
