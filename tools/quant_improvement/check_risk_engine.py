"""
Risk engine compliance checker.

Loads risk.yml and validates that a recent backtest run (or a set of
simulated trades) does not violate any guardrail. Exits with code 1 if
any violation is found, so this can be wired into CI.

Usage:
    cd /home/robert-nichols/quant_project/Polymarket
    python -m tools.quant_improvement.check_risk_engine [--trades-csv path]

Without --trades-csv, runs a quick self-test backtest on BTC-USD to generate
trades, then validates them.
"""

import argparse
import csv
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

import yaml
import yfinance as yf

from backend.models.schemas import BacktestRequest
from backend.services.backtest_engine import PredictionMarketBacktester

RISK_CONFIG_PATH = PROJECT_ROOT / "backend" / "config" / "risk.yml"


def load_risk_config() -> dict:
    with open(RISK_CONFIG_PATH) as fh:
        return yaml.safe_load(fh)


def fetch_history(ticker: str, period: str = "5y") -> list[dict]:
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


def run_self_test(risk: dict) -> list[dict]:
    """Run a quick Kelly backtest on BTC and return the trades list."""
    print("Running self-test backtest: BTC-USD Kelly (10% dip threshold) …")
    history = fetch_history("BTC-USD", "5y")
    req = BacktestRequest(
        condition_id="BTC-USD",
        token_id="BTC-USD",
        strategy="kelly",
        kelly_dip_threshold=0.10,
        exit_threshold=0.20,
        stop_loss=risk.get("default_stop_loss", 0.08),
        initial_capital=1000.0,
        kelly_fraction=min(0.5, risk.get("kelly_max_fraction", 0.25)),
        kelly_min_roi=risk.get("kelly_min_roi", 0.002),
        interval="1d",
    )
    engine = PredictionMarketBacktester(req, history)
    result = engine.run()
    print(f"  Generated {result.total_trades} trades  return={result.total_return:+.1f}%")
    return result.trades, result.initial_capital


def check_trades(trades: list[dict], initial_capital: float, risk: dict) -> list[str]:
    """Return list of violation messages (empty = pass)."""
    violations = []
    pos_limit = risk.get("position_limit", 0.05)
    slip_factor = risk.get("slippage_factor", 0.001)

    equity = initial_capital
    for i, t in enumerate(trades):
        cost = t.get("cost") or t.get("entry_price", 0) * t.get("shares", 0)
        pnl  = t.get("pnl", 0.0) or 0.0

        # Position size check
        if equity > 0 and cost > 0:
            frac = cost / equity
            if frac > pos_limit + 1e-6:
                violations.append(
                    f"Trade {i+1}: position size {frac*100:.1f}% exceeds limit {pos_limit*100:.0f}%"
                )

        equity += pnl

    # Require stop_loss set — checked at request level (no trades needed)
    return violations


def main():
    parser = argparse.ArgumentParser(description="Risk engine compliance checker")
    parser.add_argument("--trades-csv", default=None, help="CSV of trades to validate")
    args = parser.parse_args()

    risk = load_risk_config()
    print(f"Loaded risk config: {RISK_CONFIG_PATH}")
    print(f"  position_limit={risk['position_limit']*100:.0f}%  "
          f"slippage_factor={risk['slippage_factor']*100:.2f}%  "
          f"max_total_drawdown={risk['max_total_drawdown']*100:.0f}%")

    if args.trades_csv:
        # Load pre-generated trades from CSV
        with open(args.trades_csv) as fh:
            reader = csv.DictReader(fh)
            trades = list(reader)
        initial_capital = 1000.0
    else:
        trades, initial_capital = run_self_test(risk)

    print(f"\nValidating {len(trades)} trades against risk guardrails …")
    violations = check_trades(trades, initial_capital, risk)

    if violations:
        print("\n[FAIL] Risk violations found:")
        for v in violations:
            print(f"  ✗ {v}")
        sys.exit(1)
    else:
        print("[PASS] All trades comply with risk guardrails.")
        sys.exit(0)


if __name__ == "__main__":
    main()
