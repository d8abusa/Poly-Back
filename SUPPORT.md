# PolyBack Support Documentation

**Last Updated:** 2026-03-22
**Status:** ✅ Fully Operational
**Backtester:** ✅ Running

---

## System Inventory

### Backend Stack (Python 3.13)

| Component | Status | Requirements |
|-----------|--------|--------------|
| **Python Version** | ✅ Installed | 3.11+ (confirmed: 3.13) |
| **FastAPI** | ✅ Installed | >= 0.115.0 |
| **Uvicorn** | ✅ Installed | >= 0.30.0 |
| **httpx** | ✅ Installed | >= 0.27.0 (async HTTP client) |
| **Pydantic** | ✅ Installed | >= 2.7.0 (data validation) |
| **NumPy** | ✅ Installed | >= 1.26.0 (numerical computing) |
| **pandas** | ✅ Installed | >= 2.2.0 (data analysis) |
| **python-dotenv** | ✅ Installed | >= 1.0.0 (environment variables) |
| **scikit-learn** | ✅ Installed | >= 1.4.0 (machine learning utilities) |
| **xgboost** | ✅ Installed | >= 2.0.0 (gradient boosting) |
| **psycopg2-binary** | ✅ Installed | >= 2.9.0 (SQL database adapter) |

### Frontend Stack (React 19)

| Component | Status | Version |
|-----------|--------|---------|
| **Node.js** | ✅ Installed | 18+ (confirmed: ≥ 18) |
| **npm** | ✅ Installed | 9+ (confirmed: ≥ 9) |
| **React** | ✅ Installed | ^19.2.0 |
| **React DOM** | ✅ Installed | ^19.2.0 |
| **TypeScript** | ✅ Installed | ~5.9.3 |
| **Vite** | ✅ Installed | ^7.3.1 (build tool) |
| **Recharts** | ✅ Installed | ^3.8.0 (charting library) |
| **eslint** | ✅ Installed | ^9.39.1 (code quality) |
| **@eslint/js** | ✅ Installed | ^9.39.1 |
| **eslint-plugin-react-hooks** | ✅ Installed | ^7.0.1 |
| **eslint-plugin-react-refresh** | ✅ Installed | ^0.4.24 |
| **@types/node** | ✅ Installed | ^24.10.1 |
| **@types/react** | ✅ Installed | ^19.2.7 |
| **@types/react-dom** | ✅ Installed | ^19.2.3 |
| **@vitejs/plugin-react** | ✅ Installed | ^5.1.1 |
| **globals** | ✅ Installed | ^16.5.0 |

### Build Tools & Dependencies

| Tool | Status | Notes |
|------|--------|-------|
| **git** | ✅ Available | Version control |
| **venv** (Python) | ✅ Available | Virtual environment support |
| **pip** | ✅ Available | Package installer |
| **tsc** (TypeScript compiler) | ✅ Available | Build tool (via TypeScript) |

---

## Runtime Configuration

### Backend Port
- **FastAPI/Uvicorn:** `port 8000`
- **Live Documentation:** `http://localhost:8000/docs`

### Frontend Port
- **Vite Dev Server:** `port 5173`
- **Application URL:** `http://localhost:5173`

### Data Integration
- **Polymarket Public API:** CLOB + Gamma API (read-only access)
- **Authentication:** EIP-712 signed wallet credentials (optional)
- **API Levels:**
  - 🟢 Green: Full Auth (order placement/cancellation)
  - 🟡 Amber: API Only (private account data)
  - ⚪ Grey: Public (read-only markets)

---

## Service Endpoints (Backend)

### Markets
- `GET /api/markets` — Search markets
- `GET /api/markets/tags` — Category tags
- `GET /api/markets/{condition_id}` — Market detail
- `GET /api/markets/{condition_id}/history` — Price history

### Backtest
- `POST /api/backtest` — Single backtest
- `POST /api/backtest/batch` — Batch backtest
- `GET /api/strategies` — Strategy catalogue

### Live Feed
- `GET /api/feed/snapshot` — Combined order book + trades + price + market status
- `GET /api/feed/book` — Order book only
- `GET /api/feed/trades` — Recent trades
- `GET /api/feed/auth/status` — Auth level and capabilities

### Execution
- `GET /api/signals` — Pending signal queue
- `POST /api/signals/{id}/approve` — Approve signal
- `POST /api/signals/{id}/reject` — Reject signal
- `GET /api/positions` — Open positions
- `GET /api/positions/closed` — Closed position history
- `POST /api/positions/{id}/close` — Close position

---

## Supported Backtest Strategies

| Strategy | Description | Key Parameters |
|----------|-------------|----------------|
| `threshold` | Buy when prob ≤ entry threshold, sell when prob ≥ exit threshold | `entry_threshold`, `exit_threshold`, `stop_loss` |
| `momentum` | Buy when probability trend is rising, sell when falling | `entry_threshold`, `exit_threshold`, `stop_loss` |
| `zscore_reversion` | Mean-reversion on rolling z-score of probability | `zscore_window`, `zscore_entry`, `zscore_exit`, `zscore_stop` |
| `kelly` | Kelly criterion position sizing with dynamic win-rate | `kelly_fraction`, `entry_threshold`, `exit_threshold` |
| `market_making` | Straddle bid/ask around midpoint | `mm_spread`, `stop_loss` |

---

## Execution Modes

| Mode | Behavior | Requirements |
|------|----------|--------------|
| **Confirm** | Signals appear in queue — manual approval/rejection | None (Full Auth recommended) |
| **Auto** | Signals execute immediately | Full Auth required |
| **Alert Only** | Signals logged but never executed | None |

---

## Common Issues

### Backend Won't Start
```bash
cd ~/quant_project/Polymarket
source venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

### Frontend Won't Start
```bash
cd ~/quant_project/Polymarket/frontend
npm install
npm run dev
```

### Port Already in Use
- Backend: Change `--port` argument (e.g., `--port 9000`)
- Frontend: Check `vite.config.ts` or use `--port 5174`

### Environment Variables Missing
- Edit `.env` file in root directory
- Required vars: `POLY_API_KEY`, `POLY_API_SECRET`, `POLY_API_PASSPHRASE`, `POLY_PRIVATE_KEY`, `POLY_CHAIN_ID`

### Module Not Found Errors
```bash
# Backend
source venv/bin/activate
pip install -r requirements.txt

# Frontend
cd frontend
npm install
```

---

## Development Workflow

### Initial Setup
1. Clone repository
2. Install dependencies (backend + frontend)
3. Configure `.env` with API credentials
4. Start backend (port 8000)
5. Start frontend (port 5173)

### Hot Reload
- Backend: Auto-reloads when files change (via `--reload` flag)
- Frontend: Vite provides instant HMR for development

### Building for Production
```bash
# Backend (if needed)
uvicorn backend.main:app --host 0.0.0.0 --port 8000

# Frontend
cd frontend
npm run build
# Output: frontend/dist/
```

---

## Storage State

**Important Note:**
- Position and signal state is **in-memory only**
- State **resets on backend restart**
- **SQLite persistence is planned for future** (not currently implemented)

---

## Support Channels

- **Project Repository:** `https://github.com/d8abusa/Polymarket`
- **API Reference:** `http://localhost:8000/docs`
- **Issues:** Report via GitHub Issues

---

## Known Limitations

1. **No persistent storage** — State lost on restart
2. **Data polling** — Live feed polls every 8 seconds by default
3. **Snapshot data** — Historical coverage varies by asset (BTC, ETH, SOL)
4. **Manual process state reset** — Positions/signals must be manually recreated after restart

---

## Maintenance Checklist

- [ ] Run `uvicorn --reload` in active terminal
- [ ] Run `npm run dev` in active terminal
- [ ] Verify backend accessible at `http://localhost:8000`
- [ ] Verify frontend accessible at `http://localhost:5173`
- [ ] Validate API endpoints in Swagger docs
- [ ] Check `.env` variables have correct values
- [ ] Monitor system resources (especially Node/npm and Python/venv)