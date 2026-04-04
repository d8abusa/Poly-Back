# HARBOR Rulings — Strategy Live Trading Authorization

All rulings issued by HARBOR. No strategy may run live without an entry here.

---

## Cleared for Live Trading

### Kelly Criterion
- **Status:** APPROVED
- **Conditions:** Kelly fraction ≤ 0.5 enforced; `kelly_dip_threshold` tuned per asset class
- **Review date:** (prior session, pre-2026-03-26)

### Z-Score Reversion
- **Status:** APPROVED
- **Conditions:** None outstanding
- **Review date:** (prior session, pre-2026-03-26)

### Mean Reversion
- **Status:** APPROVED WITH CONDITIONS
- **Review date:** 2026-03-26
- **Conditions:**
  1. Stop-loss required before any live run — minimum 8% (`stop_loss` param must not be null)
  2. Prediction markets only — no Yahoo stocks until live Sharpe confirmed from real data
  3. `lookback_window` ≥ 10 at all times
  4. HARBOR WATCH active for first 30 live trades — suspend if Sharpe < 0.7 or Max DD > 15%
- **Trigger for review:** Alias bug fixed (lookback_window / reversion_threshold now wired end-to-end)
- **Synthetic Sharpe:** 1.1 (marginal — meets 1.0 minimum, does not meet preferred 1.5)
- **Synthetic Max DD:** 13% | **Sample:** 118 trades

---

## Pending Review

### Swing Reversion
- **Status:** NOT REVIEWED
- **Notes:** Added 2026-03-26. Stocks-only strategy. Requires live backtest data before HARBOR review.

### Momentum Chaser
- **Status:** NOT REVIEWED

### Threshold
- **Status:** NOT REVIEWED

### Market Making
- **Status:** NOT REVIEWED — advanced strategy; inventory risk requires dedicated review

### XGBoost
- **Status:** NOT REVIEWED — ML model; requires out-of-sample validation before any live use

---

## Standing Risk Limits

| Metric | WATCH | ALERT | HALT |
|--------|-------|-------|------|
| Portfolio Drawdown | 10% | 15% | 20% |
| Total Exposure | 40% | 50% | 60% |
| Single Position | 5% | 7% | 10% |
| Daily Loss | 2% | 3.5% | 5% |
| Category Concentration | 6% | 8% | 10% |

A HALT is unconditional — only the user can lift it in writing.

---

## Open Enforcement Gaps

_None currently open._

## Closed Gaps

- **2026-03-26** — `require_stop_loss: true` in `risk.yml` now enforced in `routes/backtest.py`. Batch runs with `execution_mode=auto` and `stop_loss=null` are rejected with HTTP 422. `confirm` mode is exempt (human review before any order). `alert_only` is exempt (no orders). Default stop-loss values sourced from `risk.yml` (`default_stop_loss: 0.08` stocks, `default_stop_loss_pm: 0.10` prediction markets).
