# PolyBack v2 — Full Rebuild Specification

> **Purpose**: This document is the single source of truth for the v2 frontend rebuild.
> Agent tasks must not make architectural decisions outside this spec.
> All ambiguity is resolved here — if something isn't covered, STOP and ask.

---

## 0. Project Location

**v2 lives at**: `~/quant_project/PolyBackV2/`
**v1 stays untouched at**: `~/quant_project/Polymarket/` — do NOT modify anything there.

v2 is a fresh project. Copy only what's needed (see §12 — What NOT to Change lists
what carries forward by reference, not by symlink — files are copied and adapted).

**Ports (v2):**
- Backend (FastAPI): `8001`
- Frontend (Vite): `5174`

v1 continues to run on ports `8000` / `5173`.

---

## 1. Vision

Four full-screen "scenes" replace the current tab-based layout. Each scene owns the
entire viewport and is purpose-built for one discipline. Scenes transition via a
horizontal slide animation. A persistent minimal nav strip at the bottom switches scenes.

**Scenes (in order):**
| Index | Name | Purpose |
|-------|------|---------|
| 0 | Execution | Act on signals, manage positions, monitor risk |
| 1 | Market Research | Scan markets, explore price history, manage watchlist |
| 2 | Macro Radar | FRASER sentiment, Fed signals, regime detection |
| 3 | Strategy Lab | Backtest, optimize, validate strategies |

---

## 2. Tech Stack (no new dependencies unless noted)

- React 19 + TypeScript + Vite (existing)
- MUI + Emotion (existing)
- Plotly.js + Recharts (existing)
- **Framer Motion** — ADD THIS: `npm install framer-motion` — used only for scene transitions
- Existing `lib/apiFetch.ts`, `theme.ts`, `types.ts` — carry forward unchanged
- **NO Redux, NO Zustand** — React Context for shared state (see §4)

---

## 3. File Structure

Delete the following before starting:
- `src/components/_old_*` (5 files)
- `src/types/index.ts` (stale duplicate)
- `src/components/shared/SettingsPanel.tsx.bak`
- `src/pages/BacktestConsole.tsx` (replaced by scenes)
- `src/App.css` (unused)

**New structure:**
```
src/
  main.tsx                          # unchanged
  App.tsx                           # REWRITE: auth check → SceneShell
  theme.ts                          # unchanged
  types.ts                          # unchanged
  index.css                         # EDIT: remove body { display:flex; place-items:center }
  styles.ts                         # KEEP: reuse existing CSS classes where applicable
  lib/
    apiFetch.ts                     # unchanged
  context/
    AppContext.tsx                   # NEW: global shared state provider
  scenes/
    SceneShell.tsx                  # NEW: scene orchestrator + Framer Motion transitions
    ExecutionScene.tsx              # NEW: Scene 0
    ResearchScene.tsx               # NEW: Scene 1
    MacroScene.tsx                  # NEW: Scene 2
    StrategyScene.tsx               # NEW: Scene 3
  components/
    nav/
      SceneNav.tsx                  # NEW: bottom nav strip (4 icons)
    execution/                      # existing + new (see §7.0)
    market/                         # existing (MarketSearch, MarketCard, MarketDetail)
    macro/                          # existing (MacroPanel + all sub-components)
    backtest/                       # existing (BacktestPanel, BacktestResults, etc.)
    charts/                         # existing (all chart components)
    optimizer/                      # existing (OptimizerPanel, BatchWizardPanel)
    positions/                      # existing (PositionTracker)
    watchlist/                      # existing (Watchlist)
    forecast/                       # existing (ForecastPanel)
    shared/                         # existing (AuthStatus, LoginScreen, SettingsPanel,
                                    #   StrategyDetailPanel, RunCard, HistoryDrawer,
                                    #   ErrorBoundary, CronToggle)
```

---

## 4. Global State — AppContext

**File**: `src/context/AppContext.tsx`

This context is the ONLY shared state between scenes. Everything else is scene-local.

```typescript
interface AppState {
  // Navigation
  activeScene: 0 | 1 | 2 | 3;
  prevScene:   0 | 1 | 2 | 3;    // needed to determine slide direction

  // User/account settings (previously in BacktestConsole)
  capital:        number;          // default: parseFloat(ACCOUNT_VALUE) or 100
  executionMode:  ExecutionMode;   // "auto" | "confirm" | "alert_only"
  accountTier:    string;          // "standard" | "margin" | "daytrading"
  selectedExchange: ExchangeId;    // persisted in localStorage key "polyback_exchange"

  // Live data (polled, shared across scenes)
  signals:   Signal[];
  positions: Position[];
  alerts:    Alert[];
  riskState: RiskState | null;

  // Actions
  setActiveScene:     (scene: 0 | 1 | 2 | 3) => void;
  setCapital:         (v: number) => void;
  setExecutionMode:   (v: ExecutionMode) => void;
  setAccountTier:     (v: string) => void;
  setSelectedExchange:(v: ExchangeId) => void;
  refreshSignals:     () => Promise<void>;
  refreshPositions:   () => Promise<void>;
  refreshAlerts:      () => Promise<void>;
}
```

**RiskState interface** (add to types.ts if missing):
```typescript
interface RiskState {
  halted:           boolean;
  drawdown_pct:     number;
  total_exposure:   number;
  max_trade_pct:    number;
  max_total_pct:    number;
}
```

**Polling intervals** (inside AppContext provider):
- Signals: every 30s via `GET /api/signals?status=pending`
- Positions: every 60s via `GET /api/positions?status=open`
- Alerts: every 30s via `GET /api/alerts?unread=true`
- Risk state: every 60s via `GET /api/risk/state`

**localStorage persistence**:
- `selectedExchange` → key `"polyback_exchange"` (read on init, write on change)
- `capital` → key `"polyback_capital"`
- `executionMode` → key `"polyback_exec_mode"`
- `accountTier` → key `"polyback_tier"`

---

## 5. App.tsx (rewrite)

```tsx
// src/App.tsx
import { useState, useEffect } from 'react';
import { getToken, clearToken } from './lib/apiFetch';
import { LoginScreen } from './components/shared/LoginScreen';
import { AppProvider } from './context/AppContext';
import { SceneShell } from './scenes/SceneShell';

export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken());

  useEffect(() => {
    const handler = () => { clearToken(); setAuthed(false); };
    window.addEventListener('polyback:logout', handler);
    return () => window.removeEventListener('polyback:logout', handler);
  }, []);

  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;

  return (
    <AppProvider>
      <SceneShell />
    </AppProvider>
  );
}
```

---

## 6. SceneShell.tsx + SceneNav.tsx

### SceneShell.tsx

Owns the full viewport. Renders the active scene with Framer Motion transitions.

```tsx
// src/scenes/SceneShell.tsx
import { AnimatePresence, motion } from 'framer-motion';
import { useAppContext } from '../context/AppContext';
import { SceneNav } from '../components/nav/SceneNav';
import { ExecutionScene }  from './ExecutionScene';
import { ResearchScene }   from './ResearchScene';
import { MacroScene }      from './MacroScene';
import { StrategyScene }   from './StrategyScene';

const SCENES = [ExecutionScene, ResearchScene, MacroScene, StrategyScene];

const variants = {
  enter:  (dir: number) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit:   (dir: number) => ({ x: dir < 0 ? '100%' : '-100%', opacity: 0 }),
};

export function SceneShell() {
  const { activeScene, prevScene } = useAppContext();
  const direction = activeScene - prevScene;
  const Scene = SCENES[activeScene];

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden', background:'var(--bg)' }}>
      {/* Scene area */}
      <div style={{ flex:1, position:'relative', overflow:'hidden' }}>
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={activeScene}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column' }}
          >
            <Scene />
          </motion.div>
        </AnimatePresence>
      </div>
      {/* Persistent bottom nav */}
      <SceneNav />
    </div>
  );
}
```

### SceneNav.tsx

4-icon bottom strip. Height: 56px. No labels (icons only, tooltip on hover).

```tsx
// src/components/nav/SceneNav.tsx
// Icons (from @mui/icons-material):
//   Scene 0 Execution:       FlashOn
//   Scene 1 Market Research: Search (or TravelExplore)
//   Scene 2 Macro Radar:     Radar (or TrackChanges)
//   Scene 3 Strategy Lab:    Science (or Psychology)
//
// Active scene icon: theme accent color + bottom border 2px accent
// Inactive: muted (#666), no border
// Keyboard shortcuts: keys 1, 2, 3, 4 (no modifier) → switch scenes
//
// Layout: centered row, 4 icon buttons evenly spaced
// Background: var(--surface) or #0d1117
// Border-top: 1px solid #222
//
// Also render: top-right of nav strip → AuthStatus component (compact mode)
```

**Keyboard handler** (add to SceneNav or SceneShell):
```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === '1') setActiveScene(0);
    if (e.key === '2') setActiveScene(1);
    if (e.key === '3') setActiveScene(2);
    if (e.key === '4') setActiveScene(3);
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [setActiveScene]);
```

---

## 7. Scene Specifications

### 7.0 Scene 0 — Execution (BUILD FIRST)

**Purpose**: Act on signals. Manage positions. Monitor risk. Speed and clarity over density.

**Layout** (3-column, full height minus nav):
```
┌─────────────────┬──────────────────────┬────────────────┐
│  SIGNAL QUEUE   │    QUICK ORDER       │  ACCOUNT &     │
│  (scrollable)   │    PANEL             │  RISK STATUS   │
│                 │                      │                │
│  Active signals │  Exchange selector   │  Per-exchange  │
│  sorted by      │  Ticker input        │  buying power  │
│  confidence     │  BUY / SELL toggle   │  equity, cash  │
│                 │  Size input          │                │
│  Each signal:   │  Limit price (opt.)  │  Risk gauges:  │
│  - ticker       │  [ CONFIRM ORDER ]   │  drawdown %    │
│  - side         │                      │  exposure %    │
│  - entry price  │  Order confirmation  │  halt status   │
│  - confidence   │  card (appears after │                │
│  - strategy     │  submit)             │  Stop-loss     │
│  - exchange     │                      │  status        │
│  [ Execute ]    │                      │                │
├─────────────────┴──────────────────────┴────────────────┤
│  OPEN POSITIONS strip (horizontal scroll, full width)   │
│  Each card: ticker | side | entry | current | P&L       │
└─────────────────────────────────────────────────────────┘
```

**Column widths**: 30% | 40% | 30%

**Signal Queue** (left column):
- Source: `signals` from AppContext (filtered to `status === "pending"`)
- Sorted by `confidence` descending
- Each item is a card:
  - Header: `{ticker}` bold, `{side}` colored (BUY=green, SELL=red)
  - Body: entry price, confidence bar, strategy name, exchange badge
  - Footer: `[ Execute ]` button → pre-fills Quick Order panel
- Empty state: "No pending signals" with muted text
- Uses `GET /api/signals?status=pending` (already in AppContext poll)

**Quick Order Panel** (center column):
- Exchange `<select>` → all real-money exchanges (coinbase, robinhood, robinhood_crypto, webull)
- Ticker text input (auto-filled when signal clicked)
- BUY / SELL segmented button
- Size input (number, shares)
- Limit price input (optional — leave empty for market order)
- `[ CONFIRM ORDER ]` button → calls `POST /api/{exchange}/order`
- After submit: renders `ConfirmationCard` inline (from existing `components/execution/`)
- Execution mode indicator (from AppContext.executionMode)

**Account & Risk** (right column):
- Exchange tabs (coinbase / robinhood / webull)
- Per-exchange: buying_power, equity, cash (fetched from respective `/api/{exchange}/account`)
- Risk gauges:
  - Drawdown % (progress bar, red when > RISK_DRAWDOWN_HALT_PCT)
  - Exposure % (progress bar)
  - Halt status badge (green "Active" / red "HALTED")
- Stop-loss status: enabled/disabled, poll interval

**Positions Strip** (bottom, full width):
- Source: `positions` from AppContext (status === "open")
- Horizontal scroll if overflow
- Each card (fixed width ~180px):
  - Ticker, exchange badge
  - Side (YES/NO or BUY/SELL)
  - Entry price, current price, P&L (green/red)
  - Close button → `POST /api/positions/{id}/close`

**API endpoints used by Execution scene:**
- `GET /api/signals?status=pending` (AppContext)
- `GET /api/positions?status=open` (AppContext)
- `GET /api/risk/state` (AppContext)
- `GET /api/coinbase/account`
- `GET /api/robinhood/account`
- `GET /api/webull/account`
- `POST /api/{exchange}/order` (or exchange-specific order endpoint)
- `POST /api/positions/{id}/close`

---

### 7.1 Scene 1 — Market Research

**Purpose**: Scan and explore markets. Manage watchlist.

**Layout** (2-column, same as current v1 left/right split):
```
┌──────────────────────┬──────────────────────────────────┐
│  LEFT PANEL (340px)  │  RIGHT PANEL (flex:1)            │
│                      │                                  │
│  Exchange selector   │  MarketDetail                    │
│  MarketSearch        │  (price history, stats, charts)  │
│  MarketCard list     │                                  │
│  (scrollable)        │  ForecastPanel (below detail)    │
│                      │                                  │
│  Watchlist toggle    │  Watchlist view (if toggled)     │
└──────────────────────┴──────────────────────────────────┘
```

**Reuse directly** (minimal changes):
- `components/market/MarketSearch.tsx`
- `components/market/MarketCard.tsx`
- `components/market/MarketDetail.tsx`
- `components/watchlist/Watchlist.tsx`
- `components/forecast/ForecastPanel.tsx`

**Scene-local state:**
- `markets: Market[]`
- `selectedMarket: Market | null`
- `priceHistory: HistoryPoint[]`
- `showWatchlist: boolean`
- `exchange: ExchangeId` (synced from AppContext.selectedExchange)

---

### 7.2 Scene 2 — Macro Radar

**Purpose**: Fed/macro signals. Regime detection. FRASER NLP output.

**Layout** (full-width, vertical sections):
```
┌──────────────────────────────────────────────────────┐
│  MacroPanel (existing — full width, scrollable)      │
│  FedSentimentPanel                                   │
│  PolicyOutcomePanel                                  │
│  Charts: FraserHeatmap3D, CorrelationHeatmap, etc.  │
└──────────────────────────────────────────────────────┘
```

**Reuse directly** (no changes):
- `components/macro/MacroPanel.tsx` (contains all sub-panels)
- All 13 macro components unchanged

**Scene-local state**: none beyond what MacroPanel manages internally.

---

### 7.3 Scene 3 — Strategy Lab

**Purpose**: Backtest, optimize, and validate strategies. Review run history.

**Layout** (2-column with resizable split):
```
┌─────────────────────────┬────────────────────────────┐
│  LEFT (400px fixed)     │  RIGHT (flex:1, scrollable)│
│                         │                            │
│  Exchange selector      │  BacktestResults           │
│  BacktestPanel          │  (equity curve, trades,    │
│  StrategyControls       │   metrics)                 │
│  ParamSliders           │                            │
│  [ Run Backtest ]       │  RunsView / HistoryDrawer  │
│                         │                            │
│  OptimizerPanel         │  BatchWizardPanel          │
│  (collapsible)          │  (collapsible)             │
└─────────────────────────┴────────────────────────────┘
```

**Reuse directly**:
- `components/backtest/BacktestPanel.tsx`
- `components/backtest/BacktestResults.tsx`
- `components/backtest/StrategyControls.tsx`
- `components/backtest/ParamSliders.tsx`
- `components/optimizer/OptimizerPanel.tsx`
- `components/optimizer/BatchWizardPanel.tsx`
- `components/runs/RunsView.tsx`
- `components/shared/RunCard.tsx`
- `components/shared/HistoryDrawer.tsx`
- All chart components

**Scene-local state** (extracted from BacktestConsole.tsx):
- `markets: Market[]`, `selectedMarket: Market | null`
- `priceHistory: HistoryPoint[]`
- `strategy: string`, `strategyParams: StrategyParams`
- `backtestResult: BacktestResult | null`
- `running: boolean`
- `runHistory: HistoryRun[]`
- `dateRange: { start: string; end: string }`
- `exchange: ExchangeId` (from AppContext)
- `capital: number` (from AppContext)
- `accountTier: string` (from AppContext)

---

## 8. Settings Access

Settings (capital, execution mode, account tier, theme) move to a **slide-in drawer**
accessible from the SceneNav — a gear icon on the right side of the nav strip.

- Renders `SettingsPanel` (existing `components/shared/SettingsPanel.tsx`) inside a drawer
- Drawer uses MUI `Drawer` component, anchor="right", width=400px
- Settings changes write to AppContext (which persists to localStorage)

---

## 9. AuthStatus Placement

`AuthStatus` component renders inside SceneNav on the right side (compact, inline).
Remove from wherever it was previously rendered in BacktestConsole.

---

## 10. CSS / Styling Rules

- Keep `styles.ts` globalCss for any classes reused by existing components
- New scene layouts use **inline styles only** (no new CSS classes)
- CSS variables (already set by `theme.ts`): `--bg`, `--surface`, `--accent`, `--text`, `--muted`
- If a CSS variable isn't defined in `theme.ts`, add it there — do not hardcode hex colors in components
- `index.css`: remove `body { display:flex; place-items:center; }` — replace with:
  ```css
  body { margin: 0; padding: 0; }
  #root { height: 100vh; overflow: hidden; }
  ```

---

## 11. Build Order for Agents

Execute in this order — each phase is a discrete agent task:

| Phase | Task | Files | Agent |
|-------|------|-------|-------|
| 1 | Foundation | `context/AppContext.tsx`, `App.tsx` (rewrite), `index.css` (edit) | CODEX |
| 2 | Shell + Nav | `scenes/SceneShell.tsx`, `components/nav/SceneNav.tsx` | FORGE |
| 3 | Execution Scene | `scenes/ExecutionScene.tsx` + any new execution sub-components | FORGE |
| 4 | Research Scene | `scenes/ResearchScene.tsx` (wires existing market/ components) | FORGE |
| 5 | Macro Scene | `scenes/MacroScene.tsx` (wires existing macro/ components) | FORGE |
| 6 | Strategy Scene | `scenes/StrategyScene.tsx` (wires existing backtest/ components) | FORGE |
| 7 | Settings Drawer | Add gear icon + MUI Drawer to SceneNav, wire SettingsPanel | FORGE |
| 8 | TypeScript check | `cd frontend && npx tsc --noEmit` — fix ALL errors | CODEX |
| 9 | Integration test | Smoke test all 4 scenes, transitions, keyboard shortcuts | — |

**STOP rule**: If any phase fails to compile cleanly, do not proceed to the next phase.

---

## 12. What NOT to Change

- `backend/` — entirely unchanged
- `lib/apiFetch.ts` — unchanged
- `theme.ts` — unchanged (may add CSS variables if needed)
- `types.ts` — unchanged (may add `RiskState` if missing)
- All existing component logic — scenes are wrappers, not rewrites of component internals
- Auth flow (LoginScreen, JWT handling) — unchanged

---

## 13. API Endpoint Reference

All existing backend routes carry forward unchanged:

| Endpoint | Method | Used by |
|----------|--------|---------|
| `/api/signals` | GET | AppContext, Execution |
| `/api/positions` | GET/POST | AppContext, Execution |
| `/api/alerts` | GET | AppContext |
| `/api/risk/state` | GET | AppContext, Execution |
| `/api/coinbase/account` | GET | Execution |
| `/api/robinhood/account` | GET | Execution |
| `/api/webull/account` | GET | Execution |
| `/api/markets` | GET | Research, Strategy |
| `/api/backtest/run` | POST | Strategy |
| `/api/backtest/history` | GET | Strategy |
| `/api/optimize/run` | POST | Strategy |
| `/api/fraser/*` | GET | Macro |
| `/api/forecast/grade` | GET | Research |
| `/api/watchlist` | GET/POST/DELETE | Research |

---

## 14. Definition of Done

- [ ] All 4 scenes render without error
- [ ] Scene transitions animate correctly in both directions
- [ ] Keyboard shortcuts 1–4 switch scenes
- [ ] AppContext polling works (signals/positions/alerts refresh)
- [ ] Settings drawer opens/closes, persists changes
- [ ] Execution scene: signal click pre-fills order panel
- [ ] TypeScript: `npx tsc --noEmit` exits clean
- [ ] No console errors on load
- [ ] Auth flow unchanged (login, logout, token expiry)
- [ ] All 3 themes still apply correctly
