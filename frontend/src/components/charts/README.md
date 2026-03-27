# Visualization Components — AXIOM

This directory contains visualization components for quantitative research and backtest analysis.

## Components

### 1. StrategyPerformanceDashboard.tsx
Displays key performance metrics for a strategy in a compact card layout.

**Required Props:**
- `result`: BacktestResult object from backend
- `strategyName`: string label for the strategy

**Metrics Shown:**
- Sharpe Ratio (target: ≥1.0)
- Max Drawdown (target: <25% medium-risk)
- Win Rate (target: ≥55%)
- Total Return (vs initial capital)
- Profit Factor (future implementation)
- Total Trades (sample size validation)

**Status Indicators:**
- Green: meets target / acceptable
- Yellow: within acceptable range (monitor)
- Red: problematic (exceeds threshold)
- Gray: insufficient data

**Usage:**
```tsx
import StrategyPerformanceDashboard from "./components/charts/StrategyPerformanceDashboard";

<StrategyPerformanceDashboard
  result={backtestResult}
  strategyName="Threshold Strategy"
/>
```

---

### 2. BacktestChart.tsx
Shows the equity curve evolution over time with entry/exit markers.

**Required Props:**
- `result`: BacktestResult object
- `strategyName`: string label

**Features:**
- Equity curve with baseline at 1.0X
- Entry markers (green dots with "B" label)
- Exit markers (red dots with "S" label)
- Interactive tooltip showing date, equity, price, and trade details
- Color-coded profit/loss indicators
- Normalized to initial capital for comparison

**Data Requirements:**
- `equity_curve[]` must have ≥2 points
- `trades[]` may be empty (no markers)

**Usage:**
```tsx
import BacktestChart from "./components/charts/BacktestChart";

<BacktestChart
  result={backtestResult}
  strategyName="Mean Reversion Strategy"
/>
```

---

### 3. DrawdownChart.tsx
Analyzes peak-to-trough drawdowns with recovery statistics.

**Required Props:**
- `result`: BacktestResult object
- `strategyName`: string label

**Features:**
- Cumulative drawdown from peak equity
- Max drawdown event highlighting (peak + trough)
- Duration and recovery time calculation
- Interactive tooltip with detailed metrics
- Optional cumulative return baseline

**Data Requirements:**
- `equity_curve[]` must have ≥5 points (statistical significance)
- `trades[]` improves duration calculation accuracy

**Usage:**
```tsx
import DrawdownChart from "./components/charts/DrawdownChart";

<DrawdownChart
  result={backtestResult}
  strategyName="Kelly Criterion Strategy"
/>
```

---

## Integration in Parent Components

All charts accept standard React event handlers (`onMouseMove`, `onMouseLeave`) for interactivity.

### Example Integration

```tsx
import React from "react";
import { BacktestResult } from "./types";
import StrategyPerformanceDashboard from "./components/charts/StrategyPerformanceDashboard";
import BacktestChart from "./components/charts/BacktestChart";
import DrawdownChart from "./components/charts/DrawdownChart";

const BacktestResultsView: React.FC = () => {
  const [selectedResult] = useState<BacktestResult | null>(null);

  if (!selectedResult) {
    return (
      <div style={{ padding: "20px", color: "#606880" }}>
        Select a backtest to view results
      </div>
    );
  }

  return (
    <div style={{ padding: "20px" }}>
      {/* Performance Dashboard */}
      <StrategyPerformanceDashboard
        result={selectedResult}
        strategyName={selectedResult.condition_id}
      />

      {/* Charts */}
      <div style={{ marginTop: "20px" }}>
        <BacktestChart
          result={selectedResult}
          strategyName={selectedResult.condition_id}
        />
      </div>

      <div style={{ marginTop: "20px" }}>
        <DrawdownChart
          result={selectedResult}
          strategyName={selectedResult.condition_id}
        />
      </div>
    </div>
  );
};

export default BacktestResultsView;
```

---

## Data Flow

```
Backend API
    ↓
BacktestResult (JSON response)
    ↓
Parent Component (state)
    ↓
Chart Components (via props)
```

**Schema:**
```typescript
interface BacktestResult {
  success: boolean;
  error?: string;
  condition_id: string;
  initial_capital: number;
  final_value: number;
  total_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  total_trades: number;
  win_rate: number;
  equity_curve: EquityPoint[];
  trades: TradeEntry[];
}
```

---

## Styling Requirements

All components use CSS Variables for theming:
- `--card-bg`: Card background color (default: #12161d)
- `--border`: Border color (default: #1e2330)
- `--accent`: Primary accent color (default: #00d4a8)

Charts include built-in SVG styling with default values defined in components directly.

---

## Future Enhancements (Phase 2-3)

See `VIZ.md` for planned visualizations:
- PnLDistribution.tsx (enhanced): Cumulative distribution, probability bands
- TradeTimeline.tsx: Detailed trade sequence view
- VolumeChart.tsx: Trading volume trends over time
- KellySizingTable.tsx: Fractional Kelly recommendations table
- ParamSensitivityChart.tsx: Heatmap for parameter ranges
- StrategyComparison.tsx: Side-by-side strategy comparison
- DailyPnLStream.tsx: Daily profit/loss breakdown

---

## Troubleshooting

### Chart Not Rendering
- Verify `result.success === true`
- Check `equity_curve[]` has length ≥ 2 or ≥ 5 (depending on chart)
- Ensure `BacktestResult` type matches backend schema

### Tooltip Not Working
- Ensure parent container handles SVG events correctly
- Check event propagation isn't blocked
- Verify tooltips are positioned absolutely within relative container

### Stacking Context Issues
- Some charts use absolute positioning for tooltips (check z-index)
- SVG containers should have explicit height to avoid overflow

---

## Version

**Phase 1 Release:** 2026-03-22
**Author:** AXIOM (Quantitative Research Engine)

---

## Related Documentation

- `VIZ.md`: Complete visualization strategy and implementation roadmap
- `../../types.ts`: TypeScript type definitions for all data structures
- `../../utils.ts`: Utility functions (genCurve, etc.)

**Questions?** Report issues to FORGE or consult `VIZ.md` for design rationale.