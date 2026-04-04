# AXIOM Strategy Math Audit

**Prepared:** 2026-03-25 11:33 CDT (delivered to AXIOM session 680acfcb-9d5e-4169-aa43-e84367e831fe)

**Background:** Robert reports stocks moving 10% in two weeks but no backtest strategy captures this move. This audit examines why.

---

## Executive Summary

Two critical issues identified in the backtest engine's momentum and threshold strategies:

1. **Momentum Window Enforcement:** Initially presented as an issue, but analysis reveals the momentum strategy correctly implements the 14-tick window parameter for stocks. The concern appears to arise from a misunderstanding of how momentum is applied differently across asset classes.

2. **Critical Bug in Threshold Strategies:** The `_stock_ref_high` variable is **not maintained as a rolling window** throughout the backtest run. It is only initialized once with the first price and never updated, causing inaccurate dip calculations in trending markets.

---

## Detailed Findings

### Issue 1: Momentum Window (Status: ☑️ Resolved)

- **Implementation:** The momentum function enforces a window parameter with `if len(self.equity_curve) < window: return` and calculates rolling highs appropriately.
- **Architecture Decision:** For prediction markets (binary probabilities 0-1), a 2-tick approach is used rather than complex windowing, which is appropriate.
- **Assessment:** This is not a functional bug but a potential confusion between asset class behaviors.

### Issue 2: Threshold Strategy (Status: ❗ CRITICAL BUG)

**Location:** `run()` method line ~135

**Bug:** `_stock_ref_high` is only set to `float(self.history[0]["p"])` at the start and never updated as a rolling high.

**Impact:**
- During uptrends, prices make new highs, but the tool keeps checking against a stale initial price.
- This causes `dip = (self._stock_ref_high - prob) / self._stock_ref_high` to be artificially large even when no actual dip exists.
- Entries are delayed until the false dip triggers, potentially missing opportunities.
- Backtest results become highly variable based on starting data.

**Cause:** The momentum strategy correctly uses `self._stock_ref_high = max(self._stock_ref_high, prob)` for rolling high, but the threshold strategy does not.

**Solution:** Implement continuous rolling high update:
```python
elif not self._is_stock:  # stock mode
    self._stock_ref_high = max(self._stock_ref_high, prob)  # Update rolling high
```

### Cross-Issue Analysis

The threshold strategy lacks the rolling high maintenance that the momentum strategy has. This discrepancy suggests a code divergence or oversight during implementation.

---

## Recommendations

1. **Fix Threshold Strategy:** Implement rolling high updates for `_stock_ref_high` in both stock and binary asset modes.

2. **Validate Momentum Windowing:** Ensure the window parameter is correctly applied and documented for prediction markets to avoid future confusion.

3. **Add Unit Tests:** Create tests for backtest runs in both uptrending and downtrending scenarios to verify the threshold strategy now correctly identifies dips even during rising markets.

4. **Compare Against Real Moves:** Use the recent stock movement (10% in two weeks) as a regression test to ensure backtest now captures meaningful moves.

---

## Deliverable

The audit finds a CRITICAL BUG in the backtest engine that prevents accurate capture of trending market moves. The momentum function appears correctly implemented. The threshold strategy's rolling high maintenance must be fixed to ensure future backtests capture real market dynamics.

**Result:** The 10% stock move likely could not be captured due to the threshold strategy's failure to track the true rolling high, leading to missed entries during upward trends.