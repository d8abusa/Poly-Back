# PolyBack — Quant Trading Platform

A full-stack research and live-execution platform for prediction markets and equities. Backtest 10+ strategies against historical data, monitor macro regime signals from FRED, stage signals, and route live orders to Polymarket, Kalshi, or Coinbase Advanced Trade.

<img width="2156" height="1007" alt="Screenshot From 2026-03-25 23-45-43" src="https://github.com/user-attachments/assets/10e2fc6c-8c5c-4748-bf6d-a4862c51eccf" />
<img width="2156" height="1007" alt="Screenshot From 2026-03-25 23-46-09" src="https://github.com/user-attachments/assets/5b3f45ea-fc1f-4e62-bc3e-e3daedbba28c" />
<img width="2156" height="1007" alt="Screenshot From 2026-03-26 07-46-46" src="https://github.com/user-attachments/assets/28ccd2c7-a016-4504-afd9-2ab3078bb17e" />
---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.13, FastAPI, httpx (async), Pydantic v2, NumPy, pandas |
| Frontend | React 18, TypeScript, Vite, Recharts |
| Database | PostgreSQL (`polyback_db`) |
| Auth | JWT (single-user, password-based) |
| TLS | mkcert self-signed certs — both servers run HTTPS |
| Exchanges | Polymarket CLOB · Kalshi · Coinbase Advanced Trade · Yahoo Finance (stocks) · Manifold |
| Macro Data | FRED (St. Louis Fed) — 8 series, local PostgreSQL cache |

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
│   │   ├── fred.py                      # FRED macro data + dashboard
│   │   ├── feed.py                      # Live order book + trade stream
│   │   ├── watchlist.py                 # Watchlist + price alerts
│   │   ├── scanner.py                   # Live market scanner
│   │   └── settings.py                  # Exchange API key management
│   ├── services/
│   │   ├── backtest_engine.py           # All strategy implementations
│   │   ├── fred_service.py              # FRED API client + cache management
│   │   ├── macro_context.py             # Macro regime derivation from FRED cache
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
            ├── macro/                   # MacroPanel — FRED regime dashboard
            ├── charts/                  # PriceChart, EquityChart, PnLDistribution
            ├── execution/               # SignalQueue, ExecutionLog, ExecutionModeToggle
            ├── feed/                    # LiveFeed (order book + trade stream)
            ├── history/                 # HistoryView (closed trade log + PnL)
            ├── market/                  # MarketSearch, MarketCard, MarketDetail
            ├── positions/               # PositionTracker
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

The schema is created automatically on first startup.

### 5. TLS certificates

```bash
# Install mkcert: https://github.com/FiloSottile/mkcert
mkcert -install
mkdir certs && cd certs
mkcert localhost 127.0.0.1 10.0.0.46   # replace with your LAN IP if needed
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

# FRED (St. Louis Fed) — free tier: 100 API calls
FRED_API_KEY=<your key from fred.stlouisfed.org>

# Stop-loss executor
STOP_LOSS_ENABLED=true
STOP_LOSS_POLL_INTERVAL=30
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

The **Macro** tab shows live regime signals derived from 8 cached FRED series:

| Series | Description | Frequency |
|--------|-------------|-----------|
| T10Y2Y | 10Y-2Y Treasury Spread (recession signal) | Daily |
| DFEDTARU | Fed Funds Target Upper Bound | Daily |
| CPIAUCSL | CPI All Urban Consumers | Monthly |
| UNRATE | Unemployment Rate | Monthly |
| PAYEMS | Nonfarm Payrolls | Monthly |
| DTWEXBGS | US Dollar Index (Broad) | Weekly |
| GDP | Real GDP | Quarterly |

FRED has a 100-call free tier. The cache auto-refreshes on the series release schedule — monthly series re-check every 32 days, daily series every 7 days. Each refresh costs 2 calls.

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
| GET | `/api/backtest/history` | Saved backtest runs |
| DELETE | `/api/backtest/history/purge` | Purge runs older than N days |

### Signals
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/signals` | Pending signal queue |
| POST | `/api/signals/from-backtest` | Stage a signal derived from backtest metrics |
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

### FRED / Macro
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/fred/macro-context` | Current macro regime + strategy modifiers |
| GET | `/api/fred/dashboard` | Snapshot of all series (no API call) |
| GET | `/api/fred/budget` | Remaining FRED API pull budget |
| POST | `/api/fred/{series_id}/refresh` | Force refresh a series (costs 2 pulls) |

---

## Notes

- All API routes except `/api/auth/login` require a `Bearer <token>` header.
- The stop-loss executor runs as a background asyncio task — resets on server restart.
- Yahoo Finance (stocks/ETFs/indexes) is supported via `exchange=yahoo` — no API key required.
- Manifold Markets is play-money only — order routing is disabled.
- `.env` files and `certs/` are gitignored — never commit credentials.
