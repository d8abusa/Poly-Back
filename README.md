# PolyBack — Prediction Market Backtester

## Stack

- **Backend**: FastAPI + httpx (async)
- **Frontend**: React + TypeScript (Vite)
- **Data**: Polymarket public CLOB & Gamma APIs

## Structure

```
Polymarket/
├── backend/
│   ├── main.py                    # FastAPI app, CORS, router registration
│   ├── routes/
│   │   ├── markets.py             # GET /api/markets, /api/markets/{id}/history
│   │   └── backtest.py            # POST /api/backtest
│   ├── services/
│   │   ├── polymarket_client.py   # Async CLOB + Gamma API wrapper
│   │   └── backtest_engine.py     # Strategy execution engine
│   └── models/
│       └── schemas.py             # Pydantic request/response models
├── frontend/
│   └── src/
│       └── components/
│           └── MarketSearch.tsx   # Market search + queue module
├── requirements.txt
└── README.md
```

## Setup

### Backend

```bash
cd ~/quant_project/Polymarket
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Dev server: http://localhost:5173

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/markets` | Search markets (q, limit, offset, active, closed, order, tag_slug) |
| GET | `/api/markets/{condition_id}` | Single market detail |
| GET | `/api/markets/{condition_id}/history` | Price history (token_id, interval) |
| GET | `/api/markets/tags` | Available tags/categories |
| POST | `/api/backtest` | Run backtest |

## Backtest Strategies

- **threshold** — buy when prob ≤ `entry_threshold`, sell when prob ≥ `exit_threshold`
- **momentum** — buy when prob is rising, sell when falling

## Account Setup (future)

Set `POLYMARKET_API_KEY` in a `.env` file to enable authenticated endpoints
(balance, order placement, positions).
