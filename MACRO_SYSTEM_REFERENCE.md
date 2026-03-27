# PolyBack — Macro System Reference

This document describes every rule, threshold, interaction, and design decision in the macro pipeline — from raw FRED data to live strategy execution. It is the authoritative reference for understanding why the system behaves the way it does.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [FRED Data Layer](#2-fred-data-layer)
3. [Regime Derivation Rules](#3-regime-derivation-rules)
4. [Strategy Modifiers](#4-strategy-modifiers)
5. [Stock Entry Gate](#5-stock-entry-gate)
6. [FRED-Calibrated Kelly Prior](#6-fred-calibrated-kelly-prior)
7. [XGBoost Feature Vector](#7-xgboost-feature-vector)
8. [Visualization Reference](#8-visualization-reference)
9. [API Quick Reference](#9-api-quick-reference)
10. [Known Limitations and Edge Cases](#10-known-limitations-and-edge-cases)

---

## 1. Architecture Overview

```
FRED API (St. Louis Fed)
        │
        ▼
  fred_service.py          ← cache management, pull budget enforcement
  PostgreSQL fred_cache     ← all observations stored with obs_date, value
        │
        ▼
  macro_context.py         ← derives 6 regime labels + 2 strategy modifiers
  fred_prior.py            ← derives p_true for Kelly from market title
        │
        ├──▶ backtest_engine.py   ← injects modifiers, gates stock entries
        ├──▶ routes/fred.py       ← 9 visualization + data endpoints
        └──▶ MacroPanel (React)   ← 8 charts, regime gauges, Kelly prior UI
```

**Key rule:** All macro reads are pure cache reads. No FRED API call is ever triggered from a strategy execution path. The cache is populated separately via scheduled pulls or manual refresh.

---

## 2. FRED Data Layer

### 2.1 Tracked Series

| Series ID | Name | Units | Frequency | Refresh Window |
|-----------|------|-------|-----------|----------------|
| `T10Y2Y` | 10Y–2Y Treasury Spread | Percent | Daily | 7 days |
| `DFEDTARU` | Fed Funds Target Upper Bound | Percent | Daily | 7 days |
| `CPIAUCSL` | CPI All Urban Consumers | Index (1982–84=100) | Monthly | 32 days |
| `UNRATE` | Unemployment Rate | Percent | Monthly | 32 days |
| `PAYEMS` | Nonfarm Payrolls | Thousands | Monthly | 32 days |
| `FEDFUNDS` | Fed Funds Rate (monthly avg) | Percent | Monthly | 32 days |
| `DTWEXBGS` | US Dollar Index (Broad) | Index (Jan 2006=100) | Weekly | 7 days |
| `GDP` | Real GDP | Billions USD (chained) | Quarterly | 95 days |

### 2.2 Pull Budget

FRED's free tier allows 100 API calls total. Each `get_series()` call (with or without refresh) counts as **2 calls** — one for series metadata, one for observations.

- Budget is enforced in `_fetch_from_fred()` — raises `RuntimeError` at ≥ 95 used.
- The `/api/fred/budget` endpoint returns used / remaining at any time.
- Visualization endpoints (`/radar`, `/parallel`, `/correlation`, etc.) are **pure cache reads** — they never touch the FRED API.

### 2.3 Cache Behavior

- `_get_cached(series_id)` returns **all stored observations**, newest-first, with no limit.
- `get_series()` fetches from API only when: (a) forced via `force_refresh=True`, or (b) `_is_stale()` returns True (last pull was ≥ `_REFRESH_DAYS` ago).
- The cache uses **upsert** semantics — re-pulling a series updates values for existing dates and adds new ones. Historical data is never deleted.

### 2.4 Daily Series — History Seeding

Daily series (`T10Y2Y`, `DFEDTARU`, `DTWEXBGS`) default to `limit=24` when auto-refreshed, giving only ~24 days of history. For the visualization endpoints to have meaningful monthly buckets, these should be seeded with `limit=500` (~2 years) on first setup:

```bash
POST /api/fred/T10Y2Y/refresh?limit=500
POST /api/fred/DFEDTARU/refresh?limit=500
POST /api/fred/DTWEXBGS/refresh?limit=500
```

This costs 6 API calls (3 series × 2 calls each).

---

## 3. Regime Derivation Rules

All logic lives in `macro_context.py → get_macro_context()`. Called on every backtest run and on the `/api/fred/macro-context` endpoint. Pure cache read.

### 3.1 Recession Risk — `T10Y2Y`

The 10-year minus 2-year Treasury spread is the primary recession signal. An inverted yield curve (negative spread) historically precedes recessions by 6–18 months.

| Condition | Label |
|-----------|-------|
| `spread < -0.5%` | `high` |
| `-0.5% ≤ spread < 0.0%` | `medium` |
| `spread ≥ 0.0%` | `low` |
| No T10Y2Y data | `unknown` |

### 3.2 Fed Stance — `DFEDTARU` (fallback: `FEDFUNDS`)

Compares the current rate to the rate 12 periods ago. For daily DFEDTARU, 12 periods ≈ 12 days (not months — this is a known limitation; see §10).

| Condition | Label |
|-----------|-------|
| `current > prior + 0.1%` | `tightening` |
| `current < prior - 0.1%` | `easing` |
| Within ±0.1% of 12-period-ago | `neutral` |
| Missing data | `neutral` (safe default) |

### 3.3 Inflation Level — `CPIAUCSL` (YoY)

CPI is stored as an index (~314). YoY % change is computed on the fly: `(latest - 12_months_ago) / 12_months_ago × 100`. The 2% Fed target is treated as 2.5% in this system to provide a buffer before flagging "above target."

| Condition | Label |
|-----------|-------|
| `CPI YoY > 3.0%` | `above_target` |
| `1.5% ≤ CPI YoY ≤ 3.0%` | `at_target` |
| `CPI YoY < 1.5%` | `below_target` |
| Fewer than 13 cached months | `unknown` |

### 3.4 Inflation Trend — `CPIAUCSL` (3-month momentum)

Captures the direction of travel, not just the level. Uses 3-month percentage change.

| Condition | Label |
|-----------|-------|
| `3-month change > +0.3%` | `rising` |
| `3-month change < -0.1%` | `falling` |
| Between -0.1% and +0.3% | `stable` |

### 3.5 Labor Market — `UNRATE`

| Condition | Label |
|-----------|-------|
| `UNRATE < 4.0%` | `strong` |
| `4.0% ≤ UNRATE ≤ 5.0%` | `weakening` |
| `UNRATE > 5.0%` | `weak` |
| No data | `unknown` |

### 3.6 Dollar Trend — `DTWEXBGS` (YoY)

Compares current dollar index to 52 observations ago. DTWEXBGS is weekly, so 52 observations ≈ 1 year.

| Condition | Label |
|-----------|-------|
| `YoY change > +3%` | `strengthening` |
| `YoY change < -3%` | `weakening` |
| Within ±3% | `neutral` |
| Fewer than 53 cached weekly obs | `neutral` |

---

## 4. Strategy Modifiers

Two modifiers are computed from the regime and injected into every backtest run automatically via `backtest.py → _inject_macro()`. They modify the user's parameters without overriding them — the user's settings define the baseline, the macro context scales them.

### 4.1 Z-Score Multiplier — `zscore_multiplier`

Applied to `z_entry` in mean-reversion and zscore strategies. A higher multiplier means the strategy requires a more extreme deviation before entering — reducing false signals during uncertain macro regimes.

| Recession Risk | `zscore_multiplier` |
|----------------|---------------------|
| `high` | **1.35×** |
| `medium` | **1.15×** |
| `low` | **1.0×** (no change) |

**Why:** In high recession risk environments, price dislocations are more likely to be genuine regime shifts than reversion opportunities. Widening the entry threshold avoids buying into a trend that never reverts.

### 4.2 Kelly Caution — `kelly_caution`

Applied to `kelly_fraction` in Kelly-based strategies. Reduces position sizing when the macro environment is unfavorable or uncertain.

| Condition | `kelly_caution` |
|-----------|-----------------|
| Recession risk `high` | **0.70×** |
| Inflation `above_target` AND Fed `tightening` | **0.75×** |
| Fed `easing` AND recession risk `low` | **1.0×** (full Kelly) |
| All other combinations | **1.0×** |

**Why:** Kelly sizing assumes the edge estimate (p_true) is accurate. In stressed macro environments, uncertainty about the true probability is higher, so a fractional Kelly is more appropriate.

---

## 5. Stock Entry Gate

Applies to all strategies on the Yahoo Finance exchange (`exchange=yahoo`). Implemented in `backtest_engine.py → _macro_stock_gate()`. Called before every potential entry in `_threshold()` and `_momentum()`.

Returns `(allow_entry: bool, size_multiplier: float)`.

| Recession Risk | Fed Stance | Inflation | Allow Entry | Size Mult |
|----------------|------------|-----------|-------------|-----------|
| `high` | any | any | **No** | 0.0 |
| `medium` | `tightening` | any | Yes | **0.50×** |
| `medium` | other | any | Yes | **0.65×** |
| `low` | `tightening` | `above_target` | Yes | **0.70×** |
| `low` | `tightening` | other | Yes | **0.85×** |
| `low` | other | `above_target` | Yes | **0.80×** |
| `low` | `easing`/`neutral` | `at_target`/`below_target` | Yes | **1.0×** |
| `unknown` | any | any | Yes | **1.0×** (no data = no penalty) |

The size multiplier is applied to the dollar cost of the position. A 0.50× multiplier on a $1,000 position results in a $500 entry.

**Why blocked at high recession risk:** A confirmed recession signal (inverted spread below -0.5%) has historically been a reliable indicator that equity drawdowns are ahead. Blocking entries entirely is more conservative than reducing size, and deliberate.

---

## 6. FRED-Calibrated Kelly Prior

Implemented in `fred_prior.py → calibrate_from_title()`. Called by the `/api/fred/prior` endpoint and optionally by the Kelly strategy to seed `p_true` from economic data rather than market price.

### 6.1 Matching Logic

Market titles are matched to FRED series via keyword rules evaluated in order (first match wins):

| Keywords (any match) | Series |
|----------------------|--------|
| `cpi`, `consumer price`, `inflation rate`, `inflation` | `CPIAUCSL` |
| `unemployment`, `jobless`, `unemployment rate` | `UNRATE` |
| `nonfarm payroll`, `jobs added`, `payroll` | `PAYEMS` |
| `fed funds`, `federal funds rate` | `FEDFUNDS` |
| `fed cut/raise/hike`, `rate cut/hike`, `fomc`, `interest rate`, `fed rate`, `target rate`, `policy rate` | `DFEDTARU` |
| `gdp`, `gross domestic product` | `GDP` |
| `yield spread`, `yield curve`, `10y-2y`, `inverted` | `T10Y2Y` |
| `dollar index`, `dxy`, `us dollar` | `DTWEXBGS` |

### 6.2 Threshold Extraction

A percentage threshold is extracted from the title using the regex `(\d+\.?\d*)\s*%`. Direction defaults to "above"; overridden to "below" if the title contains: *below, under, less than, lower than, beneath, fall below, drop below, not exceed*.

Example: `"Will CPI exceed 3.5% in May?"` → series=`CPIAUCSL`, threshold=3.5, direction="above"

### 6.3 CPI Unit Normalisation

`CPIAUCSL` is stored as an index (~314). If the extracted threshold is small (implied to be a YoY % like 3.5%), the cached index values are converted to YoY % change before running the regression:

```
yoy[i] = (value[i] - value[i+12]) / value[i+12] × 100
```

This conversion requires ≥ 13 cached monthly observations.

### 6.4 Trend Extrapolation

Uses OLS linear regression on the most recent 6 observations (configurable as `trend_window`):

1. Fit slope + intercept on the 6-point window (oldest-first)
2. Extrapolate one period forward: `predicted = intercept + slope × (k)`
3. Estimate uncertainty σ as the mean absolute period-to-period change over the last 12 pairs
4. Compute z-score: `z = (predicted - threshold) / σ`
5. `p_true = Φ(z)` for "above", `p_true = 1 - Φ(z)` for "below" (standard normal CDF)
6. Hard-clip: `p_true = max(0.05, min(0.95, p_true))`

### 6.5 Confidence Score

```
data_confidence  = min(1.0, n_observations / 12)
sigma_confidence = max(0.0, 1.0 - σ / max(|predicted|, 0.1))
confidence       = (data_confidence + sigma_confidence) / 2
```

**Interpretation:**
- `confidence < 0.4` → do not use; fall back to default p_true
- `0.4 ≤ confidence < 0.7` → use with caution; apply additional kelly_caution
- `confidence ≥ 0.7` → reliable estimate

---

## 7. XGBoost Feature Vector

5 features injected into the XGBoost strategy alongside price-derived features. Scaled to approximately [-1, +1] so they have comparable magnitude to the normalised price features.

| Feature | Formula | Interpretation |
|---------|---------|----------------|
| `f_spread` | `T10Y2Y / 2.0` | Positive = steep curve (bullish), negative = inverted (bearish) |
| `f_rate` | `(DFEDTARU - 3.0) / 4.0` | Positive = above historical neutral, negative = accommodative |
| `f_cpi` | `(CPI_YoY - 2.5) / 3.0` | Positive = above target, negative = below target |
| `f_unemp` | `(UNRATE - 4.0) / 2.0` | Positive = elevated unemployment, negative = tight labor |
| `f_dollar` | `(dollar_YoY_change%) / 5.0` | Positive = strengthening dollar, negative = weakening |

Missing series values default to `0.0` (neutral). The model treats missing data as a non-signal, not as a flag.

---

## 8. Visualization Reference

All visualization endpoints are pure cache reads. None trigger FRED API calls.

### Normalization Ranges (shared across radar, parallel, surface, cube)

| Series | Low | High | Notes |
|--------|-----|------|-------|
| `T10Y2Y` | -3.0% | +3.5% | Inverted in radar (low spread = high stress) |
| `DFEDTARU` | 0.0% | 10.0% | |
| `CPIAUCSL` | 0.0% | 8.0% | Converted to YoY before normalising |
| `UNRATE` | 3.0% | 12.0% | |
| `DTWEXBGS` | 90.0 | 140.0 | Dollar index |
| `GDP` | 0.0% | 5.0% | Annualised QoQ growth (used in sunburst only) |

### Chart Index

| # | Chart | Endpoint | What it answers |
|---|-------|----------|-----------------|
| 1 | **Regime Fingerprint** (radar) | `/api/fred/radar` | Where are we now vs historical average? |
| 2 | **Correlation Heatmap** | `/api/fred/correlation` | Which indicators move together? |
| 3 | **Parallel Coordinates** | `/api/fred/parallel` | How has the full macro profile evolved? |
| 4 | **3D Surface** | `/api/fred/parallel` (reused) | Terrain view: time × indicator × score |
| 5 | **Correlation Network** | `/api/fred/network` | Which indicators are structurally linked? |
| 6 | **Animated 3D Cube** | `/api/fred/cube` | Which macro regime cells has the economy occupied? |
| 7 | **UMAP Scatter** | `/api/fred/umap` | Which past months look most like right now? |
| 8 | **Macro Stress Sunburst** | `/api/fred/sunburst` | What is the current stress level by category? |

### Correlation Endpoint — Pairwise Alignment

The `/correlation` and `/network` endpoints use **pairwise date alignment**, not global intersection. This handles the reality that daily series (T10Y2Y, DFEDTARU) have fewer monthly buckets than monthly series (CPI, UNRATE) after re-seeding. Each cell `(i, j)` in the matrix uses only the months where both series `i` and `j` have data.

Pearson r is computed on **first-differences** (month-over-month change) for stationarity. Raw levels would produce spurious correlations due to shared trends.

### Animated Cube — Rolling Window

The cube uses a **3-month rolling window**. Each frame represents the 3 months ending on that date. This prevents frames from collapsing to a single cell (which would happen with 1-month windows given the sparse 3×3×3 grid) while still showing temporal movement.

Bin boundaries: Low = 0–33.3, Mid = 33.3–66.7, High = 66.7–100 (normalised 0–100 scale).

### Sunburst — Stress Score Logic

| Indicator | Stress direction | Notes |
|-----------|-----------------|-------|
| `T10Y2Y` | Inverted | 0% normalised = max stress (inverted curve) |
| `GDP` | Inverted | Low growth = high stress |
| `CPIAUCSL` | Direct | High CPI YoY = high stress |
| `DFEDTARU` | Direct | High rate = tightening stress |
| `UNRATE` | Direct | High unemployment = high stress |
| `PAYEMS` | MoM direction | Negative MoM change = 80 stress; positive = scales down to ~5 |
| `DTWEXBGS` | Direct | Strong dollar = tighter conditions = stress |

Minimum cell size = 8 to prevent any indicator from disappearing.

---

## 9. API Quick Reference

All routes require `Authorization: Bearer <token>` except `/api/auth/login`.

| Method | Route | Cost | Description |
|--------|-------|------|-------------|
| GET | `/api/fred/macro-context` | Free | Current regime + modifiers |
| GET | `/api/fred/dashboard` | Free | All series latest values |
| GET | `/api/fred/budget` | Free | API call usage |
| GET | `/api/fred/radar` | Free | Radar chart data |
| GET | `/api/fred/parallel` | Free | Parallel coordinates data |
| GET | `/api/fred/correlation` | Free | Pearson r matrix |
| GET | `/api/fred/network` | Free | Correlation graph nodes + edges |
| GET | `/api/fred/cube` | Free | 3D regime cube + animation frames |
| GET | `/api/fred/umap` | Free | UMAP 2D embedding |
| GET | `/api/fred/sunburst` | Free | Stress hierarchy |
| POST | `/api/fred/prior` | Free | Kelly prior from market title |
| POST | `/api/fred/{id}/refresh` | **2 API calls** | Force re-pull (limit up to 500) |

---

## 10. Known Limitations and Edge Cases

### Fed Stance — Monthly Resampling

`DFEDTARU` is a daily series. The fed stance comparison resamples it to monthly buckets (last observation per month) before comparing current to 12 months ago, giving a true 12-month policy cycle comparison. If `DFEDTARU` is unavailable, the fallback is `FEDFUNDS` (already monthly), which uses direct index lookback.

### Correlation Network Edge Threshold

Edges below `|r| ≥ 0.15` are hidden. With only 11–22 months of common data, some correlations that would be significant over a longer history may not yet appear. The n_obs count shown on hover indicates reliability — pairs with fewer than 6 common months should be treated as indicative only.

### UMAP with Small Samples

UMAP requires `n_neighbors < n_samples`. With 11 months, `n_neighbors` is capped at 5. The embedding geometry will shift as more months accumulate. The trajectory line is the most stable part of the chart at low sample sizes; cluster boundaries are not yet meaningful.

### CPI YoY Requires 13 Months

Any CPI computation (regime label, parallel coords, cube, UMAP, sunburst) requires at least 13 cached monthly observations — 12 months prior + current. If the cache has fewer, CPI-dependent labels return `unknown` and CPI axes are excluded from visualizations.

### Budget Exhaustion

At 95/100 API calls used, the refresh endpoint returns 503. The system continues to serve cached data indefinitely — the 100-call limit affects only future pulls, not existing data. Budget resets require either a new FRED API key or upgrading to a paid plan at fred.stlouisfed.org.

### Macro Gate Only Applies to Stocks

The `_macro_stock_gate()` is checked only when `_is_stock` is True (i.e., `exchange=yahoo`). Polymarket, Kalshi, and Coinbase positions are **not** gated by macro regime — the philosophy is that prediction market prices already reflect macro conditions, so an additional gate would double-count the signal. Kelly caution and z-score multipliers do apply to all exchanges.

---

*Last updated: 2026-03-27. Reflects codebase at commit `2169068`.*
