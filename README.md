# PolyBack — Quant Trading Platform

A full-stack research and live-execution platform for prediction markets and equities. Backtest 10+ strategies against historical data, monitor macro regime signals from FRED, stage signals, and route live orders to Polymarket, Kalshi, or Coinbase Advanced Trade.

<img width="2156" height="1007" alt="Screenshot From 2026-03-25 23-45-43" src="https://github.com/user-attachments/assets/10e2fc6c-8c5c-4748-bf6d-a4862c51eccf" />
<img width="2156" height="1007" alt="Screenshot From 2026-03-25 23-46-09" src="https://github.com/user-attachments/assets/5b3f45ec-fc1f-4e62-bc3e-e3daedbba28c" />
<img width="2156" height="1007" alt="Screenshot From 2026-03-26 07-46-46" src="https://github.com/user-attachments/assets/28ccd2c7-a016-4504-afd9-2ab3078bb17e" />
<img width="2485" height="928" alt="Screenshot From 2026-03-29 08-06-16" src="https://github.com/user-attachments/assets/f2d59944-af7f-4745-9719-7b62eb9638bb" />
<img width="2485" height="928" alt="Screenshot From 2026-03-29 08-06-34" src="https://github.com/user-attachments/assets/debc0d8f-78c4-442f-b129-56376a9ca31e" />
<img width="2485" height="928" alt="Screenshot From 2026-03-29 08-06-16" src="https://github.com/user-attachments/assets/5a6033a9-d2f8-4634-b3b1-cb4133393f26" />


---

## What PolyBack Actually Is

Most trading tools answer one question: *when to enter?* PolyBack is built around a harder question: *are conditions right to act at all?*

The architecture reflects a deliberate philosophy. Strategies generate signals from price and probability mechanics. The macro dashboard tells you whether to act on those signals — and at what size. A human makes the final call with full context. That three-layer structure is intentional. Fully automated systems optimize against revised data, publication lags, and unknown unknowns. A human who understands the current regime — including what isn't in the data yet — can weight those gaps. PolyBack makes the gaps visible rather than hiding them.

The macro tab is not a signal generator. It's a **gut-check layer** — a calibration surface between raw FRED data and trade decisions. The visualizations are designed to be used actively, not just displayed.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.13, FastAPI, httpx (async), Pydantic v2, NumPy, umap-learn |
| Frontend | React 18, TypeScript, Vite, Recharts, Plotly.js |
| Database | PostgreSQL (`polyback_db`) |
| Auth | JWT (single-user, password-based, 8-hour sessions) |
| TLS | mkcert self-signed certs — both servers run HTTPS |
| Exchanges | Polymarket CLOB · Kalshi · Coinbase Advanced Trade · Yahoo Finance · Manifold |
| Macro Data | FRED (St. Louis Fed) — 10 series, local PostgreSQL cache, free and unlimited |

---

## Macro Regime Visualizations

Seven purpose-built charts that show the macro environment in ways no standard dashboard offers. Every chart has a fullscreen toggle (`⛶`) — click once to expand to full viewport, again to minimize. Plotly's Reset Axes button is re-enabled in fullscreen mode so you can always escape a zoomed crop.

### 1. Regime Fingerprint (Radar Chart + Time Dial)

Five FRED indicators normalised to 0–100 plotted on a pentagon. The current regime polygon is compared against a rolling average baseline so you can see at a glance whether conditions are tightening, easing, or drifting. No numbers to parse — the shape tells the story.

**Time Dial:** A scrubber below the chart animates the fingerprint across every cached month, showing how the macro regime has morphed over time. Scrub manually or hit play to watch the pentagon breathe through tightening cycles, inflation surges, and labour market pivots. The current frame shows in teal; historical frames in amber. This is the Hans Rosling moment for monetary policy: regime transitions become motion rather than static aggregates.

> **On data fidelity:** FRED stores *revised* values, not initial prints. Employment data (PAYEMS/UNRATE) is frequently revised significantly downward months after release. The time dial shows hindsight-revised history — what policymakers saw at the time is a different dataset entirely. For unrevised primary sources, see the FRASER NLP roadmap item below.

### 2. Correlation Heatmap

Pearson r between all indicator pairs on month-over-month first-differences for stationarity. Pairwise date alignment handles the reality that daily series (T10Y2Y, DFEDTARU) and monthly series (CPI, Unemployment) don't share release dates. Reveals which indicators move together and which are genuinely independent — essential for knowing when a macro signal is redundant versus additive.

### 3. Parallel Coordinates — Regime Trajectories

Every month is a line connecting five normalised axes. Lines are coloured by recency (dark purple = oldest, bright yellow = most recent) using the Plasma colorscale. Where lines braid and cross marks regime transitions. Where they run parallel marks stability. The single fastest way to spot whether the macro environment has been consistent or volatile across multiple dimensions simultaneously.

### 4. 3D Macro Landscape (Surface Plot)

Time on X, indicator on Y, normalised score on Z — a terrain map of the macro environment. Plateaus are stable regimes. Ridges are rapid shifts. The surface is drag-rotatable and uses a five-stop colorscale (deep red → navy → deep green) with contour lines projected onto the floor. Reuses the parallel coordinates data pipeline with zero additional API calls.

### 5. Correlation Network (Force Graph)

Indicators as nodes, edges drawn where |r| ≥ 0.15. Edge thickness and opacity scale with correlation strength. Blue = positive, red = negative. Node size scales with connection count — economic hubs are visually larger. Hover to inspect pairwise r values. Makes structural relationships visible that a heatmap can only hint at.

### 6. 3D Macro Regime Cube (Animated)

Three indicators form the axes of a 3×3×3 regime grid (Low/Mid/High per axis). Yield spread encoded as colour — red for inverted curves (recession risk), green for steep curves (expansion). All 27 regime cells shown as ghost cubes so you see which cells the economy has *never* visited, not just where it has been.

A **3-month rolling window slider** with play/pause control scrubs through the cache. Watch regime cells light up and fade as the economy moves through macro state space. No other trading dashboard does this.

### 7. UMAP Regime Scatter

UMAP reduces the 5-indicator feature space to 2D while preserving local structure. Months with similar macro conditions cluster together. Points are colour-coded by recession risk, a dotted trajectory connects them chronologically, and a cyan ring marks the current month. Answers a question no other chart can: *which past months looked most like right now?* Geometry stabilises automatically as the cache grows — no code changes needed.

---

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| Python | 3.11+ |
| Node.js | 18+ |
| npm | 9+ |
| PostgreSQL | 14+ |
| mkcert | any |

---

## Project Structure

```
Polymarket/
├── start.sh                             # One-command TLS startup (backend + frontend)
├── .env                                 # Credentials and secrets (never committed)
├── backend/
│   ├── main.py                          # FastAPI app entry point + router registration
│   ├── middleware/
│   │   └── auth.py                      # JWT generation and verification
│   ├── routes/
│   │   ├── auth.py                      # POST /api/auth/login
│   │   ├── markets.py                   # Market search, detail, price history
│   │   ├── backtest.py                  # Single + batch backtest, history CRUD
│   │   ├── strategies.py                # Strategy catalogue with metadata
│   │   ├── signals.py                   # Signal queue + stage-from-backtest
│   │   ├── positions.py                 # Open / closed positions, risk controls
│   │   ├── fred.py                      # FRED macro data, 8 visualization endpoints
│   │   ├── feed.py                      # Live order book + trade stream
│   │   ├── watchlist.py                 # Watchlist + price alerts
│   │   ├── scanner.py                   # Live market scanner
│   │   └── settings.py                  # Exchange API key management
│   ├── services/
│   │   ├── backtest_engine.py           # All strategy implementations + macro gate
│   │   ├── fred_service.py              # FRED API client + PostgreSQL cache
│   │   ├── macro_context.py             # Regime derivation from FRED cache
│   │   ├── fred_prior.py                # FRED-calibrated Kelly prior for PM markets
│   │   ├── stop_loss_executor.py        # Background stop-loss + target monitor
│   │   ├── live_scanner.py              # Signal scanner (prediction markets)
│   │   ├── crypto_scanner.py            # Signal scanner (crypto via Coinbase)
│   │   ├── risk_manager.py              # Circuit breaker + drawdown limits
│   │   ├── exchange_router.py           # Exchange client factory
│   │   ├── polymarket_client.py         # Polymarket CLOB + Gamma API
│   │   ├── coinbase_client.py           # Coinbase Advanced Trade API
│   │   ├── signal_queue.py              # In-memory + DB-backed signal store
│   │   ├── position_tracker.py          # Position store with PnL tracking
│   │   └── db.py                        # PostgreSQL connection + schema init
│   └── models/
│       └── schemas.py                   # Pydantic request/response models
└── frontend/
    └── src/
        ├── pages/
        │   └── BacktestConsole.tsx      # Root page — owns all shared state
        └── components/
            ├── backtest/                # BacktestPanel, Results, ParamSliders,
            │                            #   StrategyControls, BulkLoadModal, ScannerControls
            ├── macro/                   # MacroPanel + 7 visualization components
            │   ├── MacroPanel.tsx       # Regime gauges, time dial, Kelly prior, equity tracker
            │   ├── CorrelationHeatmap.tsx
            │   ├── CorrelationNetwork.tsx
            │   ├── CubeHeatmap.tsx      # Animated 3D regime cube with time slider
            │   ├── MacroSunburst.tsx    # Sector/theme breakdown sunburst
            │   ├── ParallelCoords.tsx
            │   ├── SurfacePlot.tsx
            │   └── UmapScatter.tsx
            ├── charts/                  # PriceChart, EquityChart, PnLDistribution
            ├── execution/               # SignalQueue, ExecutionLog, ExecutionModeToggle
            ├── feed/                    # LiveFeed (order book + trade stream)
            ├── history/                 # HistoryView (closed trade log + PnL)
            ├── market/                  # MarketSearch, MarketCard, MarketDetail
            ├── positions/               # PositionTracker (includes strategy equity panel)
            ├── runs/                    # RunsView (saved backtest history)
            └── shared/                  # AuthStatus, LoginScreen, SettingsPanel,
                                         #   StrategyDetailPanel, Watchlist
```

---

## Installation

### 1. Clone

```bash
git clone https://github.com/d8abusa/Polymarket.git
cd Polymarket
```

### 2. Backend

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. Frontend

```bash
cd frontend
npm install
```

### 4. PostgreSQL

```bash
createdb polyback_db
createuser polyback
psql -c "ALTER USER polyback WITH PASSWORD 'yourpassword';"
psql -c "GRANT ALL PRIVILEGES ON DATABASE polyback_db TO polyback;"
```

The schema is created automatically on first startup (9 tables).

### 5. TLS certificates

```bash
# Install mkcert: https://github.com/FiloSottile/mkcert
mkcert -install
mkdir certs && cd certs
mkcert localhost 127.0.0.1 10.0.0.x   # replace with your LAN IP if needed
```

---

## Configuration

Create `.env` in the project root:

```dotenv
# PostgreSQL
DATABASE_URL=postgresql://polyback:yourpassword@localhost:5432/polyback_db

# Authentication
ADMIN_PASSWORD_HASH=<sha256 of your password>
# python3 -c "import hashlib; print(hashlib.sha256(b'yourpassword').hexdigest())"
JWT_SECRET=<random 64-char hex string>
JWT_EXPIRE_MINUTES=480

# FRED (St. Louis Fed) — free and unlimited, 120 req/min rate limit only
FRED_API_KEY=<your key from fred.stlouisfed.org>

# Stop-loss executor
STOP_LOSS_ENABLED=true
STOP_LOSS_POLL_INTERVAL=30

# Strategy equity compounding (disabled by default — tracking only)
EQUITY_COMPOUNDING_ENABLED=false
```

Exchange credentials go in `backend/.env`:

```dotenv
# Coinbase Advanced Trade
COINBASE_KEY_NAME=organizations/.../apiKeys/...
COINBASE_PRIVATE_KEY=-----BEGIN EC PRIVATE KEY-----\n...

# Kalshi
KALSHI_API_KEY=<your key>
```

---

## Running

```bash
# From project root — starts backend (:8000) and frontend (:5173) with TLS
./start.sh
```

Or manually:

```bash
# Terminal 1 — Backend
source venv/bin/activate
uvicorn backend.main:app \
  --host 0.0.0.0 --port 8000 \
  --ssl-certfile certs/localhost+2.pem \
  --ssl-keyfile certs/localhost+2-key.pem \
  --env-file .env

# Terminal 2 — Frontend
cd frontend
npm run dev
```

| URL | Description |
|-----|-------------|
| https://localhost:5173 | App |
| https://localhost:8000/docs | Swagger / interactive API docs |

---

## Backtest Strategies

| Strategy | Type | Description |
|----------|------|-------------|
| `threshold` | Long | Buy on dip from rolling high (stocks) or prob ≤ entry (PM) |
| `momentum` | Long | Breakout above rolling high with trailing stop |
| `zscore_reversion` | Long | Mean-reversion on rolling z-score of price/probability |
| `mean_reversion` | Long | Fade deviations beyond N std devs from rolling mean |
| `kelly` | Long | Kelly criterion sizing with FRED-calibrated true probability |
| `market_making` | Neutral | Straddle bid/ask around midpoint |
| `xgboost` | Long | ML classifier trained on price features + FRED macro vector |
| `swing_reversion` | Long | Multi-day swing fade with configurable hold window |
| `short_momentum` | Short | Fade price breakdowns below rolling low |
| `short_zscore` | Short | Short when z-score exceeds upper band |
| `wizard` | Long | Runs all long strategies, returns the best performer |

### Macro Regime Gate (stocks / Yahoo exchange)

All stock strategies consult the live FRED macro context before entering a position:

| Recession Risk | Fed Stance | Inflation | Position Size |
|---|---|---|---|
| `high` | any | any | **Blocked** |
| `medium` | tightening | any | ×50% |
| `medium` | other | any | ×65% |
| `low` | tightening | above target | ×70% |
| `low` | tightening | other | ×85% |
| `low` | other | above target | ×80% |
| `low` | easing/neutral | at/below target | ×100% |

---

## Execution Modes

| Mode | Behaviour |
|------|-----------|
| **Confirm** | Signal appears in queue — manually approve or reject |
| **Auto** | Signal executes immediately; stop-loss is required |
| **Alert Only** | Signal is logged but never routed to an exchange |

A background stop-loss executor polls open positions every 30 seconds and auto-closes on breach (places a real exchange order for Coinbase positions).

---

## FRED Macro Dashboard

The **Macro** tab derives live regime signals from FRED series and renders seven analytical visualizations. FRED's API is **free and unlimited** — the only constraint is a 120 req/min rate limit. The cache auto-refreshes on each series' release schedule.

### Tracked Series

| Series | Description | Frequency |
|--------|-------------|-----------|
| T10Y2Y | 10Y–2Y Treasury Spread (recession signal) | Daily |
| T10Y3M | 10Y–3M Treasury Spread (alternative recession signal) | Daily |
| DFEDTARU | Fed Funds Target Upper Bound | Daily |
| FEDFUNDS | Effective Federal Funds Rate | Monthly |
| CPIAUCSL | CPI All Urban Consumers | Monthly |
| UNRATE | Unemployment Rate | Monthly |
| PAYEMS | Nonfarm Payrolls | Monthly |
| DTWEXBGS | US Dollar Index (Broad) | Weekly |
| GDP | Real GDP | Quarterly |
| USEPUINDXD | US Economic Policy Uncertainty Index | Daily |

### Seeding the Cache

Daily series should be seeded with `limit=500` on first run to get ~2 years of history for the time dial and visualization endpoints. Use the **↻ refresh all** button in the Macro tab header, or curl individually:

```bash
TOKEN=<your JWT>
for SERIES in T10Y2Y T10Y3M DFEDTARU DTWEXBGS USEPUINDXD; do
  curl -X POST "https://localhost:8000/api/fred/${SERIES}/refresh?limit=500" \
    -H "Authorization: Bearer $TOKEN"
done
```

The time dial requires at least 3 cached months across ≥ 2 series to activate.

---

## Strategy Equity Tracker

The **Positions** tab includes a per-strategy equity panel showing running PnL, trade count, win rate, and current equity for each active strategy. By default this is **tracking only** — it records outcomes but does not compound capital across trades. Set `EQUITY_COMPOUNDING_ENABLED=true` in `.env` to enable live compounding (see `strategy_equity` table in `db.py`).

---

## Position PnL Sparkline

Each open position in the positions table shows a 72×20px inline sparkline of its net gain/loss over a rolling 3-day window. History is accumulated in `localStorage` (max one snapshot per minute per position, auto-pruned to 72 hours) and survives page refreshes. New positions start as a flat line and fill in over time. A dashed zero-crossing line appears whenever a position has moved from gain to loss or vice versa.

---

## Insider Detection Scanner

The **Smart Money Scanner** scores markets for informed-flow signals using five independent signals combined into a composite `smart_money_score` (0–100):

| Signal | Weight | What it detects |
|---|---|---|
| Book Imbalance | 30% | Bid depth dominating ask depth — directional accumulation |
| Whale Trade | 25% | Single fill ≥ 33% of recent volume |
| Price Velocity | 20% | Last 5 candles range >> prior 5 candles baseline |
| Spread Widening | 15% | Bid-ask spread elevated — liquidity providers stepping back |
| Book Thinness | 10% | Thin order book — easy for large players to sweep |

**Score interpretation:** 0–30 noise · 30–60 watch · 60–80 elevated · 80–100 strong

**EMA smoothing:** Scores are smoothed across scan cycles using an exponential moving average (α = 0.33 for prediction markets → ~15-min half-life; α = 0.50 for equity/crypto → ~10-min half-life). Both the smoothed score and the raw instantaneous score are returned — a large positive divergence between the two means something just fired that hasn't been confirmed yet. The background scanner runs every 5 minutes.

```bash
# Trigger a scan
curl -X POST "https://localhost:8000/api/scanner/insider" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"markets": [...], "exchange": "polymarket", "persist": true}'

# Get last background scan results
curl "https://localhost:8000/api/scanner/insider/last" -H "Authorization: Bearer <token>"
```

---

## Strategy Parameter Optimizer

The optimizer uses **Optuna** (TPE sampler, multivariate mode) to find the best strategy parameters for a given market — maximising Sharpe ratio across `n_trials` parallel backtests.

**Supported strategies:** `zscore_reversion`, `mean_reversion`, `kelly`, `momentum`, `threshold`, `swing_reversion`

Each trial is a full `PredictionMarketBacktester` run with the current macro context injected — so optimized params are regime-aware, not just curve-fit to raw price history. A MedianPruner cuts clearly underperforming trials early to avoid wasting CPU.

```bash
# Optimize zscore_reversion on a market (200 trials, 8 threads)
curl -X POST "https://localhost:8000/api/backtest/optimize" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "condition_id": "...",
    "token_id": "...",
    "exchange": "polymarket",
    "strategy": "zscore_reversion",
    "n_trials": 200,
    "n_jobs": 8
  }'
```

Returns `best_params` (ready to drop into a `BacktestRequest`), `best_sharpe`, `best_return`, and a top-10 trials table. Typical runtime: 5–30 seconds depending on history length.

```bash
# List optimizable strategies and their tunable params
curl "https://localhost:8000/api/backtest/optimize/strategies" -H "Authorization: Bearer <token>"
```

> **Overfitting warning:** Optimized params are tuned to the price history provided. Always validate on a held-out window before deploying. The Wizard's multi-window consistency scoring is the intended validation layer.

---

## API Reference

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/login` | Exchange password for JWT Bearer token |

### Markets
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/markets` | Search markets — params: `q`, `limit`, `exchange`, `active` |
| GET | `/api/markets/{id}/history` | Price history — params: `token_id`, `interval` |

### Backtest
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/backtest/batch` | Batch backtest across multiple markets |
| POST | `/api/backtest/optimize` | Optuna TPE optimizer — find best params for a strategy |
| GET | `/api/backtest/optimize/strategies` | List optimizable strategies and their param bounds |
| GET | `/api/backtest/history` | Saved backtest runs |
| DELETE | `/api/backtest/history/purge` | Purge runs older than N days |

### Signals
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/signals` | Pending signal queue |
| POST | `/api/signals/from-backtest` | Stage a signal from backtest metrics |
| POST | `/api/signals/{id}/approve` | Approve (routes real order for Coinbase signals) |
| POST | `/api/signals/{id}/reject` | Reject |

### Positions
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/positions` | Open positions |
| GET | `/api/positions/closed` | Closed position history |
| POST | `/api/positions/{id}/close` | Close a position |
| GET | `/api/positions/risk/status` | Circuit breaker status |
| POST | `/api/positions/risk/kill` | Emergency halt |

### Scanner / Insider
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/scanner/insider` | Score markets for smart-money signals — returns ranked results |
| GET | `/api/scanner/insider/last` | Last background scan results (no new scan triggered) |
| POST | `/api/scanner/start` | Start the live strategy scanner |
| POST | `/api/scanner/stop` | Stop the live strategy scanner |
| GET | `/api/scanner/status` | Scanner status |

### FRED / Macro
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/fred/macro-context` | Current macro regime + strategy modifiers |
| GET | `/api/fred/dashboard` | Snapshot of all series (no API call) |
| GET | `/api/fred/budget` | FRED pull count (unlimited — informational only) |
| GET | `/api/fred/radar` | Regime fingerprint — indicators normalised 0–100 |
| GET | `/api/fred/radar-history` | Per-month frames for the regime time dial |
| GET | `/api/fred/parallel` | Parallel coordinates data — all indicators by month |
| GET | `/api/fred/correlation` | Pearson r matrix on pairwise first-differences |
| GET | `/api/fred/network` | Correlation network — nodes + edges above threshold |
| GET | `/api/fred/cube` | 3D regime cube — binned cells + animation frames |
| GET | `/api/fred/umap` | UMAP 2D embedding of the macro feature space |
| POST | `/api/fred/{series_id}/refresh` | Force refresh a series — `?limit=500` for daily series |

---

## Lessons Learned

These aren't warnings — they're scar tissue. Each one cost real debugging time and is now permanently baked into the codebase.

**FRED is free and unlimited.** An early implementation tracked a synthetic call budget and blocked refreshes after ~100 "uses." FRED's real constraint is 120 req/min — no lifetime limit exists. The fake counter was removed entirely; the `/budget` endpoint now reflects reality.

**Daily series need `limit=500` on first pull.** A `limit=24` on a daily series yields 24 daily observations — about 1 month when resampled to monthly. The regime fingerprint time dial requires ≥ 3 months to activate. Seed daily series with `limit=500` (~2 years) on first run.

**FRED stores revised data, not initial prints.** Employment data (PAYEMS/UNRATE) is frequently revised downward months after release. The macro time dial shows the hindsight-corrected story. What policymakers actually saw at the time requires primary sources (FOMC transcripts, Beige Books via FRASER — see roadmap).

**Always add null guards in frontend when backend data changes.** When new fields are added to backend responses, stale cached data will reach React components that don't expect them. Missing null guards (`??`, `?.`) cause blank-screen crashes. Guard everything at the component boundary.

**`uvicorn --reload` doesn't always pick up `__init__.py` changes.** If behavior looks stale after modifying service files, kill and restart manually.

**Vite's default `index.css` collapses views.** The boilerplate includes `body { display: flex; place-items: center }` which causes views to collapse to a centered strip. Remove it, or every layout will fight it.

**The 2-column `.layout` grid collapses single-child views to 340px.** When a view has only one child, wrap with `display: flex; flex: 1` instead of `.layout`.

**Fullscreen overlays need `z-index: 9999` and `position: fixed; inset: 0`.** Lower z-indices lose to sticky headers and sidebars. `inset: 0` is cleaner than spelling out top/right/bottom/left.

**Plotly disables the toolbar in embed mode.** Set `displayModeBar: true` explicitly in fullscreen mode or users have no way to reset a zoomed chart.

**SQL schema blocks placed outside `cur.execute("""...""")` cause silent import failures.** Python will parse the `CREATE TABLE` string as a standalone expression with no error — but the table never gets created, and the failure only surfaces at runtime when the table is referenced. Keep all DDL inside a single SQL string.

---

## Roadmap

### Optimizer UI Panel

Backend is complete. Needs a `OptimizerPanel.tsx` component: strategy selector (data-driven from `/optimize/strategies`), trial/thread count inputs, progress display, and a "Load Params" button that writes `best_params` directly into the backtest sliders.

### Batch Optimize-then-Wizard (Multi-Stock Strategy Hunter)

Pick N stocks, run the optimizer across all strategies for each, then run the Wizard on the optimized params to find the best strategy per ticker in one operation. **Hard requirement:** walk-forward validation must be built in from day one — optimize on `history[:-validation_days]`, evaluate on `history[-validation_days:]`. Without this the results are overfit and misleading.

### FRASER NLP — Fed Policy Tone Detection

Mine FOMC transcripts, Beige Book releases, and Fed Chair speeches from the FRASER digital archive for language tone shifts. Detect hawkish/dovish pivot language before it's fully priced in. Feed sentiment score as a signal confidence modifier.

This is the correct complement to FRED quantitative data: FRASER primary sources capture what policymakers *actually saw* at the time — the unrevised real-time layer that FRED's revised time series cannot provide. FRASER API access already applied for.

### Robinhood Execution

Engine is ready (`exchange_router.py`). Needs a Robinhood client + router + frontend exchange selector.

### Kalshi Live Execution

Phase 4 goal. API key is configured. Needs order routing wired through the signal approval flow.

### 3D Macro Heatmap

Correlate FRED macro indicators with strategy performance over time — axes: time × indicator × value. Will need Three.js or Plotly 3D. Planned after FRASER NLP.

---

## Notes

- All API routes except `/api/auth/login` require a `Bearer <token>` header.
- The stop-loss executor runs as a background asyncio task — resets on server restart.
- Yahoo Finance (stocks/ETFs/indexes) via `exchange=yahoo` — no API key required.
- Manifold Markets is play-money only — order routing is disabled.
- `.env` files and `certs/` are gitignored — never commit credentials.
- Default admin password is `polyback` — change it. The hash goes in `.env` as `ADMIN_PASSWORD_HASH`.
- UMAP geometry stabilises with more data. The regime scatter sharpens automatically as the cache grows.
