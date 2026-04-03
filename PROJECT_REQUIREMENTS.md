# Polymarket Trading Platform — Project Requirements

**Version:** 2.0 Expanded
**Date:** 2026-03-21
**Status:** Scope Expanded
**Collaboration Mode:** Autonomous (12-hour team collaboration)

---

## Executive Summary

A decentralized quantitative trading platform for research, signal generation, and live trading across multiple asset classes:

1. **Polymarket Prediction Markets** — Primary focus: binary outcome trading
2. **Crypto Markets** — Via Coinbase API: ETH, BTC, altcoins
3. **Traditional Finance** — Via Robinhood API: stocks, options, ETFs
4. **Event Trading** — Via Kalshi API: futures contracts on events

Plus real-time news aggregation and a sliding banner ticker for market-moving events.

---

## Core Requirements

### 1. Strategy Engine (AXIOM)
- **Backtesting:** Full-historical analysis across all supported exchanges
- **Signal Generation:** 15 anomaly detection patterns (LENS patterns)
- **Position Sizing:** Kelly Criterion-based auto-calibration
- **Performance Metrics:** Sharpe ratio, max drawdown, win rate, profit factor
- **Real-time Monitoring:** WebSocket signal feed with confidence scoring

**Key Features:**
- Entry/exit thresholds (sigma-based or percentage)
- Timeframe selection (1h, 3h, 6h, 24h)
- Loss limiting (stop-loss, trailing stops)
- Multi-strategy aggregation

---

### 2. Visualization Dashboard (AXIOM)
**Four-Pillar Design:**

#### Page 1: Strategy Backtest Dashboard
- Equity curves with max drawdown overlay
- 6 KPI metrics (total return, Sharpe, max drawdown, win rate, profit factor, trade count)
- Sharpe ratio trend (rolling 30d)
- Hourly performance heat map
- Expandable trade list

#### Page 2: Signal Monitoring Feed
- Real-time signal cards (auto-refresh 1-5s)
- Confidence indicator (5-level: very low → very high)
- Market context (price movement, volume, open interest)
- Signal value vs expected value comparison
- Action buttons: entry, reject, manual override

#### Page 3: Performance Dashboard (Comparative)
- Multi-line rolling returns chart (5 strategies)
- Quick stats: best Sharpe/return per category
- Strategy comparison heat map (4×12 matrix)
- Sortable comparison table

#### Page 4: Interactive Parameter Explorer
- Real-time parameter preview (no commit required)
- Slider controls: position sizing (k=0.1-1.0), entry/exit thresholds, timeframe
- Parameter influence charts (4 mini-charts for each param)
- "Commit" threshold warnings

**Refresh Rates:**
- Strategy metrics: Manual (but cached < 1s)
- Signal feed: Auto-refresh 1s
- Performance dashboard: Manual + optional 1h
- Parameter preview: Instant (< 50ms)

---

### 3. External API Integrations

#### Coinbase API (Crypto)
**Endpoints:**
- `GET /OHLCV` — Historical price data (300+ candles)
- `GET /ticker` — Real-time price/volume
- `GET /balance` — Account balance
- `ws://` — WebSocket price streams

**Supported Assets:**
- ETH, BTC
- Major altcoins (select based on trading volume)
- Spot and futures markets

**Data Pipeline:**
1. Poll every 60s for OHLCV history
2. WebSocket for real-time price ticks
3. Store in SQLite: `coinbase_prices` table
4. Feed into LENS anomaly detection engine

---

#### Robinhood API (Traditional Finance)
**Endpoints:**
- `GET /positions` — Current holdings
- `GET /price-historicals` — Historical price data
- `GET /market_data/{symbol}/price_book` — Real-time quotes
- `GET /options` — Options chain data

**Supported Assets:**
- Blue-chip stocks (AAPL, MSFT, GOOGL, etc.)
- ETFs (SPY, QQQ, IWM)
- Options: Call/Put contracts on major stocks
- Cash account with margin available

**Data Pipeline:**
1. Poll every 30s for price changes
2. Intraday 1-min candles
3. Store in SQLite: `robinhood_prices` table
4. Feed into LENS patterns (volume, volatility)

---

#### Kalshi API (Event Futures)
**Endpoints:**
- `GET /c1/contracts/{contract_id}` — Contract details
- `GET /c1/markets` — Available markets
- `GET /c1/book` — Current book/ob
- `ws://` — Real-time updates

**Supported Assets:**
- Election outcome contracts (YES/NO)
- Macro events (rate decisions, GDP)
- Weather events
- Sports outcomes

**Data Pipeline:**
1. Poll every 15s for price/book changes
2. WebSocket for live updates
3. Store in SQLite: `kalshi_contracts` table
4. Unique signal source (prediction market arbitrage)

---

### 4. Real-Time News Ticker

**Sliding Banner Components:**

#### Top Banner: Market Headlines
- **Format:** Auto-scrolling headlines at top of page
- **Refresh Interval:** Every 30s
- **Data Source:** AlphaVantage API, Yahoo Finance RSS, or aggregated news APIs
- **Content:** Market-moving events, earnings reports, economic data

#### Sub-Banner: Signal Alerts
- **Format:** Pulsing alerts for high-confidence signals
- **Refresh Interval:** Real-time
- **Content:** New signals (very high confidence >85%)
- **Visual:** Yellow flash, "NEW SIGNAL" badge, auto-expands on click

---

### 5. LENS Anomaly Detection (15 Patterns)

**Hard Patterns (Technical):**
1. **Volume Spike + Price Move** — Sudden volume surge (5x avg) + reversal signal
2. **Moving Average Crossover** — MACD or EMAs crossing after consolidation
3. **Support/Resistance Breakout** — Price breaking key levels with volume
4. **RSI Divergence** — RSI indicator diverging from price
5. **Volatility Spike** — Keltner channel expansion (>2σ)

**Soft Patterns (Flow-based):**
6. **Institutional Buy Signals** — Order flow volume increase (3x historical)
7. **Retail FOMO/DUMP** — Social sentiment spike vs price action
8. **Momentum Reversal** — Extended trend after 5 consecutive runs
9. **Mean Reversion** — Price hitting 3σ from mean after high volatility
10. **Correlation Break** — Beta dropping below 0.5 after >0.9

**Prediction Market Specific:**
11. **Book Imbalance** — OB >60% on one side
12. **Liquidity Collapse** — OB depth dropping to <10% of average
13. **Funding Rate Anomaly** — Funding rate > ±0.5% (5x normal range)
14. **Liquidation Cascade** — Large liquidations triggering price cascades
15. **Sentiment vs Price Disconnection** — Media bullish vs price bearish

**Implementation:**
- Pre-calculated indicators (don't re-run on every signal)
- Store signal confidence (0-1) + market context (price, volume, sentiment)
- Filter out low-confidence signals (<30%)
- Human-in-the-loop: Reject button for false positives

---

### 6. HARBOR Safety Guarantees

**Safety Layers:**

#### Entry Safety
- **Stop-Loss:** Auto-trigger on -15% drawdown per trade
- **Trailing Stop:** Protect profit on 3-consecutive wins (move up 5%)
- **Max Exposure:** 20% of portfolio per asset class
- **Daily Loss Limit:** Stop trading if > -3% daily PnL

#### Execution Safety
- **Time-Lock:** Signals auto-expire after 5 minutes
- **Size Limits:** No single trade > 20% of portfolio
- **Market Availability:** Retry until filled or timeout

#### Portfolio Safety
- **Diversification Check:** No >40% weight in single asset
- **Correlation Filter:** Don't open opposing-direction trades (LONG+SHORT same asset)
- **Liquidity Buffer:** Minimum 3x trade size in reserve

**Implementation:**
- HARBOR agent monitors live positions and safety metrics
- Auto-liquidation on safety breach (with user warning)
- Real-time safety dashboard: exposure, drawdown, stop levels

---

### 7. Risk & Compliance

**Hard Safety Guarantees:**
- ✅ Loss limiting (stop-loss, trailing stops, daily loss caps)
- ✅ Exposure caps per asset class (max 20% per category)
- ✅ Diversification requirements (no >40% single asset)
- ✅ Correlation filtering (no conflicting signals)
- ✅ Liquidity buffer reserves (3x trade size)
- ✅ API rate limiting ( Coinbase: 60s, Robinhood: 30s, Kalshi: 15s)
- ✅ Auto-rejection of signals with negative EV + <30% confidence
- ✅ Daily PnL loss limits (-3% max)
- ✅ Trade size limits (max 20% portfolio per trade)
- ✅ Time-expiry for signals (5 minutes)

**Soft Protections:**
- 🟡 Manual override for human judgement
- 🟡 Backtesting validation before live use
- 🟡 Parameter sensitivity analysis

---

### 8. Data Model

#### Exchange Price Tables
```sql
CREATE TABLE coinbase_prices (
    symbol TEXT PRIMARY KEY,
    timestamp DATETIME,
    price REAL,
    volume_24h REAL,
    open REAL,
    high REAL,
    low REAL,
    close REAL
);

CREATE TABLE robinhood_prices (
    symbol TEXT PRIMARY KEY,
    timestamp DATETIME,
    price REAL,
    volume_24h REAL,
    open REAL,
    high REAL,
    low REAL,
    close REAL
);

CREATE TABLE kalshi_contracts (
    contract_id TEXT PRIMARY KEY,
    market_name TEXT,
    expiry DATETIME,
    price REAL,
    bid REAL,
    ask REAL,
    volume REAL,
    participants INT
);
```

#### Signal Table
```sql
CREATE TABLE signals (
    id UUID PRIMARY KEY,
    exchange TEXT,  -- 'coinbase', 'robinhood', 'kalshi', 'polymarket'
    symbol TEXT,
    strategy_id TEXT,
    direction TEXT,  -- LONG/SHORT/NEUTRAL
    confidence REAL,  -- 0-1
    entry_price REAL,
    exit_price REAL,
    expected_value REAL,  -- EV = prob * payout - cost
    signal_value REAL,  -- EV - entry_price
    timestamp DATETIME,
    status TEXT,  -- NEW, ACTIVE, CLOSED, REJECTED
    safety_check_passed BOOLEAN
);
```

#### Position Table
```sql
CREATE TABLE positions (
    id UUID PRIMARY KEY,
    signal_id UUID,
    strategy_id TEXT,
    entry_time DATETIME,
    exit_time DATETIME,
    entry_price REAL,
    exit_price REAL,
    size REAL,
    direction TEXT,
    pnl REAL,
    stop_loss REAL,
    status TEXT  -- OPEN, CLOSED, LIQUIDATED
);
```

---

### 9. Authentication & Security

#### API Keys Storage
- **Coinbase:** Public tokens (OHLCV) + Client Secret for private endpoints
- **Robinhood:** Client ID + OAuth token (rate-limited, no auth for public quote)
- **Kalshi:** API key (optional, use public endpoints)

#### Security Measures
- **HTTPS Only:** All API communications encrypted
- **Rate Limiting:** Exponential backoff on rate limit errors
- **Data Sanitization:** Input validation on all API params
- **Fail-Safe Mode:** Disable trading if API connection lost

---

### 10. Deployment Infrastructure

#### Dev Environment
- **Backend:** Python 3.11, FastAPI, SQLAlchemy
- **Frontend:** React 18, Vite, TypeScript, Recharts
- **Databases:** SQLite (polyback.db)
- **Process Management:** Systemd/Supervisor for background workers

#### Production
- **Containerization:** Docker + Docker Compose
- **Orchestration:** Kubernetes (optional for scaling)
- **Reverse Proxy:** Nginx (SSL termination)
- **Monitoring:** Prometheus + Grafana (track metrics)
- **Logging:** Logstash/Grafana Loki

---

## Tech Stack Summary

**Backend:**
- Python 3.11
- FastAPI (already exists)
- SQLAlchemy (ORM for SQLite)
- WebSocket (Auto-generated signals)
- Background Workers (API polling)

**Frontend:**
- React 18 + TypeScript
- Vite (dev server)
- Recharts (chart library)
- React Query (data fetching)
- CSS Modules (styling)

**Database:**
- SQLite (polyback.db)
  - Prices: coinbase_prices, robinhood_prices, kalshi_contracts
  - Signals: signals, positions
  - Backtests: backtest_runs, trade_history

**Third-Party APIs:**
- Coinbase Advanced Trade API
- Robinhood API
- Kalshi API v1
- AlphaVantage / Yahoo Finance (news)
- CoinGecko (alternative data for validation)

---

## Success Metrics

### User Engagement
- Daily active users (DAU): Target 50+ (researchers)
- Session duration: Average 20+ minutes
- Navigation depth: Average 4 pages per session
- Strategy usage: > 5 unique strategies per user

### Performance
- Chart load time: < 2 seconds (4G connection)
- Signal feed latency: < 500ms (real-time)
- API retry rate: < 1% (rate limit success)
- Data consistency: < 1% discrepancy vs exchange

### Trading Performance
- Signal accuracy: > 45% win rate (hard patterns)
- Overall strategy Sharpe: > 1.5 (12-month)
- Max drawdown: < 15% (historical backtest)
- Profit factor: > 2.0 (12-month)

### Platform Stability
- Uptime: > 99.5% (monthly)
- API error rate: < 0.5%
- Auto-rejection rate: > 85% (signals with negative EV)
- Safety breach detection: 100% (stop-loss triggers)

---

## 12-Hour Collaboration Scope

**Phase 1 (Hours 0-4): Architecture Design**
- API integration architecture diagrams
- Data pipeline flow diagrams
- WebSocket signal flow diagrams

**Phase 2 (Hours 4-8): Implementation Planning**
- Detailed API endpoint mappings
- Data storage schema extensions
- Frontend component mapping
- Security implementation plan

**Phase 3 (Hours 8-12): Creative Delivery**
- Design mockups for new exchanges
- News ticker visual mockups
- Cross-exchange dashboard layouts
- Safety system detailed specs
- User acceptance criteria

---

**Status:** Ready for autonomous implementation
**Next Step:** Spawn task-specific agents for API integration and news system