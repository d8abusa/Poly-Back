# HistoryView Integration Guide

## 1. Drop the file
Copy `HistoryView.tsx` into:
  frontend/src/components/HistoryView.tsx

## 2. Import in BacktestConsole.tsx
```tsx
import HistoryView from "./HistoryView";
```

## 3. Add "History" to the nav tabs
Find your nav tab array (Backtest · Signals · Positions) and add History:
```tsx
{["Backtest", "Signals", "Positions", "History"].map(tab => (
  <button
    key={tab}
    className={view === tab ? "nav-tab active" : "nav-tab"}
    onClick={() => setView(tab)}
  >
    {tab}
  </button>
))}
```

## 4. Render the view
In your view switch (wherever you render <PositionTracker /> etc.):
```tsx
{view === "History" && <HistoryView />}
```

## 5. Backend route (already exists per Claude Code output)
The component calls:  GET /api/positions/closed

Make sure `routes/positions.py` returns a list shaped like:
```python
{
  "id": int,
  "market": str,
  "category": str,
  "side": "YES" | "NO",
  "entry_prob": float,
  "exit_prob": float,
  "shares": int,
  "strategy": str,
  "opened_at": ISO str,
  "closed_at": ISO str,
  "realized_pnl": float,
  "close_reason": "target" | "stop_loss" | "manual" | "resolution"
}
```

If `close_reason` isn't tracked yet, add it to `position_tracker.py`'s
`close_position()` method and accept it as a parameter from the routes.

## 6. Recharts dependency
HistoryView uses recharts. If not already installed:
  cd frontend && npm install recharts
