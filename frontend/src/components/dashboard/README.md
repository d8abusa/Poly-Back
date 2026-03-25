# Dashboard Components

This directory contains React components for the risk monitoring dashboard implementation based on HARBOR requirements.

## Components

### MainDashboard
Primary dashboard component displaying real-time risk metrics.

**Props:**
```typescript
interface DashboardProps {
  positions: Position[];
  portfolio: Portfolio;
  backtestResults?: any;
}
```

**Features:**
- Risk level monitoring (WATCH/WARNING/ALERT/URGENT/HALT)
- Portfolio overview with drawdown and exposure
- Positions table with SL/TP and PnL
- Circuit breaker alert system
- Backtest results integration

**Usage:**
```tsx
import MainDashboard from './components/dashboard/MainDashboard';

function App() {
  const positions = [...];
  const portfolio = {...};
  const backtestResults = {...};

  return (
    <MainDashboard
      positions={positions}
      portfolio={portfolio}
      backtestResults={backtestResults}
    />
  );
}
```

### BacktestResults
Component displaying historical backtest performance metrics.

**Props:**
```typescript
interface BacktestResultsProps {
  results: any;
}
```

**Features:**
- 6 key metrics (Return, Trade Count, Win Rate, Max DD, Sharpe, Leverage)
- Interactive metric cards
- Placeholder equity curve chart (SVG)

**Usage:**
```tsx
import BacktestResults from './components/dashboard/BacktestResults';

function PortfolioOverview() {
  const results = {...};

  return (
    <BacktestResults results={results} />
  );
}
```

## Types

Shared types are defined in `src/types/index.ts`:

- `Position`: Individual position data (market, prices, SL/TP, pnl)
- `Portfolio`: Portfolio aggregate statistics
- `RiskLevel`: String enum for risk states
- `BacktestRequest`, `BacktestResult`, `BacktestTrade`, `Signal`, `MarketData`
  for API interactions

## Risk Level System

### Five Risk Levels
1. **WATCH** - Normal operation
2. **WARNING** - Caution, position size concerns
3. **ALERT** - Amber tint, moderate warning
4. **URGENT** - Red pulsing, critical attention
5. **HALT** - Emergency, no trading

### HARBOR Constants
```typescript
const RISK_LIMITS = {
  drawdown: { watch: 10, alert: 15, halt: 20 },
  exposure: { watch: 40, alert: 50, halt: 60 },
  position: { watch: 5, alert: 7, halt: 10 },
  dailyLoss: { watch: 2, alert: 3.5, halt: 5 },
  concentration: { watch: 6, alert: 8, halt: 10 }
};
```

## Architecture

### Component Tree
```
MainDashboard
├── CircuitBreakerAlert (conditional)
├── RiskAlertBanners (array)
├── PortfolioOverviewCard
├── DrawdownMonitorWidget
├── ExposureControlWidget
├── PositionsTable
├── BacktestResults
└── RiskLimitReference
```

### State Management
- Local state for risk level, alerts, circuit breaker
- Derived state from props for metrics
- No complex state management required

### Styling
- Uses Material UI (MUI) components and theming
- Custom colors from MUI theme palette
- Grid-based responsive layout
- Conditional styling based on risk levels

## API Integration

### Required Endpoints
- `GET /api/portfolio` - Portfolio statistics
- `GET /api/positions` - Open positions
- `GET /api/backtest-results` - Historical performance

### WebSocket (Future)
For real-time updates, WebSocket connection recommended for:
- Live position changes
- Price updates
- Risk parameter changes

## Development Notes

1. **Conditional Rendering**: Components conditionally render based on data availability
2. **Error Handling**: Need to add error boundaries and loading states
3. **Type Safety**: TypeScript ensures type consistency
4. **Responsive**: Grid layout adapts to screen sizes
5. **Accessibility**: MUI components provide built-in accessibility

## Testing Checklist

- [ ] Risk level badges render correctly
- [ ] Circuit breaker triggers at HALT threshold
- [ ] Drawdown ceiling shows proper color coding
- [ ] Exposure limits reference displays
- [ ] Position table shows all required fields
- [ ] Backtest metrics render (when data available)
- [ ] Responsive behavior on mobile
- [ ] Loading states for async data
- [ ] Error boundaries for API failures

## Future Enhancements

- Real-time WebSocket updates
- Interactive equity curve with charts library
- Risk limit custom configuration
- Multi-asset exposure breakdown
- Historical drawdown analysis
- Export functionality
- User configuration persistence
- Dark mode support

## References

- HARBOR Requirements: `team-review/risk-dashboard-requirements.md`
- Wireframe Specification: `team-review/risk-dashboard-wireframe.md`