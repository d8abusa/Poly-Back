# PolyBack — User Guide

> A quantitative research, backtesting, and live trading platform for prediction market exchanges.

---

## Table of Contents

1. [Technical Requirements](#1-technical-requirements)
2. [Glossary of Quantitative Terms](#2-glossary-of-quantitative-terms)
3. [Embedded Strategies Reference](#3-embedded-strategies-reference)
4. [Screen Walkthroughs](#4-screen-walkthroughs)
   - [Backtest](#41-backtest-screen)
   - [Signals](#42-signals-screen)
   - [Positions](#43-positions-screen)
   - [History](#44-history-screen)
   - [Strategies](#45-strategies-screen)
   - [Feed](#46-feed-screen)
   - [Settings](#47-settings-panel)
5. [Live Trading & Risk Management](#5-live-trading--risk-management)
6. [Troubleshooting](#6-troubleshooting)
   - [Before You Go Live](#51-before-you-go-live)
   - [Execution Modes](#52-execution-modes)
   - [Risk Guardrails](#53-risk-guardrails)
   - [Stop-Loss Executor](#54-stop-loss-executor)
   - [Kill Switch](#55-kill-switch)
   - [SQLite Persistence](#56-sqlite-persistence)
   - [Exchange Configuration](#57-exchange-configuration)
7. [Kalshi Exchange Integration](#7-kalshi-exchange-integration)
   - [Overview](#71-overview)
   - [Account Setup](#72-account-setup)
   - [Authentication — RSA-PSS Requirement](#73-authentication--rsa-pss-requirement)
   - [Credential Configuration](#74-credential-configuration)
   - [Order Execution](#75-order-execution)
   - [Contract Format](#76-contract-format)
   - [Verifying Connectivity](#77-verifying-connectivity)

---

## 1. Technical Requirements

### System

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| OS | Linux, macOS, Windows 10+ (WSL2) | Linux / macOS |
| RAM | 4 GB | 8 GB |
| Disk | 500 MB free | 2 GB |
| Network | Required (live API calls) | Low-latency connection |

### Backend

| Dependency | Version | Notes |
|------------|---------|-------|
| Python | 3.11+ | 3.12 recommended |
| FastAPI | 0.110+ | Auto-installed via pip |
| Uvicorn | 0.29+ | ASGI server |
| httpx | 0.27+ | Async HTTP client |
| pydantic | 2.x | Data validation |
| cryptography | 43.0+ | RSA-PSS signing for Kalshi order authentication |
| PyJWT | 2.8+ | ES256 JWT signing for Coinbase order authentication |

> **Note on cryptography and PyJWT:** These two libraries are required for live order placement. The `cryptography` package handles RSA-PSS signing (Kalshi) and the EC key operations underlying PyJWT's ES256 signing (Coinbase). Neither is listed in `requirements.txt` because they must be installed separately — `cryptography` via the system/pip and `PyJWT[cryptography]` to pull in the necessary extras. Verify both are present before going live:
>
> ```bash
> pip show cryptography PyJWT
> # cryptography: 43.x, PyJWT: 2.x
> ```

Install backend dependencies:

```bash
cd ~/quant_project/Polymarket
pip install -r backend/requirements.txt
```

Start the backend:

```bash
uvicorn backend.main:app --reload --port 8000
```

API docs available at `http://localhost:8000/docs` once running.

### Frontend

| Dependency | Version | Notes |
|------------|---------|-------|
| Node.js | 18+ | 20 LTS recommended |
| npm / pnpm | 9+ / 8+ | Either works |
| Vite | 5.x | Dev server + bundler |
| React | 18.x | UI framework |
| TypeScript | 5.x | Type checking |

Install and start the frontend:

```bash
cd frontend
npm install
npm run dev
```

App available at `http://localhost:5173`.

### Environment Configuration

The `.env` file lives at the **project root** (`~/quant_project/Polymarket/.env`). It is loaded at backend startup and should be kept `chmod 600` (owner read/write only).

```env
# Coinbase Advanced Trade (primary live trading exchange)
COINBASE_KEY_NAME=organizations/{org_id}/apiKeys/{key_id}
COINBASE_PRIVATE_KEY=-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----\n

# Kalshi (prediction market exchange — full order execution)
KALSHI_API_KEY=your_kalshi_api_key_uuid
KALSHI_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n

# Account value — used by risk manager for position sizing calculations
ACCOUNT_VALUE=1000.00

# Risk guardrail thresholds (see Section 5 for full details)
RISK_MAX_TRADE_PCT=0.05        # 5% of account per trade (soft limit)
RISK_HARD_TRADE_PCT=0.10       # 10% of account per trade (hard halt)
RISK_MAX_TOTAL_PCT=0.40        # 40% total capital at risk (soft limit)
RISK_HARD_TOTAL_PCT=0.60       # 60% total capital at risk (hard halt)
RISK_DRAWDOWN_HALT_PCT=0.20    # 20% session drawdown triggers circuit breaker

# Stop-loss executor
STOP_LOSS_ENABLED=true
STOP_LOSS_POLL_INTERVAL=30     # seconds between position checks

# Data providers
FRED_API_KEY=your_fred_api_key
```

> **Important:** Never commit `.env` to version control. File permissions must be `600`. Keys are never returned to the browser — the UI only sees a `configured: true/false` flag.

---

## 2. Glossary of Quantitative Terms

### Core Concepts

**Prediction Market**
A financial exchange where participants trade contracts that resolve to $1 (YES) or $0 (NO) based on real-world outcomes. The current price of a YES contract equals the crowd's implied probability of the event occurring.

**Probability (p)**
In prediction markets, price and probability are equivalent. A YES contract trading at 0.35 means the market assigns a 35% chance of the event resolving YES. All prices in PolyBack are expressed as probabilities between 0 and 1.

**Binary Contract**
A contract with exactly two outcomes: YES (resolves to $1) or NO (resolves to $0). PolyBack filters for binary markets exclusively, as they have well-defined payoff structures.

**Resolution**
The moment a market closes and pays out. YES holders receive $1 per share; NO holders receive $0 (or vice versa, depending on outcome).

**AMM (Automated Market Maker)**
A liquidity mechanism used by Polymarket and Manifold where a smart contract/algorithm always quotes both buy and sell prices, enabling trading without a counterparty. The price adjusts automatically based on trade volume.

**CLOB (Central Limit Order Book)**
A traditional market structure used by Kalshi where buy and sell limit orders are matched by price-time priority. Provides explicit bid/ask prices and queue depth.

---

### Price & Market Structure

**Bid**
The highest price a buyer is willing to pay for a YES share. If the bid is 0.42, a seller can immediately fill at 0.42.

**Ask**
The lowest price a seller will accept for a YES share. If the ask is 0.45, a buyer can immediately fill at 0.45.

**Spread**
The gap between bid and ask: `spread = ask − bid`. A tighter spread indicates better liquidity. The spread represents the immediate round-trip cost of entering and exiting a position.

**Midpoint**
`mid = (bid + ask) / 2`. Used as the best estimate of fair value when an explicit last-trade price is unavailable.

**Liquidity**
The total capital deployed in a market. Higher liquidity means tighter spreads, less slippage, and better fill rates. PolyBack displays both volume (cumulative traded notional) and liquidity (current deployed capital).

**Slippage**
The difference between the expected fill price and the actual fill price, caused by market impact when a large order moves the price. Relevant for position sizing in thin markets.

**Volume**
Total notional value of trades executed in a market. High-volume markets tend to have better price discovery and tighter spreads.

---

### Strategy & Signal Concepts

**Entry Threshold**
The price level at which a strategy initiates a position. For mean-reversion strategies, this is typically a low probability level (e.g., buy when p < 0.15). For momentum strategies, it is a minimum level confirming trend establishment.

**Exit Threshold**
The price level at which an open position is closed for a profit. Typically set above the entry threshold for long positions (e.g., close when p > 0.60).

**Stop Loss**
A hard price floor below which a position is forcibly closed to cap losses. If a long YES position at p=0.20 has a stop at p=0.05, the position exits immediately if price falls to 0.05, regardless of strategy signals.

**Edge**
The difference between your estimated true probability of an outcome and the market's implied probability. If you believe a market has a 65% chance of resolving YES but it's trading at 0.45, your edge is approximately 20 percentage points. Sustained positive edge over many trades is the source of long-run profits.

**Alpha**
Returns above what a passive strategy would earn. In prediction markets, alpha is generated by superior probability estimation, faster information processing, or structural advantages over less-informed participants.

**Mean Reversion**
The tendency of a price series to return toward its historical average after a deviation. Prediction market probabilities often exhibit mean reversion after news-driven spikes or dips, as fundamentals reassert themselves.

**Momentum**
The tendency of a price series to continue moving in the same direction after an initial impulse. Markets approaching resolution often exhibit momentum as information gradually becomes certain.

---

### Statistical Concepts

**Z-Score**
A standardized measure of how far a value deviates from the mean in units of standard deviation:
`z = (p_current − μ_window) / σ_window`

A z-score of −2 means the current probability is 2 standard deviations below the recent average — a signal of abnormal dislocation.

**Rolling Window**
A fixed-length lookback period that slides forward with each new data point. A 20-period rolling mean uses the 20 most recent prices. Window size controls sensitivity to recent vs. historical data.

**Standard Deviation (σ)**
A measure of dispersion in a price series. Higher σ indicates volatile, rapidly changing probabilities. Used in Z-Score and Mean Reversion strategies to normalize entry thresholds.

**Sharpe Ratio**
Risk-adjusted return measure: `Sharpe = (mean_return − risk_free_rate) / σ_returns`. A Sharpe above 1.0 is considered good; above 2.0 is excellent. Higher is better — it measures how much return you earn per unit of risk taken.

**Maximum Drawdown (Max DD)**
The largest peak-to-trough decline in portfolio value during the backtest period. Expressed as a percentage. A 15% max drawdown means the portfolio fell 15% from its highest point before recovering. Critical for assessing tail risk.

**Win Rate**
Percentage of trades that closed profitably. A 60% win rate with a 1:1 reward/risk ratio is profitable. Win rate alone is insufficient — a 90% win rate with catastrophic losses on the 10% losers can still be unprofitable.

**Total Return**
Net gain or loss on the starting capital over the backtest period, expressed as a percentage. `total_return = (final_equity − initial_capital) / initial_capital × 100`.

---

### Position Sizing

**Position Size**
The fraction of available capital allocated to a single trade. Proper sizing prevents any single loss from catastrophically impacting the portfolio.

**Kelly Criterion**
The mathematically optimal fraction of bankroll to wager to maximize long-run growth rate:
`f* = (bp − q) / b`
where `b = (1 − p_true) / p_true`, `p = p_true`, `q = 1 − p_true`.

**Half-Kelly**
Betting `f*/2` instead of `f*`. Reduces variance by ~75% with only ~25% reduction in long-run growth rate. Strongly recommended in practice due to estimation error in `p_true`.

**Fractional Kelly**
Any multiplier `k < 1` applied to the full Kelly fraction. `k = 0.5` is Half-Kelly; `k = 0.25` is Quarter-Kelly, and so on.

**Bankroll**
The total capital allocated to prediction market trading. Kelly sizing is expressed as a fraction of bankroll, so knowing your total bankroll is required to compute dollar position sizes.

---

### Execution Concepts

**Execution Mode**
How PolyBack handles trade signals. Three modes are available:
- **Confirm**: Each signal requires manual approval before execution.
- **Auto**: Signals execute automatically without intervention.
- **Paper**: Signals are logged and tracked but no real orders are placed (simulation mode).

**Signal**
A generated trade recommendation from a strategy: asset, direction (YES/NO), entry price, size, and rationale. Signals are queued in the Signals view for review or auto-execution.

**Maker / Taker**
In CLOB markets: a *maker* places a limit order that rests in the book (adds liquidity), earning the spread. A *taker* places a market order that executes immediately against resting orders (removes liquidity), paying the spread.

**Adverse Selection**
The risk that the counterparty trading against you has better information. In prediction markets, informed traders tend to trade in the direction of true probability, while uninformed (noise) traders create the spread that market makers capture.

---

## 3. Embedded Strategies Reference

PolyBack ships with seven built-in strategies. All parameters are configurable via the Strategies screen; custom strategies can be created and edited without code.

---

### 3.1 Threshold

| Attribute | Value |
|-----------|-------|
| Category | Mean Reversion |
| Risk | Low |
| Complexity | Simple |

**Concept**

The simplest possible prediction market strategy: buy when probability falls below a fixed entry level, sell when it recovers above a fixed exit level. A hard stop-loss guards against tail events.

**Entry/Exit Logic**

```
Entry:  p < T_entry  AND  no open position
Exit:   p > T_exit   OR   p < T_stop_loss
Size:   max(min_capital, available_liquidity / 10)
```

**Formula**

```
p < T_entry → Buy YES
p > T_exit  → Sell YES (take profit)
p < T_sl    → Sell YES (stop loss)
```

**Parameters**

| Parameter | Default | Description |
|-----------|---------|-------------|
| Entry Threshold | 0.15 | Buy when probability drops below this level |
| Exit Threshold | 0.60 | Sell when probability rises above this level |
| Stop Loss | 0.05 | Hard exit if probability falls below this |

**Edge & Best Use**
Exploits short-lived dislocations in large, liquid markets where probabilities revert after news-driven shocks. Best for markets with a clear fundamental anchor and >30 days to resolution.

**Key Risks**
Fixed thresholds do not adapt to changing market dynamics. A genuine negative update can push price permanently below the entry threshold. Requires manual calibration per market category.

---

### 3.2 Momentum Chaser

| Attribute | Value |
|-----------|-------|
| Category | Trend Following |
| Risk | Medium |
| Complexity | Moderate |

**Concept**

Captures upward probability trends early and exits on the first signs of reversal. Effective in markets where information cascades gradually — political outcomes, economic data releases, or breaking news.

**Entry/Exit Logic**

```
Entry:  (p_t - p_{t-1}) / p_{t-1} > ε  AND  p_t < T_entry
Exit:   (p_{t-1} - p_t) / p_{t-1} > trailing_stop  OR  p_t < stop_loss
Size:   Kelly fraction of estimated edge
```

**Formula**

```
∂p/∂t > ε ∧ p < T_entry → Enter
∂p/∂t < -ε ∨ p < T_exit → Exit
```

**Parameters**

| Parameter | Default | Description |
|-----------|---------|-------------|
| Entry Threshold | 0.40 | Minimum probability to enter a momentum position |
| Trailing Stop % | 0.60 | Exit when price drops by this % from peak |
| Stop Loss | 0.05 | Hard floor stop-loss |

**Edge & Best Use**
Early positioning into trending markets captures flow from late participants. Most effective in the final 2 weeks before market resolution as probability accelerates toward certainty.

**Key Risks**
False breakouts — many trends reverse quickly, generating whipsaw losses. High sensitivity to noise in low-volume markets. Performance degrades in range-bound, mean-reverting regimes.

---

### 3.3 Z-Score Reversion

| Attribute | Value |
|-----------|-------|
| Category | Statistical Arbitrage |
| Risk | Medium |
| Complexity | Advanced |

**Concept**

Maintains a rolling window of recent probabilities and computes a z-score to identify statistically abnormal dislocations. Enters when the probability is significantly depressed relative to recent history and exits when it reverts.

**Entry/Exit Logic**

```
z = (p_t − μ_window) / σ_window
Entry:  z < −z_entry  AND  no open position
Exit:   z ≥ z_exit    OR   z < −z_stop  (runaway — stop out)
Size:   |z_t| × base_position × volatility_adjustment
```

**Formula**

```
z = (p - μ_window) / σ_window
z < -z_entry → Buy
z ≥ z_exit   → Sell
z < -z_stop  → Stop Loss
```

**Parameters**

| Parameter | Default | Description |
|-----------|---------|-------------|
| Window Size | 20 | Number of ticks in rolling window |
| Entry Z-Score | 1.5 | Enter when z-score drops below −this value |
| Exit Z-Score | 0.0 | Exit when z-score reverts to this level |
| Stop Z-Score | 3.0 | Hard stop if z-score falls below −this (deeper dislocation) |

**Edge & Best Use**
More adaptive than fixed-threshold strategies — the entry level auto-adjusts as market volatility changes. Most effective in markets with >30 days to resolution and sufficient historical price data for the rolling window.

**Key Risks**
Z-score assumes stationarity (a stable mean and variance). Markets approaching resolution violate this assumption as probabilities accelerate toward 0 or 1. Short windows are noisy; long windows miss short-term opportunities.

---

### 3.4 Kelly Criterion

| Attribute | Value |
|-----------|-------|
| Category | Position Sizing |
| Risk | High |
| Complexity | Advanced |

**Concept**

Uses the Kelly formula to size each trade proportional to estimated edge. Bets more when the edge is large and less when uncertain. Requires a reliable estimate of your true probability (`p_true`).

**Entry/Exit Logic**

```
Entry:  p_t < T_entry  AND  f* = ((1-p_t)/p_t × win_rate - loss_rate) / ((1-p_t)/p_t) > 0
Exit:   p_t ≥ T_exit   OR   f* ≤ 0  OR  p_t < stop_loss
Size:   kelly_fraction × max(0, f*) × bankroll
```

**Formula**

```
f* = (bp − q) / b
b = (1 − p_true) / p_true
p = p_true, q = 1 − p_true
stake = k × f* × bankroll   (k = kelly_fraction)
```

**Parameters**

| Parameter | Default | Description |
|-----------|---------|-------------|
| Kelly Fraction | 0.5 | Fraction of full Kelly (0.5 = Half-Kelly, recommended) |
| Entry Threshold | 0.20 | Market price must be below this level to enter |
| Exit Threshold | 0.65 | Probability target to close position |
| Stop Loss | 0.05 | Hard floor stop-loss |

**Edge & Best Use**
Mathematically optimal growth rate given accurate `p_true`. Half-Kelly cuts variance by ~75% with only ~25% reduction in growth rate. The only built-in strategy that directly incorporates your probability estimate.

**Key Risks**
Edge estimate error is catastrophic — overestimating `p_true` leads to severe overbetting. Win rate estimates from small samples have high variance. Full Kelly (k=1.0) produces extreme volatility and is not recommended.

---

### 3.5 Mean Reversion

| Attribute | Value |
|-----------|-------|
| Category | Statistical Arbitrage |
| Risk | Medium |
| Complexity | Moderate |

**Concept**

Fades extreme probability moves by taking opposing positions when price deviates more than k standard deviations from the rolling mean. Similar to Z-Score Reversion but uses absolute deviation rather than a normalized z-score.

**Entry/Exit Logic**

```
Entry:  abs(p_t − μ_window) > k × σ_window  AND  no open position
Exit:   p_t reverts within 0.5σ of μ  OR  stop_loss hit
Size:   proportional to deviation magnitude
```

**Formula**

```
μ_m = mean(p_{t-w}..p_t)
σ_m = stdev(p_{t-w}..p_t)
|p_t - μ_m| > k·σ → Fade (long if below, short via NO if above)
```

**Parameters**

| Parameter | Default | Description |
|-----------|---------|-------------|
| Lookback Window | 15 | Rolling window for mean/std calculation |
| Reversion Threshold | 2.0 | Standard deviations from mean to trigger entry |

**Edge & Best Use**
Captures the snap-back from liquidity-driven dislocations in markets with stable, anchored prior beliefs. Most effective in large, liquid markets well before resolution.

**Key Risks**
Large moves may represent genuine information updates, not noise — risk of fading real trends. Mean-reversion assumption breaks near resolution as probabilities converge to 0 or 1.

---

### 3.6 Market Making

| Attribute | Value |
|-----------|-------|
| Category | Liquidity Provision |
| Risk | Low-Medium |
| Complexity | Advanced |

**Concept**

Posts bids below short-term fair value and exits when price rises by the full spread. Uses a rolling 5-period mean as the fair value estimate. Generates consistent small wins from spread collection rather than directional prediction.

**Entry/Exit Logic**

```
Entry:  p_t < μ_5 - spread/2  AND  inventory < max_inventory
Exit:   p_t ≥ p_entry + spread  OR  inventory > max_inventory
Size:   min(capital / spread, available_liquidity / 3)
```

**Formula**

```
bid = μ_5 - spread/2
ask = μ_5 + spread/2
Edge per round-trip = spread − 2 × transaction_costs
```

**Parameters**

| Parameter | Default | Description |
|-----------|---------|-------------|
| Spread Width | 0.04 | Target bid-ask spread to collect (4¢) |
| Stop Loss | 0.08 | Hard loss floor per position |

**Edge & Best Use**
Prediction markets have structural bid-ask spreads from uninformed retail flow. Passive liquidity provision earns the spread repeatedly with a positive expected value and no directional view needed. Best in high-volume, stable markets.

**Key Risks**
Adverse selection — informed traders cross your quotes when they have an information edge. Inventory accumulation during trending markets creates hidden directional exposure.

---

### 3.7 Structure Harvest *(Coming Soon)*

| Attribute | Value |
|-----------|-------|
| Category | Event-Driven |
| Risk | High |
| Complexity | Expert |

**Concept**

Targets systematic wealth transfers from takers to makers documented across tens of millions of prediction market trades. Takers consistently overpay for probability due to affirmative bias; this strategy posts limit orders on the maker side, waiting for emotional taker flow to execute against them.

**Status:** Under active development. Parameters and full logic will be published upon release.

---

### Creating Custom Strategies

The Strategies screen includes a **+ Custom Strategy** button. Any custom strategy can be:
- Named, described, and tagged with a category and risk level
- Assigned any number of parameters with labels, defaults, min/max/step
- Edited later via the **✎ Edit** button in the strategy detail header
- Deleted if no longer needed

Custom strategies participate in all backtest and signal-generation workflows alongside built-in strategies.

---

## 4. Screen Walkthroughs

### Navigation

The top header contains a tab bar with six views. The active view is highlighted in green. The **exchange selector** (Polymarket / Kalshi / Manifold) in the header applies globally — switching exchanges reloads all market data.

---

### 4.1 Backtest Screen

The primary workspace for strategy research. The layout has three columns:

#### Left Column — Market Search

- **Search box**: Filter markets by title text in real time
- **Category filter**: Narrow by Politics, Economics, Crypto, Sports, etc.
- **Sort control**: Order by volume, liquidity, probability, or recency
- **Market cards**: Each card shows title, current probability (color-coded: green = high, red = low), volume, and end date

**Selecting a market**: Click a market card to load it into the detail panel. A highlighted border indicates the selected market.

**Queuing markets for batch backtest**: Click the **+** button on any market card to add it to the backtest queue. The header shows "⚡ N queued". Click again to remove.

**Bulk Add**: The backtest panel includes a **Bulk Add** button to quickly add the top-N markets by volume to the queue.

#### Center/Right — Market Detail

Once a market is selected, the detail panel shows:

- **Title and exchange badge**
- **Probability gauge**: Large probability display with trend indicator
- **Price chart**: Interactive chart of full probability history (fetched from the exchange). Hover for exact price at any point in time.
- **Market metadata**: Volume, liquidity, category, end date, resolution status
- **Tags**: Exchange-provided categorization tags

#### Right Side — Backtest Panel

Controls for configuring and running backtests:

1. **Strategy selector**: Choose from all available strategies (built-in + custom)
2. **Parameter sliders**: Live-adjustable sliders for every parameter of the selected strategy. Changes apply immediately to the next run.
3. **Execution mode toggle**: Set to Confirm, Auto, or Paper
4. **Queue display**: Shows all queued markets with a remove button per market
5. **Run Backtest button**: Executes the selected strategy against all queued markets using their full price history

#### Backtest Results

After a run completes, results appear below the panel:

- **Batch summary**: Markets tested, success count, average return
- **Per-market results**: Table showing each market's total return, win rate, number of trades, Sharpe ratio, and max drawdown
- **Equity curve chart**: Portfolio value over time for each market
- **Trade log**: Every individual entry and exit with price, size, and P&L

Results can be saved to the History panel via the clock icon (⏱) in the header history drawer.

---

### 4.2 Signals Screen

Displays live trade signals generated by active strategies, along with an execution log.

#### Signal Queue (left)

Each signal card shows:
- **Market title** and exchange
- **Direction**: YES (buy) or NO (sell)
- **Entry price** and **suggested size**
- **Strategy** that generated the signal and its rationale
- **Confidence score** (0–100%)
- **Action buttons**: Confirm (execute) or Dismiss

The **execution mode toggle** at the top controls whether signals require manual approval (Confirm) or execute automatically (Auto).

#### Execution Log (right)

A scrolling log of all executions and dismissals with timestamps, prices, and outcomes. Useful for auditing strategy behavior over time.

---

### 4.3 Positions Screen

Tracks all currently open positions across all strategies and markets.

Each position row shows:
- **Market** and exchange
- **Direction** (YES/NO) and **entry price**
- **Current price** (live-updating)
- **Unrealized P&L** (in dollars and %)
- **Strategy** that opened the position
- **Age** (time since entry)

The summary row at the bottom shows total deployed capital, total unrealized P&L, and count of open positions.

Use this screen to monitor risk exposure and identify positions that are approaching stop-loss or profit targets.

---

### 4.4 History Screen

A searchable archive of all completed backtest runs from the current session (or loaded from the history drawer).

Each run entry shows:
- **Run date/time**
- **Strategy** used
- **Markets** tested (titles)
- **Aggregate results**: average return, win rate, Sharpe

Clicking a run expands it to show full per-market results and equity curves — identical to the results view in the Backtest screen.

The **History Drawer** (clock icon in the top-right header) provides a compact list view for quickly switching between runs without leaving the current view.

---

### 4.5 Strategies Screen

The strategy library and configuration center.

#### Strategy Cards

All available strategies are displayed as cards. Each card shows:
- Strategy name and tagline
- Category, risk level, and complexity badge
- Synthetic equity curve preview
- Key performance stats (win rate, avg return, Sharpe, max drawdown, trade count)

Clicking a card opens the **Strategy Detail Panel**.

#### Strategy Detail Panel

Detailed view of a selected strategy, including:

- Full description and edge rationale
- Entry/exit logic pseudocode
- Mathematical formula
- Parameter definitions
- Known risks
- Historical performance metrics

**Editing a strategy**: Click the **✎ Edit** button in the detail header to open the edit modal. All fields — name, description, parameters, category, risk — are editable. Click **Save Changes** to update.

**Creating a custom strategy**: Click **+ Custom Strategy** in the top-right. The same modal opens in creation mode. Fill in the fields, add parameters, and click **Save Strategy**. The new strategy immediately appears in the library and is selectable in the Backtest screen.

**Deleting a custom strategy**: A delete option is available in the edit modal or via the trash icon on custom strategy cards. Built-in strategies cannot be deleted.

---

### 4.6 Feed Screen

A real-time market data feed showing live prices, recent trades, and order book snapshots for the selected exchange.

#### Feed Cards

Each market in the feed shows:
- Current probability with trend direction arrow
- Recent price change (last 1h)
- Bid/ask spread
- Volume ticker

The feed auto-refreshes every 10 seconds. Markets are sorted by activity (most recently traded first).

#### Order Book Panel

Selecting a market opens a live order book view (CLOB exchanges: Kalshi; AMM exchanges: Polymarket, Manifold show a synthetic spread based on pool depth).

---

### 4.7 Settings Panel

Accessible via the **⚙ gear icon** in the top-right header. Click the backdrop or the X to close.

#### Credentials Tab

Manage API keys for each exchange. Each exchange section shows:

- **Auth badge**: Green "Configured" if keys are set, gray "Not Set" if not
- **Capabilities grid**: What the exchange supports (read markets, price history, order book, trading)
- **Credential fields**: One row per required key field

For each credential field:
- Type your key in the password input (click the eye icon to reveal/hide)
- Click **Save** to write the key to the `.env` file on the backend (only available after you type something)
- Click **Clear** to remove the stored key
- A masked preview (first 4 + last 4 characters) is shown for stored keys

**Important**: API keys are stored server-side in `.env` and are never returned to the browser. The UI only receives a `configured: true/false` flag and the masked preview.

#### Exchange Reference

| Exchange | Status | Trading API |
|----------|--------|-------------|
| Coinbase Advanced Trade | **Primary — Live Trading** | JWT/ES256 auth, EC private key required |
| Kalshi | Secondary — Read + Phase 2 Trading | REST v2 — API key required for orders |
| Manifold | Research only — play money | REST v0 — fully public, no auth needed |
| Polymarket | **Disabled** — geoblocked for US users | N/A |

**Coinbase** is the primary live trading venue. Authentication uses JWT tokens signed with an EC private key (ES256). The key name and private key are set via `COINBASE_KEY_NAME` and `COINBASE_PRIVATE_KEY` in `.env`.

**Kalshi** is fully credentialed and available for market data. Order execution via Kalshi is planned for Phase 2.

**Manifold** uses play money (Mana) — ideal for strategy prototyping at zero financial risk.

**Polymarket** registration is blocked by geolocation for US users and is not available as a trading venue.

#### About Tab

Displays the application version, backend status, API endpoint reference, and links to exchange documentation.

---

---

## 5. Live Trading & Risk Management

> **Warning:** Live trading involves real financial risk. Read this section fully before enabling Auto execution mode or placing any real orders.

---

### 5.1 Before You Go Live

Complete this checklist before switching any strategy to Auto execution:

```
[ ] Set ACCOUNT_VALUE in .env to your actual funded account balance
[ ] Confirm COINBASE_KEY_NAME and COINBASE_PRIVATE_KEY are set correctly
[ ] Verify auth_level = "full" at http://localhost:8000/api/positions/risk/status
[ ] Review and accept the default risk limits (Section 5.3)
[ ] Run at least one backtest on the target strategy with realistic fee assumptions
[ ] Start with a small account size — scale up only after live validation
[ ] Keep STOP_LOSS_ENABLED=true (do not disable in production)
[ ] Set stop_loss on every signal before approving in Confirm mode
```

---

### 5.2 Execution Modes

Every signal is dispatched in one of three modes, configurable per strategy or per signal:

| Mode | Behavior | Use When |
|------|----------|----------|
| **Confirm** | Signal is queued; you must manually approve before any order is placed | Starting out, or for large/unusual markets |
| **Auto** | Signal executes immediately after passing risk checks | Proven strategies with validated edge |
| **Alert Only** | Signal is logged to the alerts feed; no order is placed | Research and monitoring only |

> **Recommendation:** Run all new strategies in **Confirm** mode for at least 20 trades before switching to Auto. Review every approval to build intuition about signal quality.

---

### 5.3 Risk Guardrails

PolyBack enforces five independent risk controls at all times. All thresholds are configurable in `.env`; the defaults below are conservative starting points.

#### Per-Trade Size Cap

| Threshold | Default | Behavior |
|-----------|---------|----------|
| Soft limit (`RISK_MAX_TRADE_PCT`) | 5% of account | Order is **blocked with a warning** |
| Hard limit (`RISK_HARD_TRADE_PCT`) | 10% of account | Order is **blocked and system halts** |

Any signal whose `suggested_size` exceeds the soft limit is rejected before reaching the exchange. Exceeding the hard limit triggers an immediate system halt — no further orders can be placed until manually resumed.

**Example:** With `ACCOUNT_VALUE=1000`, a $45 order (4.5%) passes the soft limit. A $60 order (6%) is blocked by the soft limit. A $110 order (11%) triggers a hard halt.

#### Total Capital-at-Risk Cap

| Threshold | Default | Behavior |
|-----------|---------|----------|
| Soft limit (`RISK_MAX_TOTAL_PCT`) | 40% of account | New orders are **blocked** |
| Hard limit (`RISK_HARD_TOTAL_PCT`) | 60% of account | System **halts** |

The total capital deployed across all open positions is checked before every new order. If adding the new order would push the total above the soft limit, the order is rejected. Exceeding the hard limit triggers a halt.

#### Session Drawdown Circuit Breaker

| Threshold | Default | Behavior |
|-----------|---------|----------|
| `RISK_DRAWDOWN_HALT_PCT` | 20% of session starting value | System **halts** |

Every time a position closes with a loss, the session drawdown accumulates. If cumulative realized losses for the session exceed 20% of the starting account value, the circuit breaker trips and all new order activity stops.

A restart resets the session counter — this is intentional. A restart after a circuit breaker trip should involve manual review of what caused the drawdown before resuming.

#### Checking Risk Status

```bash
curl http://localhost:8000/api/positions/risk/status
```

Returns:
```json
{
  "halted": false,
  "account_value": 1000.0,
  "capital_at_risk": 120.0,
  "capital_at_risk_pct": 12.0,
  "session_realized_pnl": -18.50,
  "session_drawdown_pct": 1.85,
  "limits": {
    "max_trade_pct": 5.0,
    "hard_trade_pct": 10.0,
    "max_total_pct": 40.0,
    "hard_total_pct": 60.0,
    "drawdown_halt_pct": 20.0
  }
}
```

#### Resuming After a Halt

After any halt (size, capital, or drawdown), trading is suspended until explicitly resumed:

```bash
curl -X POST http://localhost:8000/api/positions/risk/resume \
  -H "Content-Type: application/json" \
  -d '{"override_reason": "reviewed drawdown — resuming with reduced size"}'
```

An `override_reason` is **required**. This creates an audit trail. Do not resume without understanding what triggered the halt.

---

### 5.4 Stop-Loss Executor

A background task runs from backend startup and monitors all open positions on a configurable interval (default: every 30 seconds).

#### What It Does

On each tick:
1. Skips execution if the system is halted
2. Fetches the current live price for every open position from Coinbase
3. Updates the position's `current_prob` in the tracker and database
4. Checks against the position's `stop_loss` and `exit_target` values
5. If triggered: submits a closing order to the exchange
6. **Only closes the position in the tracker if the exchange confirms the order**
7. If the exchange order fails: position stays open, a CRITICAL alert is fired

#### Stop-Loss Direction Logic

| Position Side | Stop-Loss Triggers When | Exit Target Triggers When |
|--------------|------------------------|--------------------------|
| YES (long) | `current_price <= stop_loss` | `current_price >= exit_target` |
| NO (short) | `current_price >= stop_loss` | `current_price <= exit_target` |

#### Exchange Failure Behavior

If the exchange rejects the stop-loss order (network issue, auth error, rate limit):
- The position remains **open** in the tracker
- A `stop_loss_exchange_failed` alert appears in the Signals screen
- A CRITICAL log entry is written
- **Manual intervention is required** — log into Coinbase directly to close the position

> This conservative behavior (stay open on failure) is intentional. The alternative — optimistically closing the position in the tracker while it remains open on the exchange — creates an invisible divergence between the tracker and reality, which is more dangerous.

#### Configuration

```env
STOP_LOSS_ENABLED=true          # Set to false to disable (not recommended in production)
STOP_LOSS_POLL_INTERVAL=30      # Seconds between checks (lower = more responsive, more API calls)
```

---

### 5.5 Kill Switch

The kill switch is a hard emergency stop: it closes every open position immediately and halts the system.

#### Activate via API

```bash
curl -X POST "http://localhost:8000/api/positions/risk/kill?reason=emergency_stop"
```

#### What Happens

1. System halt is triggered immediately (no new orders accepted)
2. Every open position is submitted for closing via Coinbase
3. Positions where the exchange order succeeds are closed and PnL recorded
4. Positions where the exchange order **fails** remain open with a `flatten_failed` alert — these require manual closure via the Coinbase dashboard
5. A full report of all processed positions is returned

#### After the Kill Switch

Do not resume trading until:
- All `flatten_failed` alerts have been resolved manually
- The reason for activation has been investigated
- Resume is called with a documented `override_reason`

```bash
curl -X POST http://localhost:8000/api/positions/risk/resume \
  -H "Content-Type: application/json" \
  -d '{"override_reason": "kill switch test complete — all positions confirmed closed"}'
```

---

### 5.6 SQLite Persistence

All positions and signals are persisted to `polyback.db` at the project root. State survives backend restarts.

| What Is Persisted | What Is Not Persisted |
|-------------------|-----------------------|
| Open positions (with current price) | Session drawdown counter (resets on restart) |
| Closed positions and realized PnL | System halt state (resets on restart) |
| Pending signals (awaiting approval) | In-memory price cache |
| Executed and rejected signals | |

> **On restart after a crash:** Open positions reload from the database. However, the session drawdown counter resets to zero and any halt state is cleared. Review open positions immediately after an unexpected restart to ensure stop-loss levels are still appropriate.

The database file should be backed up regularly:

```bash
cp ~/quant_project/Polymarket/polyback.db ~/backups/polyback_$(date +%Y%m%d).db
```

---

### 5.7 Exchange Configuration

#### Coinbase JWT Authentication

Coinbase Advanced Trade requires JWT tokens signed with ES256 using your EC private key. The system builds and signs these automatically on every request — you do not need to manage tokens manually.

Required credentials in `.env`:

| Variable | Description |
|----------|-------------|
| `COINBASE_KEY_NAME` | Full key path: `organizations/{org_id}/apiKeys/{key_id}` |
| `COINBASE_PRIVATE_KEY` | PEM-encoded EC private key with literal `\n` newlines |

To verify your credentials are loaded correctly:

```bash
curl http://localhost:8000/api/positions/risk/status
# Look for: "active_exchange": "coinbase"
```

#### Setting ACCOUNT_VALUE

`ACCOUNT_VALUE` must reflect the actual funded balance of your Coinbase account. This value drives all risk percentage calculations. If your balance changes significantly (gains, withdrawals, deposits), update this value and restart the backend.

```env
ACCOUNT_VALUE=5000.00   # Example: $5,000 funded account
```

With this setting, the defaults mean:
- Max per-trade: $250 (5%)
- Hard per-trade halt: $500 (10%)
- Max total at risk: $2,000 (40%)
- Circuit breaker trips at: $1,000 session loss (20%)

---

## Quick-Start Checklist

### Research & Backtesting

```
[ ] Start backend:   uvicorn backend.main:app --reload --port 8000
[ ] Start frontend:  cd frontend && npm run dev
[ ] Open browser:    http://localhost:5173
[ ] Select exchange: Coinbase / Kalshi / Manifold
[ ] Browse markets:  Backtest → search / filter
[ ] Select market:   Click a card to load price history
[ ] Queue markets:   Click + on 1–5 markets
[ ] Pick strategy:   Backtest panel → strategy dropdown
[ ] Adjust params:   Slide sliders to tune entry/exit thresholds
[ ] Run backtest:    Click "Run Backtest"
[ ] Review results:  Check equity curve, total return, Sharpe, drawdown
[ ] Iterate:         Change strategy or params → run again
```

### Going Live

```
[ ] Set ACCOUNT_VALUE in .env to funded account balance
[ ] Verify credentials: curl http://localhost:8000/api/positions/risk/status
[ ] Confirm auth_level = "full" and active_exchange = "coinbase"
[ ] Review risk limits — adjust RISK_* env vars if needed
[ ] Start strategies in Confirm mode (not Auto)
[ ] Set stop_loss on every signal before approving
[ ] Monitor Positions screen and alerts feed
[ ] Check risk status periodically during session
[ ] Emergency stop: POST /api/positions/risk/kill
```

---

## 6. Troubleshooting

### 6.1 Frontend Not Loading (http://localhost:5173)

**Symptom:** Browser shows "connection refused" or page doesn't load.

**Cause:** The Vite dev server is not running. The backend and frontend are separate processes — both must be started independently.

**Fix:**
```bash
cd ~/quant_project/Polymarket/frontend
npm run dev
```

Or to run it in the background:
```bash
cd ~/quant_project/Polymarket/frontend
nohup npm run dev > /tmp/polyback-frontend.log 2>&1 &
```

Confirm it's running:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
# Should return: 200
```

---

### 6.2 Backend Not Responding (http://localhost:8000)

**Symptom:** Frontend loads but shows no data, or API calls fail.

**Fix:** Check if the backend is running:
```bash
curl -s http://localhost:8000/health
# Should return: {"status":"healthy"}
```

If not running, start it:
```bash
cd ~/quant_project/Polymarket
source venv/bin/activate
nohup uvicorn backend.main:app --port 8000 > /tmp/polyback.log 2>&1 &
```

If port 8000 is already in use:
```bash
lsof -ti :8000 | xargs kill -9
# Then restart the backend
```

---

### 6.3 Monitoring Live Activity

**Real-time backend log** (stop-loss checks, orders, risk events, alerts):
```bash
tail -f /tmp/polyback.log
```

**Risk status snapshot:**
```bash
curl -s http://localhost:8000/api/positions/risk/status | python3 -m json.tool
```

**In the UI** (`http://localhost:5173`):
| Tab | What to Watch |
|-----|--------------|
| Signals | Incoming signals queue, execution log, system alerts |
| Positions | Open positions with live P&L |
| History | Closed positions and realized P&L |
| Feed | Live Coinbase market data |

---

### 6.4 System Is Halted (No Orders Executing)

**Symptom:** Orders are being blocked; risk status shows `"halted": true`.

**Check what triggered it:**
```bash
curl -s http://localhost:8000/api/positions/risk/status | python3 -m json.tool
# Check "halt_reason" field
```

**Common causes:**
- Trade size exceeded the hard limit (10% of account)
- Total capital at risk exceeded the hard limit (60% of account)
- Session drawdown hit the circuit breaker (20% of account)
- Kill switch was activated manually

**To resume** (after investigating the cause):
```bash
curl -X POST http://localhost:8000/api/positions/risk/resume \
  -H "Content-Type: application/json" \
  -d '{"override_reason": "describe what you investigated and why resuming is safe"}'
```

> Do not resume without understanding the halt reason. The override_reason is required and creates an audit trail.

---

### 6.5 Stop-Loss Exchange Failure Alert

**Symptom:** Alert of type `stop_loss_exchange_failed` appears in the Signals screen.

**What it means:** The stop-loss executor tried to close a position but the Coinbase order was rejected. The position is still open on the exchange.

**Action required:**
1. Log into your Coinbase account directly
2. Manually close the position for the market shown in the alert
3. Once confirmed closed, manually close it in the tracker:
```bash
curl -X POST "http://localhost:8000/api/positions/{position_id}/close?close_reason=manual_after_exchange_failure"
```

---

### 6.6 .env Changes Not Taking Effect

**Cause:** Environment variables are read at backend startup. Changes to `.env` require a backend restart.

```bash
lsof -ti :8000 | xargs kill -9
source venv/bin/activate
nohup uvicorn backend.main:app --port 8000 > /tmp/polyback.log 2>&1 &
```

Verify the new values loaded:
```bash
curl -s http://localhost:8000/api/positions/risk/status | python3 -m json.tool
```

---

### 6.7 Database / State Questions

| Question | Answer |
|----------|--------|
| Where is the database? | `~/quant_project/Polymarket/polyback.db` |
| Positions lost after restart? | No — positions persist in SQLite |
| Session drawdown reset after restart? | Yes — intentional, requires manual review |
| Halt state reset after restart? | Yes — intentional |
| How to back up the database? | `cp polyback.db ~/backups/polyback_$(date +%Y%m%d).db` |

---

## 7. Kalshi Exchange Integration

### 7.1 Overview

Kalshi is a CFTC-regulated US prediction market exchange operating a Central Limit Order Book (CLOB). Unlike AMM-based platforms, Kalshi uses price-time priority matching — the same execution model as a traditional financial exchange. This means:

- Explicit bid/ask quotes and order book depth are available
- Limit orders rest in the book and may partially fill
- Tighter spreads are achievable by posting limit orders as a maker
- Fill certainty is not guaranteed — orders may expire unfilled

PolyBack treats Kalshi as the primary prediction market venue for live trading. Coinbase is the primary crypto trading venue. Both are fully credentialed and can place live orders.

| Attribute | Value |
|-----------|-------|
| Exchange type | CFTC-regulated US prediction market |
| Market structure | CLOB (Central Limit Order Book) |
| Auth model | RSA-PSS signed request headers |
| Order types | Limit, Market |
| Contract resolution | Binary (YES = $1 / NO = $0) |
| Price unit | Cents (1–99¢ per contract) |
| Min contract | 1 contract |
| API base | `https://api.elections.kalshi.com/trade-api/v2` |

---

### 7.2 Account Setup

1. **Register** at [kalshi.com](https://kalshi.com) — requires identity verification (US residents only)
2. **Fund your account** — minimum practical trading amount is $10; the PolyBack system is configured for a $100 account
3. **Generate an API key** at `kalshi.com → Account → API`:
   - Key name: anything descriptive (e.g., `polyback`)
   - Download or copy the **API Key UUID** and **RSA Private Key** (PEM format)
   - The private key is shown only once — save it immediately
4. **Configure credentials** — see Section 7.4

> Kalshi accounts are US-only and require SSN verification. Once verified, API access is available at no cost. There are no API usage fees; Kalshi earns revenue through trading fees (typically 4–7¢ per contract).

---

### 7.3 Authentication — RSA-PSS Requirement

This is the critical technical requirement for Kalshi order execution. Public endpoints (market listing, price history) work with a Bearer token (the API key UUID). **Authenticated endpoints — including order placement — require RSA-PSS signed request headers.**

#### Why RSA-PSS

Kalshi v2 uses RSA-PSS (Probabilistic Signature Scheme) rather than simple API key auth or JWT. This is a higher-security model where:

- Your private key never leaves your machine
- Each request is individually signed with a timestamp
- The signature cannot be replayed (timestamp binds it to a ~30-second window)
- Kalshi verifies the signature server-side against your registered public key

#### Signing Algorithm

```
Algorithm:   RSA-PSS
Hash:        SHA-256
MGF:         MGF1-SHA256
Salt length: 32 bytes (DIGEST_LENGTH)
```

#### Message to Sign

```
message = str(timestamp_ms) + METHOD_UPPER + path

Example:
  timestamp_ms = 1700000000000
  METHOD       = "POST"
  path         = "/portfolio/orders"
  message      = "1700000000000POST/portfolio/orders"
```

#### Required Headers (per authenticated request)

| Header | Value |
|--------|-------|
| `KALSHI-ACCESS-KEY` | Your API key UUID |
| `KALSHI-ACCESS-TIMESTAMP` | Unix timestamp in **milliseconds** (string) |
| `KALSHI-ACCESS-SIGNATURE` | `base64(RSA-PSS-SHA256(private_key, message))` |

#### Required Python Libraries

The RSA-PSS implementation depends on the `cryptography` package (version 43+):

```bash
pip install cryptography
```

This is a hard requirement. Without it, the backend will fail to import `kalshi_client.py` and Kalshi order placement will be unavailable. Verify it is installed:

```bash
pip show cryptography
# Name: cryptography
# Version: 43.x.x
```

> **Also required for Coinbase:** `PyJWT[cryptography]` is needed for the ES256 JWT signing used by the Coinbase client. Install with: `pip install "PyJWT[cryptography]"`

---

### 7.4 Credential Configuration

Kalshi credentials must be stored in the project `.env` file (`~/quant_project/Polymarket/.env`). Both values are required for order placement. The API key alone is sufficient for read-only public endpoints.

#### Step 1 — Add to .env

```env
KALSHI_API_KEY=b020fc83-42ae-43b8-bea7-39373ce26bf1
KALSHI_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQ...\n-----END RSA PRIVATE KEY-----\n
```

**Important formatting rule:** The PEM key must be stored as a single line with literal `\n` characters (backslash-n, not real newlines). The backend substitutes `\n` → actual newlines before loading the key. This is the same format used for the Coinbase EC private key.

To convert a multiline PEM file to single-line format:

```bash
awk 'NF {printf "%s\\n", $0} END {print ""}' ~/your_kalshi_key.pem
# Paste the output into .env as the value of KALSHI_PRIVATE_KEY
```

#### Step 2 — Set file permissions

```bash
chmod 600 ~/quant_project/Polymarket/.env
```

#### Step 3 — Restart the backend

```bash
lsof -ti :8000 | xargs kill -9
nohup venv/bin/uvicorn backend.main:app --port 8000 > /tmp/polyback.log 2>&1 &
```

#### Step 4 — Verify via Settings Panel

Open `http://localhost:5173` → Settings (⚙ gear icon) → Kalshi section. Both fields should show **Configured** and the auth level badge should display **Full Access**.

Alternatively, verify via API:

```bash
curl -s http://localhost:8000/api/settings | python3 -m json.tool | grep -A5 '"kalshi"'
# Look for: "auth_level": "full", "place_orders": true
```

---

### 7.5 Order Execution

Kalshi orders are placed via `POST /trade-api/v2/portfolio/orders` with RSA-PSS authentication. PolyBack handles all signing automatically — you only need to ensure credentials are configured.

#### Order Parameters

| Field | Type | Description |
|-------|------|-------------|
| `ticker` | string | Market ticker (e.g., `KXINFL-24DEC31-B2.9`) |
| `action` | `"buy"` or `"sell"` | Direction |
| `side` | `"yes"` or `"no"` | Contract side |
| `type` | `"limit"` or `"market"` | Order type |
| `count` | integer | Number of contracts |
| `yes_price` | integer (cents) | Limit price in cents (1–99); omit for market orders |

#### How Execution Modes Apply

| Mode | Behavior |
|------|----------|
| **Confirm** | Signal appears in the queue; you approve before the order is sent to Kalshi |
| **Auto** | Signal is approved and submitted to Kalshi immediately (use with caution) |
| **Paper** | Signal is logged and P&L tracked; no order is sent to Kalshi |

Start in **Confirm** mode until you have verified end-to-end connectivity with a small test order.

#### Fee Structure

Kalshi charges fees per contract filled. At the time of writing, fees are approximately:

| Contract price range | Fee per contract |
|---------------------|-----------------|
| 5¢ – 49¢ | ~7¢ |
| 50¢ | ~5¢ |
| 51¢ – 95¢ | ~7¢ |

Factor fees into strategy entry/exit thresholds. A trade with 10¢ of expected edge and 7¢ in fees has only 3¢ net expected value per contract — not enough margin to survive slippage and adverse selection.

#### Failed Orders

If Kalshi rejects an order (insufficient balance, invalid ticker, rate limit), the system:
- Returns `{"status": "error", "note": "<exchange error text>"}` to the signal queue
- Does **not** open a position in the tracker
- Logs the rejection at ERROR level in `/tmp/polyback.log`

Check the error note in the Signals view for the rejection reason. Common causes: account balance too low, market closed/suspended, or a malformed ticker.

---

### 7.6 Contract Format

#### Ticker Structure

Kalshi tickers follow the format: `SERIES-IDENTIFIER`

```
KXINFL-24DEC31-B2.9
│       │        │
│       │        └── Contract variant (outcome threshold)
│       └──────────── Expiration or event date
└──────────────────── Series code (topic)
```

The series code is used to fetch candlestick history: `GET /series/{series}/markets/{ticker}/candlesticks`.

#### Probability and Pricing

Kalshi uses **cents** (1–99) for order prices, not 0–1 probabilities. PolyBack internally stores all prices as probabilities (0.0–1.0) and converts on the fly:

```
probability = cents / 100.0
cents = round(probability * 100)
```

A market showing 0.62 probability in PolyBack maps to a `yes_price` of 62 in the order body.

#### YES vs NO Contracts

Every Kalshi market has two tradeable sides: YES and NO. They always sum to ~100¢ (minus spread). When PolyBack generates a signal:

- **Long (buy YES):** `action="buy"`, `side="yes"`, `yes_price=<entry_prob * 100>`
- **Long (buy NO):** `action="buy"`, `side="no"`, `yes_price=<100 - entry_prob * 100>` — buying NO at a low price when YES is high
- **Closing a YES position:** `action="sell"`, `side="yes"`
- **Closing a NO position:** `action="sell"`, `side="no"`

---

### 7.7 Verifying Connectivity

#### 1. Check authentication is loaded

```bash
curl -s http://localhost:8000/api/settings | python3 -c "
import sys, json
s = json.load(sys.stdin)['kalshi']
print('Auth level:   ', s['auth_level'])
print('Place orders: ', s['capabilities']['place_orders'])
print('API key:      ', s['fields']['KALSHI_API_KEY']['configured'])
print('Private key:  ', s['fields']['KALSHI_PRIVATE_KEY']['configured'])
"
```

Expected output:
```
Auth level:    full
Place orders:  True
API key:       True
Private key:   True
```

#### 2. Verify market data is live

Open the app at `http://localhost:5173`, select the **Kalshi** tab, and confirm markets load. If you see an error:

```bash
curl -s "http://localhost:8000/api/markets?exchange=kalshi&limit=5" | python3 -m json.tool | head -20
```

A successful response returns `"count": 5` and a list of market objects.

#### 3. Test the RSA-PSS signing locally

```bash
cd ~/quant_project/Polymarket
venv/bin/python3 -c "
import os
from dotenv import load_dotenv
load_dotenv('.env')
from backend.services.kalshi_client import _build_kalshi_signature
pk = os.getenv('KALSHI_PRIVATE_KEY', '')
sig = _build_kalshi_signature('POST', '/portfolio/orders', 1700000000000, pk)
print('Signature OK, length:', len(sig))
"
# Expected: Signature OK, length: 344
```

If this throws a `ValueError` or `cryptography` import error, the private key format is incorrect or the `cryptography` package is not installed. See Section 7.3 for the correct PEM format.

#### 4. Place a test order (Confirm mode)

1. Set execution mode to **Confirm** in the Backtest screen
2. Select a Kalshi market and run a backtest to generate signals
3. Navigate to **Signals** and approve one signal with a small size (1 contract)
4. Check the execution log — a successful submission shows `status: submitted` with a Kalshi `order_id`
5. Verify the order in your Kalshi dashboard at `kalshi.com/account/portfolio`

---

*PolyBack is a research, analysis, and live trading tool. Nothing in this guide constitutes financial advice. Prediction market trading involves real risk of financial loss. Always start with small position sizes and validate strategy performance before scaling.*
