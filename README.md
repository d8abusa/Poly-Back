# PolyBack — Prediction Market Backtester & Live Feed

A full-stack research platform for Polymarket — backtest trading strategies against historical price data, watch live order books, and manage an execution pipeline from signal to position.
<img width="1535" height="880" alt="image" src="https://github.com/user-attachments/assets/9ab1f8f2-fb43-44e5-9c0c-57da6d17ba25" />



---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.13, FastAPI, httpx (async), Pydantic v2, NumPy, pandas |
| Frontend | React 19, TypeScript, Vite, Recharts |
| Data | Polymarket public CLOB API + Gamma API (no account required for read-only) |
| Auth | EIP-712 signed L1 wallet credentials (optional, enables order placement) |

---

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| Python | 3.11+ |
| Node.js | 18+ |
| npm | 9+ |
| git | any |

---

## Project Structure

```
Polymarket/
├── backend/
│   ├── main.py                          # FastAPI app entry point
│   ├── config.py                        # .env loader, auth level detection
│   ├── routes/
│   │   ├── markets.py                   # Market search, detail, price history
│   │   ├── backtest.py                  # Single + batch backtest execution
│   │   ├── strategies.py                # Strategy metadata catalogue
│   │   ├── feed.py                      # Live order book, trades, snapshot
│   │   ├── signals.py                   # Signal queue management
│   │   └── positions.py                 # Open / closed position tracking
│   ├── services/
│   │   ├── polymarket_client.py         # Async CLOB + Gamma API client
│   │   ├── backtest_engine.py           # All strategy implementations
│   │   ├── signal_queue.py              # In-memory signal store
│   │   ├── position_tracker.py          # In-memory position store
│   │   ├── execute_order.py             # Order execution (auto/confirm/alert)
│   │   └── alert_service.py             # Alert-only notification stub
│   ├── models/
│   │   └── schemas.py                   # Pydantic request/response models
│   └── strategies/
│       └── __init__.py                  # Strategy catalogue with metadata
├── frontend/
│   └── src/
│       ├── pages/
│       │   └── BacktestConsole.tsx      # Root page — owns all shared state
│       ├── components/
│       │   ├── backtest/                # BacktestPanel, Results, ParamSliders, BulkLoadModal, StrategyControls
│       │   ├── charts/                  # PriceChart, EquityChart, PnLDistribution
│       │   ├── execution/               # SignalQueue, ConfirmationCard, ExecutionLog, ExecutionModeToggle
│       │   ├── feed/                    # LiveFeed (order book + trade stream)
│       │   ├── history/                 # HistoryView (PnL charts + closed trade log)
│       │   ├── market/                  # MarketSearch, MarketCard, MarketDetail
│       │   ├── positions/               # PositionTracker
│       │   └── shared/                  # HistoryDrawer, RunCard, AuthStatus
│       ├── types.ts
│       └── styles.ts
├── get_api_key.py                       # Utility: derive Polymarket API credentials from wallet key
├── requirements.txt
└── .env                                 # Credentials (never committed)
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
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Frontend

```bash
cd frontend
npm install
```

---

## Configuration

Copy the template and fill in your credentials (all fields are optional for read-only mode):

```bash
# .env is already present at the project root — edit it directly
```

```dotenv
# .env
POLY_API_KEY=
POLY_API_SECRET=
POLY_API_PASSPHRASE=
POLY_PRIVATE_KEY=        # Required only for order placement
POLY_CHAIN_ID=137        # 137 = Polygon mainnet, 80002 = Amoy testnet
```

**Auth levels** (shown as a coloured dot in the app header):

| Dot colour | Level | Capabilities |
|------------|-------|-------------|
| Grey | Public | Read public market data |
| Amber | API Only | + Read private account data |
| Green | Full Auth | + Place and cancel orders |

### Getting API credentials

If you have a Polymarket account with a funded wallet, run:

```bash
source venv/bin/activate
python get_api_key.py --key 0xYOUR_PRIVATE_KEY
```

Paste the printed `POLY_API_KEY`, `POLY_API_SECRET`, and `POLY_API_PASSPHRASE` values into `.env`.
Alternatively set `POLY_PRIVATE_KEY` in `.env` first and run without `--key`.

---

## Running

Open two terminals:

**Terminal 1 — Backend**
```bash
cd ~/quant_project/Polymarket
source venv/bin/activate
uvicorn backend.main:app --reload --port 8000
```

**Terminal 2 — Frontend**
```bash
cd ~/quant_project/Polymarket/frontend
npm run dev
```

| URL | Description |
|-----|-------------|
| http://localhost:5173 | App |
| http://localhost:8000/docs | Swagger / interactive API docs |

---

## API Reference

### Markets

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/markets` | Search markets — params: `q`, `limit`, `offset`, `active`, `closed`, `order`, `tag_slug` |
| GET | `/api/markets/tags` | Available category tags |
| GET | `/api/markets/{condition_id}` | Single market detail |
| GET | `/api/markets/{condition_id}/history` | Price history — params: `token_id`, `interval`, `fidelity` |

### Backtest

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/backtest` | Single market backtest |
| POST | `/api/backtest/batch` | Batch backtest across multiple markets |
| GET | `/api/strategies` | Strategy catalogue with metadata |

### Live Feed

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/feed/snapshot` | Combined: order book + trades + price + market status |
| GET | `/api/feed/book` | Order book only — param: `token_id` |
| GET | `/api/feed/trades` | Recent trades — params: `token_id`, `limit` |
| GET | `/api/feed/auth/status` | Current auth level and capabilities |

### Execution

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/signals` | Pending signal queue |
| POST | `/api/signals/{id}/approve` | Approve a signal |
| POST | `/api/signals/{id}/reject` | Reject a signal |
| GET | `/api/positions` | Open positions |
| GET | `/api/positions/closed` | Closed position history |
| POST | `/api/positions/{id}/close` | Close a position |

---

## Backtest Strategies

| Strategy | Description | Key Parameters |
|----------|-------------|----------------|
| `threshold` | Buy when prob ≤ entry threshold, sell when prob ≥ exit threshold | `entry_threshold`, `exit_threshold`, `stop_loss` |
| `momentum` | Buy when probability trend is rising, sell when falling | `entry_threshold`, `exit_threshold`, `stop_loss` |
| `zscore_reversion` | Mean-reversion on rolling z-score of probability | `zscore_window`, `zscore_entry`, `zscore_exit`, `zscore_stop` |
| `kelly` | Kelly criterion position sizing with dynamic win-rate | `kelly_fraction`, `entry_threshold`, `exit_threshold` |
| `market_making` | Straddle bid/ask around midpoint | `mm_spread`, `stop_loss` |

---

## Execution Modes

| Mode | Behaviour |
|------|-----------|
| **Confirm** | Signals appear in queue — manually approve or reject each |
| **Auto** | Signals execute immediately (requires Full Auth) |
| **Alert Only** | Signals are logged but never executed |

---

## Notes

- Position and signal state is **in-memory** — it resets on backend restart. SQLite persistence is a planned next step.
- The live feed polls every **8 seconds** by default (`POLL_MS` in `LiveFeed.tsx`).
- The market list fetches `limit=100` sorted by volume. The Feed tab fetches its own active-only market list independently.
- `get_api_key.py` uses EIP-712 structured data signing (`eth-account` library) — your private key is never transmitted.
