# PolyBack — Claude Code Context Package
# Generated: 2026-03-11
# Purpose: Restore full project memory after session reset

---

## WHAT THIS PROJECT IS

PolyBack is a Polymarket quantitative trading platform with three modes:
historical backtesting, live signal execution, and position tracking.

Stack: FastAPI (Python, port 8000) + React 18 / TypeScript (Vite, port 5173)
Location: ~/quant_project/Polymarket

To run:
  # Backend
  cd ~/quant_project/Polymarket && source venv/bin/activate
  uvicorn backend.main:app --reload --port 8000

  # Frontend (separate terminal)
  cd ~/quant_project/Polymarket/frontend && npm run dev
  # Open http://localhost:5173

---

## ARCHITECTURE

### Backend (backend/, FastAPI)

  backend/
  ├── main.py                        # FastAPI app, router registration
  ├── config.py                      # Settings & auth config (.env)
  ├── models/
  │   └── schemas.py                 # Pydantic models
  ├── routes/
  │   ├── markets.py                 # GET /api/markets — Gamma API + 3-layer category detection
  │   ├── backtest.py                # POST /api/backtest/batch — runs engine
  │   ├── strategies.py              # GET /api/strategies — returns ALL_STRATEGIES
  │   ├── signals.py                 # Signal queue CRUD; approve → opens position
  │   ├── positions.py               # Open/closed position store; close, prob update, summary
  │   └── feed.py                    # Live CLOB snapshot, order book, recent trades
  └── services/
      ├── backtest_engine.py         # Core engine (5 strategies implemented)
      ├── position_tracker.py        # In-memory open/closed position store (singleton)
      ├── signal_queue.py            # In-memory pending/approved/rejected signal store
      ├── execute_order.py           # Dispatches by mode: auto/confirm/alert_only
      └── alert_service.py           # Alert log for alert_only mode

All state is in-memory — lost on restart. SQLite persistence is NEXT PRIORITY.

### Frontend (frontend/src/)

  main.tsx → App.tsx → BacktestConsole (pages/BacktestConsole.tsx)

  BacktestConsole owns all state and switches views via `view` state variable.

  Views (nav buttons in header):
  ┌────────────┬─────────────────────────────────────────────────────────────────┐
  │ Backtest   │ Market search, strategy carousel + param sliders, batch run,    │
  │            │ results with equity/PnL charts                                  │
  ├────────────┼─────────────────────────────────────────────────────────────────┤
  │ Signals    │ Live-polling signal queue (5s), confirm/reject/modify cards,    │
  │            │ execution log                                                    │
  ├────────────┼─────────────────────────────────────────────────────────────────┤
  │ Positions  │ Live prob simulation (2s random drift), backend poll (5s),      │
  │            │ risk gauges, position detail sidebar, close modal               │
  ├────────────┼─────────────────────────────────────────────────────────────────┤
  │ History    │ Closed trade log, cumulative PnL chart, strategy breakdown      │
  │            │ (recharts) — falls back to mock if backend empty                │
  ├────────────┼─────────────────────────────────────────────────────────────────┤
  │ Strategies │ 5-tab strategy detail panel (Overview, Formula, Parameters,     │
  │            │ Performance, Risks) + Custom Strategy creator modal             │
  ├────────────┼─────────────────────────────────────────────────────────────────┤
  │ Feed       │ Live Polymarket CLOB — order book + recent trades, 8s poll      │
  └────────────┴─────────────────────────────────────────────────────────────────┘

  Layout rule: Backtest uses className="layout" (340px + 1fr grid).
  All other views use: style={{ display:"flex", flex:1, overflow:"hidden" }}

  Key component files:
  - src/pages/BacktestConsole.tsx                — main orchestrator
  - src/components/positions/PositionTracker.tsx — Positions view
  - src/components/history/HistoryView.tsx       — History view (recharts)
  - src/components/shared/StrategyDetailPanel.tsx — Strategies view (5 tabs + create modal)
  - src/components/backtest/ParamSliders.tsx     — strategy parameter sliders
  - src/components/execution/SignalQueue.tsx     — Signals view
  - src/components/feed/LiveFeed.tsx             — Feed view

---

## STRATEGY LAYER

7 strategies defined in backend/strategies/__init__.py (ALL_STRATEGIES list).
Each has: id, name, tagline, category, risk, complexity, color, status,
          params (list of {name,label,default,min,max,step,desc}),
          formula, description, logic, edge, risks, performance, synthetic_curve

  ┌───────────────────┬───────────────────┬──────────────┬────────────────────┐
  │ ID                │ Name              │ Color        │ Status             │
  ├───────────────────┼───────────────────┼──────────────┼────────────────────┤
  │ threshold         │ Threshold         │ #00d4a8      │ ✅ live            │
  │ momentum          │ Momentum Chaser   │ #f59e0b      │ ✅ live            │
  │ zscore_reversion  │ Z-Score Reversion │ #7b61ff      │ ✅ live            │
  │ kelly             │ Kelly Criterion   │ #22c55e      │ ✅ live            │
  │ mean_reversion    │ Mean Reversion    │ #f97316      │ ✅ live            │
  │ market_making     │ Market Making     │ #ef4444      │ ✅ live            │
  │ structure_harvest │ Structure Harvest │ #f97316      │ 🔜 soon            │
  └───────────────────┴───────────────────┴──────────────┴────────────────────┘

Custom strategies created in the UI are local state only (not persisted).

---

## CATEGORY DETECTION (routes/markets.py)

3-layer detection in _normalize():
  1. _category_from_tags()   — TAG_MAP with 80+ Gamma API tag labels → canonical category
  2. _categorize_from_text() — keyword match against market question text
  3. _categorize_from_text() — keyword match against slug as final fallback

Categories: Politics, Crypto, Sports, Economics, Science & Tech, Pop Culture, Other

---

## DATA FLOW

  Polymarket Gamma API → /api/markets → MarketSearch (frontend)
                                       → user queues markets
                                       → POST /api/backtest/batch
  CLOB API → price history (HISTORICAL) → backtest_engine → BatchBacktestResult

  IMPORTANT: Backtest uses HISTORICAL price data, not live prices.
  Feed tab is the only screen showing real-time CLOB data.

  Signal generated → execute_order() → confirm → SignalQueue (frontend)
                                     → auto    → position_tracker
                                     → alert   → alert_service

  position_tracker → /api/positions         → PositionTracker (frontend)
                   → /api/positions/closed  → HistoryView (recharts)

---

## NEXT PRIORITY — SQLite Persistence (Gap #1)

ALL in-memory state is lost on restart. Need to persist:

  1. positions (open + closed)
     - Table: positions
     - Fields match Position dataclass: id, market_title, condition_id,
       strategy, side, entry_price, exit_target, stop_loss, shares, capital,
       current_prob, entry_date, closed_at, realized_pnl, category,
       exit_prob, close_reason
     - Singleton store in position_tracker.py → replace with DB reads/writes

  2. signals (pending / approved / rejected)
     - Table: signals
     - Fields match SignalSchema: all signal fields + status
     - signal_queue.py → replace with DB reads/writes

  3. custom strategies (created via UI modal)
     - Table: custom_strategies
     - Fields: same as ALL_STRATEGIES dict shape (JSON blob for params/risks/logic)
     - Currently only in frontend local state — need backend endpoint +
       frontend to POST on save and GET on load

  Plan:
  - DB file: ~/quant_project/Polymarket/backend/polyback.db
  - Use Python stdlib sqlite3 (sync, simple) wrapped in run_in_executor,
    OR aiosqlite for native async
  - Create db.py module: connection pool, table init (CREATE TABLE IF NOT EXISTS)
  - Replace in-memory dicts in position_tracker.py and signal_queue.py
  - Add GET/POST /api/strategies/custom endpoint (routes/strategies.py)
  - Frontend StrategyDetailPanel: load custom strategies from /api/strategies/custom
    on mount, POST new ones on save

---

## PLANNED FUTURE FEATURE — Live Order Screen

A dedicated view for placing real orders on Polymarket CLOB.
Groundwork already in place:
  - feed.py has live order book + trades
  - execute_order.py has _submit_to_clob() stub
  - config.py handles API key / L2 auth
The new screen ties those together with a real order placement UI.
Needs: Polymarket API key + L2 auth credentials in .env

---

## REMAINING GAPS (lower priority)

  Gap #4 — Integration/news feed
    No real-time context for open positions.
    Plan: sidebar widget in PositionTracker showing relevant news/resolution events.

  Gap #8 — Pagination
    Market list capped at 100. Plan: load-more or infinite scroll in MarketSearch.

---

## DESIGN SYSTEM

  Colors:
    --teal:   #00d4a8   (primary accent, Threshold)
    --amber:  #f59e0b   (warning / Momentum)
    --red:    #ef4444   (danger / Market Making)
    --green:  #22c55e   (profit / Kelly)
    --purple: #7b61ff   (Z-Score Reversion)
    --orange: #f97316   (Mean Reversion / Structure Harvest)
    --bg:     #0a0c0f
    --bg2:    #111318
    --bg3:    #181c23
    --border: #1e2330
    --border2:#252d3d

  Typography: IBM Plex Mono (data/labels) + IBM Plex Sans (body) + Syne (headings)

---

## COMPLETED THIS SESSION

  ✅ Gap #9  — StrategyDetailPanel (5-tab detail view, all strategies fully populated)
  ✅ Gap #7  — Category detection (3-layer: TAG_MAP + question text + slug)
  ✅ Layout  — Non-backtest views were stuck in 340px grid column, fixed to flex:1
  ✅ Custom  — + Custom Strategy modal (name, formula, logic, colour, etc.)
  ✅ Crash   — StrategyDetailPanel null guards (MiniEquityCurve, performance, risks, logic)

## GIT

  Repo: github.com:d8abusa/Poly-Back.git
  Branch: main
  Latest commits:
    feat: custom strategy creator modal
    feat: strategy detail panel, layout fixes, and category detection
