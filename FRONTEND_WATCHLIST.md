# Watchlist Feature - Frontend Implementation

## Overview
The watchlist feature allows users to track specific markets with alerts for price movements. This is an add-on to the main Backtest Console, providing real-time monitoring capabilities.

## Files Created

### 1. `/frontend/src/api/watchlistClient.ts`
API client module that communicates with the backend watchlist endpoints:
- `getWatchlist()` - Fetch all watchlist items
- `addWatchlistItem()` - Add a market to the watchlist
- `removeWatchlistItem()` - Remove a market from watchlist
- `getAlerts()` - Fetch all triggered alerts
- `getUnreadAlerts()` - Fetch unread alerts
- `createAlert()` - Create a new price trigger alert
- `dismissAlert()` - Dismiss a triggered alert
- `markAlertRead()` - Mark an alert as read
- `checkTriggers()` - Internal: check for alert triggers

### 2. `/frontend/src/components/watchlist/Watchlist.tsx`
Main watchlist component with full Material-UI interface:
- Displays watchlist with category filtering (Political, Economic, Crypto, Other)
- Shows category chips for each market
- Add/remove markets via dialog dialogs
- Create price alerts (target/stop-loss, above/below threshold)
- Displays active alerts with dismiss/mark-read actions
- Toast notifications for actions
- Auto-checking indicator (60s interval)
- Responsive design with hover states and tooltips

### 3. Modified Files

#### `/frontend/src/types/index.ts`
- Added `ExecutionMode` type: `'confirm' | 'auto' | 'simulation'`
- Added `View` enum: includes `'watchlist'` as a new view option

#### `/frontend/src/pages/BacktestConsole.tsx`
- Imported `Watchlist` component
- Added `'watchlist'` to the view enum
- Added watchlist view case in JSX rendering
- Added `'watchlist'` button to navigation bar

## Usage

### Accessing the Watchlist
1. Navigate to the Backtest Console
2. Click the **"Watchlist"** button in the top navigation bar
3. The watchlist view opens in the main content area

### Adding a Market to Watchlist
1. Click the **"Add Market"** button in the watchlist header
2. Enter:
   - **Market ID**: The unique identifier (e.g., "1001")
   - **Market Title**: Human-readable name (e.g., "Will Bitcoin reach $100k?")
   - **Category**: Political, Economic, Crypto, or Other
3. Click **"Add Market"**

### Creating a Price Alert
1. Click on any watchlist item row (this opens the alert creation dialog)
2. Enter a **Price Threshold** (in USD)
3. Select **Price Type**:
   - **Target**: Alert when price hits this level
   - **Stop Loss**: Alert to exit position
4. Select **Direction**: Above or Below the threshold
5. Click **"Create Alert"**

### Managing Alerts
- **Dismiss**: Remove an alert from the unread list
- **Mark Read**: Mark an alert as read (removes the "New Alert" indicator)
- Alerts appear in a summary section with severity colors
  - Target alerts = Warning
  - Stop-loss alerts = Error

### Filtering by Category
Use the category chips (Political, Economic, Crypto, Other) to filter the watchlist display:

## Features

### Real-time Monitoring
- Prices are automatically checked every 60 seconds for trigger conditions
- Triggered alerts fire immediately when conditions are met
- Alerts persist until dismissed or marked as read

### UI Features
- Material-UI components for professional appearance
- Toast notifications for user feedback
- Responsive design with hover effects
- Color-coded category chips
- Tooltips for long market titles

### UX Features
- Quick add via dialog forms
- Confirmation before removal
- Visual indicators for new alerts (red badge)
- Auto-dismiss of read alerts
- Disabled state validation (prevent creation without data)

## Integration Points

The watchlist is fully integrated into the existing Backtest Console:
- Uses the same Material-UI style context
- Follows the same view navigation pattern
- Compatible with existing data fetching patterns
- No breaking changes to existing functionality

## Backend Requirements

The backend must provide these endpoints:
- `GET /api/watchlist` - List watchlist items
- `POST /api/watchlist` - Add watchlist item
- `DELETE /api/watchlist/item/{id}` - Remove watchlist item
- `GET /api/watchlist/alerts` - Get all alerts
- `GET /api/watchlist/alerts/unread` - Get unread alerts
- `POST /api/watchlist/alert` - Create alert
- `DELETE /api/watchlist/alert/{id}` - Dismiss alert
- `POST /api/watchlist/alert/{id}/read` - Mark as read
- `POST /api/watchlist/check_triggers` - Check for triggered alerts

## Testing Checklist

- [ ] Add market to watchlist without errors
- [ ] Add market with invalid data shows error
- [ ] Create alert with valid data
- [ ] Create alert without threshold shows validation error
- [ ] Create alert with zero/negative threshold shows validation error
- [ ] Select category filters correctly
- [ ] Remove market from watchlist
- [ ] Dismiss alert
- [ ] Mark alert as read
- [ ] View updates automatically after actions
- [ ] Toast messages display correctly
- [ ] Navigation bar includes watchlist button
- [ ] Switching views works correctly
- [ ] Responsive behavior on different screen sizes

## Future Enhancements

Potential features for future consideration:
- Bulk add from market search results
- Edit existing watchlist items
- Delete specific alerts without dismissing entire watchlist
- Alert history view with filtering
- Price range alerts (between/above AND below thresholds)
- Real-time WebSocket price updates (integrate with backend)
- Integration with trading execution (auto-execute trades)
- Alert rules templates (e.g., "10% above/below current price")
- Priority levels for alerts
- Email/SMS notifications (when backend supports it)