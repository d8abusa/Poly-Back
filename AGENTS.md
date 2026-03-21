# AGENTS.md — PolyBack

## THIS IS A LIVE TRADING PLATFORM. REAL MONEY IS AT STAKE.

Read this file fully before touching anything in this directory.

---

## What This Application Is

**PolyBack** — a quantitative research, backtesting, and live trading platform for
prediction market exchanges (Kalshi, Polymarket, Manifold).

| Attribute | Value |
|-----------|-------|
| Domain | Prediction markets — binary YES/NO contracts |
| Live exchanges | Kalshi (primary), Coinbase (crypto) |
| Research exchanges | Manifold (play money) |
| Asset format | Probability 0.0 → 1.0 (price = probability) |
| Backend | FastAPI, Python 3.11+, port 8000 |
| Frontend | React 18 / TypeScript / Vite, port 5173 |
| Database | PostgreSQL — `polyback_db`, user `polyback`, schema `public` |
| Env file | `~/quant_project/Polymarket/.env` — contains live API keys |

---

## This Is NOT The Backtester

The crypto backtester lives at `~/backtester`. It is a completely separate application.
Do not conflate them. Do not copy code between them. Do not touch PolyBack files while
working on the backtester, or vice versa.

---

## Ground Rules for Agents

### Before making any change
- Read the file you are about to modify. Do not edit from memory.
- Check `POLYBACK_USER_GUIDE.md` for context on how the system is designed.
- If a change touches the risk manager, signal queue, or position tracker — stop and
  confirm with the user first. These modules gate real order flow.

### Things you must never do without explicit written user instruction
- Modify `backend/services/risk_manager.py` — this is the circuit breaker for live trading
- Modify `backend/services/position_tracker.py` — this tracks real open positions
- Modify `backend/services/execute_order.py` — this places real orders on exchanges
- Change or delete anything in `backend/.env` — live API keys live here
- Drop, truncate, or alter any table in `polyback_db`
- Disable or weaken the kill switch (`/api/positions/risk/kill`)
- Remove or bypass the `_require_admin()` guard on risk endpoints
- Change `STOP_LOSS_ENABLED` to false
- Deploy to any external host or push credentials anywhere

### Safe to work on without special caution
- `backend/strategies/` — strategy definitions are data, not execution logic
- `backend/routes/backtest.py` — backtesting is read-only simulation
- `backend/routes/fred.py` — FRED data routes, cache reads only
- `backend/services/fred_service.py` — FRED cache service
- `backend/services/macro_context.py` — derived signals from FRED cache
- `backend/services/fred_prior.py` — probability calibration, no side effects
- `frontend/` — UI changes do not affect order flow
- `POLYBACK_USER_GUIDE.md` — documentation only

---

## Architecture at a Glance

```
frontend (React, :5173)
    └── backend (FastAPI, :8000)
            ├── routes/
            │     ├── backtest.py      — simulation only
            │     ├── markets.py       — exchange market data
            │     ├── signals.py       — signal queue + approval
            │     ├── positions.py     — open positions + risk controls  ⚠️
            │     ├── strategies.py    — strategy library
            │     ├── fred.py          — FRED economic data
            │     └── settings.py      — credentials management
            └── services/
                  ├── risk_manager.py          ⚠️  circuit breaker
                  ├── position_tracker.py      ⚠️  live position state
                  ├── execute_order.py         ⚠️  exchange order placement
                  ├── stop_loss_executor.py    ⚠️  background stop-loss loop
                  ├── signal_queue.py          —   pending signal state
                  ├── backtest_engine.py       —   simulation engine
                  ├── macro_context.py         —   FRED regime signals
                  ├── fred_prior.py            —   Kelly calibration
                  ├── fred_service.py          —   FRED API + cache
                  ├── polymarket_client.py     —   Polymarket data
                  ├── kalshi_client.py         —   Kalshi orders
                  └── db.py                    —   PostgreSQL connection
```

---

## Database

| Database | User | Schema | Tables |
|----------|------|--------|--------|
| `polyback_db` | `polyback` | `public` | `positions`, `signals`, `risk_state`, `fred_cache`, `fred_pull_log` |

Connection string is in `.env` as `DATABASE_URL`. Do not hardcode credentials anywhere.

---

## Risk Limits (defaults — see .env to override)

| Limit | Default | Breach action |
|-------|---------|---------------|
| Per-trade size | 5% soft / 10% hard | Hard → system halt |
| Total capital at risk | 40% soft / 60% hard | Hard → system halt |
| Session drawdown | 20% | Circuit breaker trips |

A halted system will not resume until the user explicitly calls `/api/positions/risk/resume`
with a documented `override_reason`. No agent may resume a halted system autonomously.

---

## HARBOR Oversight

HARBOR (`~/openclaw/workspace-harbor`) is the designated risk reviewer for this platform.
All strategy deployments must be APPROVED by HARBOR before going live. A HARBOR VETO
or HALT cannot be overridden by any agent — only the user, in writing.
