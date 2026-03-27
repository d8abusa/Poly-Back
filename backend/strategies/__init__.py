import math, random

def _curve(seed, n=32, trend=0.003, noise=0.04):
    """Generate a synthetic equity curve starting at 1.0."""
    random.seed(seed)
    v, out = 1.0, []
    for _ in range(n):
        v = max(0.1, v * (1 + trend + random.gauss(0, noise)))
        out.append(round(v, 4))
    return out

ALL_STRATEGIES = [
    {
        "id":         "threshold",
        "name":       "Threshold",
        "tagline":    "Buy low, sell high on fixed probability bands",
        "category":   "Mean Reversion",
        "risk":       "Low",
        "complexity": "Simple",
        "color":      "#00d4a8",
        "status":     "live",
        "params": [
            {"name": "entry_threshold", "label": "Entry Threshold", "default": 0.15, "min": 0.05, "max": 0.40, "step": 0.01, "desc": "Buy when probability drops below this level"},
            {"name": "exit_threshold",  "label": "Exit Threshold",  "default": 0.60, "min": 0.30, "max": 0.90, "step": 0.01, "desc": "Sell when probability rises above this level"},
            {"name": "stop_loss",       "label": "Stop Loss",       "default": 0.05, "min": 0.01, "max": 0.20, "step": 0.01, "desc": "Hard exit if probability falls below this"},
        ],
        "formula": "p < T_entry → Buy;  p > T_exit → Sell;  p < T_sl → Stop Loss",
        "description": (
            "The simplest strategy: enters when probability drops below a fixed entry threshold and "
            "exits when it reverts above the exit threshold. A hard stop-loss protects against tail risk.\n\n"
            "Best suited for markets with frequent noise-driven dislocations and a clear fair-value anchor. "
            "Works well in large, liquid Polymarket markets where probabilities revert to priors after shocks."
        ),
        "logic": {
            "entry": "p_t < T_entry AND no_position",
            "exit":  "p_t > T_exit OR p_t < T_sl",
            "size":  "max(min_capital, available_liquidity / 10)",
        },
        "edge": (
            "When a market is temporarily depressed below its fundamental probability, "
            "mean reversion creates a statistical edge. Exploits the spread between "
            "perceived and true resolution probability — a common inefficiency in thin prediction markets."
        ),
        "risks": [
            "Fixed thresholds don't adapt to changing market dynamics — a market may legitimately drop below entry",
            "Binary resolution: if the outcome moves against you before exit, full loss of capital deployed",
            "Thin markets can gap past your exit target with no fill",
            "No position while awaiting entry means capital idle during trends",
            "Requires manual threshold calibration per market category",
        ],
        "performance": {"win_rate": 68, "avg_return": 12.4, "sharpe": 1.8, "max_dd": 8, "trades": 142},
        "synthetic_curve": _curve(42, trend=0.004, noise=0.035),
    },
    {
        "id":         "momentum",
        "name":       "Momentum Chaser",
        "tagline":    "Ride rising probabilities, exit on reversal",
        "category":   "Trend Following",
        "risk":       "Medium",
        "complexity": "Moderate",
        "color":      "#f59e0b",
        "status":     "live",
        "params": [
            {"name": "entry_threshold", "label": "Entry Threshold", "default": 0.40, "min": 0.10, "max": 0.70, "step": 0.01, "desc": "Minimum probability to enter a momentum position"},
            {"name": "exit_threshold",  "label": "Trailing Stop %", "default": 0.60, "min": 0.30, "max": 0.90, "step": 0.01, "desc": "Exit when price drops by this % from peak"},
            {"name": "stop_loss",       "label": "Stop Loss",       "default": 0.05, "min": 0.01, "max": 0.20, "step": 0.01, "desc": "Hard floor stop-loss"},
        ],
        "formula": "∂p/∂t > ε ∧ p < T_i → Enter;  ∂p/∂t < -ε ∨ p < T_o → Exit",
        "description": (
            "Catches upward probability trends and exits on momentum decay or reversal. "
            "Ideal for markets where new information cascades quickly — e.g., political events, "
            "breaking news, or economic data releases.\n\n"
            "Enters when probability is trending up and below the entry threshold. "
            "Exits on the first signs of reversal or if a trailing stop triggers."
        ),
        "logic": {
            "entry": "(p_t - p_{t-1}) / p_{t-1} > ε AND p_t < T_entry",
            "exit":  "(p_{t-1} - p_t) / p_{t-1} > trailing_stop OR p_t < stop_loss",
            "size":  "kelly(p_t, edge_estimate)",
        },
        "edge": (
            "Information cascades in prediction markets create detectable momentum before resolution. "
            "Early positioning into trending markets captures flow from late participants. "
            "The edge comes from being faster to act on observable probability trends."
        ),
        "risks": [
            "False breakouts — many trends reverse quickly, generating whipsaw losses",
            "High sensitivity to noise in low-volume markets causes spurious entries",
            "Requires relatively fast execution to capture trends early",
            "Trailing stop can be triggered by temporary pullbacks on the way to a true trend",
            "Performance degrades in range-bound, mean-reverting market regimes",
        ],
        "performance": {"win_rate": 58, "avg_return": 8.7, "sharpe": 1.2, "max_dd": 14, "trades": 89},
        "synthetic_curve": _curve(7, trend=0.005, noise=0.055),
    },
    {
        "id":         "zscore_reversion",
        "name":       "Z-Score Reversion",
        "tagline":    "Trade statistical dislocations back to the mean",
        "category":   "Statistical Arbitrage",
        "risk":       "Medium",
        "complexity": "Advanced",
        "color":      "#7b61ff",
        "status":     "live",
        "params": [
            {"name": "zscore_window", "label": "Window Size",   "default": 20,   "min": 5,   "max": 100, "step": 1,    "desc": "Number of ticks in rolling window"},
            {"name": "zscore_entry",  "label": "Entry Z-Score", "default": 1.5,  "min": 0.5, "max": 4.0, "step": 0.1,  "desc": "Enter when z-score drops below -this value"},
            {"name": "zscore_exit",   "label": "Exit Z-Score",  "default": 0.0,  "min":-2.0, "max": 2.0, "step": 0.1,  "desc": "Exit when z-score reverts to this level"},
            {"name": "zscore_stop",   "label": "Stop Z-Score",  "default": 3.0,  "min": 1.0, "max": 6.0, "step": 0.1,  "desc": "Hard stop if z-score falls below -this value (deeper dislocation)"},
        ],
        "formula": "z = (p - μ_window) / σ_window;  z < -z_entry → Buy;  z ≥ z_exit → Sell;  z < -z_stop → Stop",
        "description": (
            "Maintains a rolling window of recent probabilities and computes a z-score. "
            "Enters long when the probability is statistically depressed relative to recent history, "
            "exits when it reverts to the rolling mean. "
            "Captures noise-driven dislocations in thin prediction markets.\n\n"
            "More adaptive than fixed-threshold strategies — the entry level adjusts automatically "
            "as market volatility changes."
        ),
        "logic": {
            "entry": "z_t < -z_entry AND no_position",
            "exit":  "z_t >= z_exit OR z_t < -z_stop",
            "size":  "|z_t| × base_position_size × volatility_adjustment",
        },
        "edge": (
            "Statistical noise in thin prediction markets creates short-lived probability dislocations. "
            "Z-score entry filters distinguish genuine dislocations from genuine trend changes. "
            "The adaptive window means the strategy stays calibrated as market volatility evolves."
        ),
        "risks": [
            "Window too short makes the strategy reactive to noise with frequent false entries",
            "Window too long misses genuine short-term mean reversion opportunities",
            "Z-score assumes stationarity — events approaching resolution break this assumption",
            "Without stop loss, runaway dislocations (genuine new information) can cause large losses",
            "Calibrating entry/exit thresholds requires understanding each market's noise profile",
        ],
        "performance": {"win_rate": 62, "avg_return": 9.8, "sharpe": 1.5, "max_dd": 11, "trades": 203},
        "synthetic_curve": _curve(17, trend=0.003, noise=0.030),
    },
    {
        "id":         "kelly",
        "name":       "Kelly Criterion",
        "tagline":    "Optimal fractional sizing based on estimated edge",
        "category":   "Position Sizing",
        "risk":       "High",
        "complexity": "Advanced",
        "color":      "#22c55e",
        "status":     "live",
        "params": [
            {"name": "kelly_fraction",  "label": "Kelly Fraction",  "default": 0.5,  "min": 0.1, "max": 1.0, "step": 0.05, "desc": "Fraction of full Kelly to bet (0.5 = Half-Kelly, recommended)"},
            {"name": "entry_threshold", "label": "Entry Threshold", "default": 0.20, "min": 0.05, "max": 0.60, "step": 0.01, "desc": "Probability level where edge is considered present"},
            {"name": "exit_threshold",  "label": "Exit Threshold",  "default": 0.65, "min": 0.30, "max": 0.95, "step": 0.01, "desc": "Probability level to take profit"},
            {"name": "stop_loss",       "label": "Stop Loss",       "default": 0.05, "min": 0.01, "max": 0.20, "step": 0.01, "desc": "Hard floor stop-loss"},
        ],
        "formula": "f* = (bp - q) / b;  stake = k × f* × bankroll;  b = (1-p)/p",
        "description": (
            "Uses the Kelly formula to size each position proportional to estimated edge. "
            "Dynamically adjusts stake based on recent win rate — betting more when the edge is large, "
            "less when uncertain. Half-Kelly (k=0.5) is the default for variance reduction.\n\n"
            "Entry occurs when price is below threshold and Kelly fraction is positive. "
            "Exits on price target, Kelly fraction going negative, or stop-loss."
        ),
        "logic": {
            "entry": "p_t < T_entry AND f* = ((1-p_t)/p_t × win_rate - loss_rate) / ((1-p_t)/p_t) > 0",
            "exit":  "p_t >= T_exit OR f* <= 0 OR p_t < stop_loss",
            "size":  "kelly_fraction × max(0, f*) × bankroll",
        },
        "edge": (
            "Mathematically optimal stake sizing maximizes long-run portfolio growth rate (Kelly growth). "
            "Adapts position size to estimated edge — larger bets when win probability is high, "
            "minimal bets when edge is uncertain. The only strategy that accounts for sizing directly in its signal."
        ),
        "risks": [
            "Overconfident edge estimates lead to overbetting and severe drawdowns",
            "Win rate estimate from recent trades has high variance with small sample sizes",
            "Full Kelly (k=1.0) leads to extreme drawdowns — half-Kelly strongly recommended",
            "Edge can evaporate immediately after market information arrival",
            "Strategy is capital-hungry — Kelly fraction × bankroll requires large capital base for meaningful positions",
        ],
        "performance": {"win_rate": 61, "avg_return": 14.2, "sharpe": 1.4, "max_dd": 19, "trades": 76},
        "synthetic_curve": _curve(99, trend=0.006, noise=0.065),
    },
    {
        "id":         "mean_reversion",
        "name":       "Mean Reversion",
        "tagline":    "Fade mean deviations in stationary series",
        "category":   "Statistical Arbitrage",
        "risk":       "Medium",
        "complexity": "Moderate",
        "color":      "#f97316",
        "status":     "live",
        "params": [
            {"name": "lookback_window",      "label": "Lookback Window",      "default": 15,  "min": 5,   "max": 60,  "step": 1,   "desc": "Rolling window for mean/std calculation"},
            {"name": "reversion_threshold",  "label": "Reversion Threshold",  "default": 2.0, "min": 0.5, "max": 4.0, "step": 0.1, "desc": "Standard deviations from mean to trigger entry"},
        ],
        "formula": "μ_m = mean(p_{t-w}..p_t);  σ_m = stdev;  |p_t - μ_m| > k·σ → Fade",
        "description": (
            "Assumes probability series reverts to a moving mean. "
            "Takes opposing positions when price deviates more than k standard deviations from "
            "the rolling mean — long when below, short (via NO) when above.\n\n"
            "Similar to Z-Score Reversion but uses absolute deviation rather than z-score "
            "for entry decisions. Well-suited for markets without strong directional trend."
        ),
        "logic": {
            "entry": "abs(p_t - μ_window) > k × σ_window AND no_position",
            "exit":  "p_t reverts within 0.5σ of μ OR stop_loss hit",
            "size":  "proportional to deviation magnitude",
        },
        "edge": (
            "Prediction market probabilities often exhibit short-term mean reversion around "
            "anchored prior beliefs. Fading extreme moves captures the snap-back from "
            "liquidity-driven dislocations. Most effective in stable, resolved markets."
        ),
        "risks": [
            "Large moves may represent genuine information updates, not noise — risk of fading real trends",
            "Mean-reversion assumption breaks near resolution as probabilities converge to 0 or 1",
            "Lookback window selection critically impacts performance across different market types",
            "Poorly calibrated threshold leads to over-trading in volatile markets",
        ],
        "performance": {"win_rate": 55, "avg_return": 7.1, "sharpe": 1.1, "max_dd": 13, "trades": 118},
        "synthetic_curve": _curve(33, trend=0.002, noise=0.040),
    },
    {
        "id":         "market_making",
        "name":       "Market Making",
        "tagline":    "Collect bid-ask spread with inventory management",
        "category":   "Market Making",
        "risk":       "Low-Medium",
        "complexity": "Advanced",
        "color":      "#ef4444",
        "status":     "live",
        "params": [
            {"name": "mm_spread", "label": "Spread Width",  "default": 0.04, "min": 0.01, "max": 0.20, "step": 0.01, "desc": "Target bid-ask spread to collect (e.g., 0.04 = 4¢)"},
            {"name": "stop_loss", "label": "Stop Loss",     "default": 0.08, "min": 0.02, "max": 0.30, "step": 0.01, "desc": "Hard loss floor per position"},
        ],
        "formula": "bid = μ_5 - spread/2;  ask = μ_5 + spread/2;  ∆inventory < cap → rebalance",
        "description": (
            "Posts bids below short-term fair value and exits when price rises by the full spread. "
            "Uses a rolling 5-period mean as the fair value estimate. "
            "A hard inventory cap prevents directional over-exposure.\n\n"
            "Generates consistent small wins from spread collection. "
            "Best used in markets with regular two-way flow and no strong directional trend."
        ),
        "logic": {
            "entry": "p_t < μ_5 - spread/2 AND inventory < max_inventory",
            "exit":  "p_t >= p_entry + spread OR inventory > max_inventory",
            "size":  "min(capital / spread, available_liquidity / 3)",
        },
        "edge": (
            "Prediction markets have structural bid-ask spreads from uninformed retail flow. "
            "Passive liquidity provision earns the spread repeatedly — generating positive "
            "expected value without requiring directional prediction. High win rate, low average gain."
        ),
        "risks": [
            "Adverse selection: informed traders cross your quotes when they have an information edge you lack",
            "Inventory accumulation during trending markets creates hidden directional exposure",
            "Hard to implement effectively in low-volume markets with wide natural spreads",
            "Spread collected may be smaller than transaction costs on real CLOB execution",
        ],
        "performance": {"win_rate": 73, "avg_return": 6.3, "sharpe": 2.1, "max_dd": 7, "trades": 412},
        "synthetic_curve": _curve(55, trend=0.002, noise=0.018),
    },
    {
        "id":         "xgboost",
        "name":       "XGBoost",
        "tagline":    "330 gradient corrections per prediction — where am I still wrong?",
        "category":   "Machine Learning",
        "risk":       "Medium",
        "complexity": "Expert",
        "color":      "#e879f9",
        "status":     "live",
        "params": [
            {"name": "xgb_n_estimators",  "label": "Boost Rounds",    "default": 330,  "min": 10,   "max": 1000, "step": 10,   "desc": "Number of gradient correction cycles (trees)"},
            {"name": "xgb_learning_rate", "label": "Learning Rate η", "default": 0.1,  "min": 0.01, "max": 0.5,  "step": 0.01, "desc": "Step size per correction — lower = more conservative"},
            {"name": "xgb_max_depth",     "label": "Tree Depth",      "default": 3,    "min": 1,    "max": 8,    "step": 1,    "desc": "Max depth of each decision tree — keep shallow to reduce overfit"},
            {"name": "xgb_train_frac",    "label": "Train Window",    "default": 0.30, "min": 0.10, "max": 0.70, "step": 0.05, "desc": "Fraction of history used for initial model training"},
            {"name": "xgb_confidence",    "label": "Entry Confidence", "default": 0.55, "min": 0.50, "max": 0.90, "step": 0.01, "desc": "Min predicted P(up) required to enter long"},
        ],
        "formula": "F(m) = F(m-1) + η × (−∂L/∂F(m-1));  330 correction cycles;  enter if P(up) ≥ confidence",
        "description": (
            "Gradient boosting ensemble that trains 330 shallow decision trees, each correcting "
            "the residual error of the previous. At each step the model asks: where am I still wrong?\n\n"
            "Uses walk-forward validation — trains only on past data before each prediction — "
            "eliminating lookahead bias. Features include rolling z-scores, multi-lag momentum, "
            "directional ratios, and anchoring distance from 0.5.\n\n"
            "Retrains incrementally as new data arrives."
        ),
        "logic": {
            "entry": "xgb.predict_proba(features_t)[1] >= confidence AND no_position",
            "exit":  "xgb.predict_proba(features_t)[1] < 0.50 OR prob_stop hit",
            "size":  "full capital deployment on signal (Kelly sizing planned)",
        },
        "edge": (
            "Gradient boosting captures non-linear relationships between probability momentum, "
            "volatility regimes, and anchoring effects that rule-based strategies miss. "
            "Walk-forward retraining keeps the model adapted to current market conditions."
        ),
        "risks": [
            "Sparse probability histories (< 30 data points) produce unreliable models",
            "Overfitting risk if n_estimators is too high relative to training set size",
            "Training cost increases with history length — retrain frequency affects backtest speed",
            "Features derived purely from price series; no fundamental signals included",
            "Model performance highly sensitive to feature quality — garbage in, garbage out",
        ],
        "performance": {"win_rate": 0, "avg_return": 0, "sharpe": 0, "max_dd": 0, "trades": 0},
        "synthetic_curve": _curve(11, trend=0.007, noise=0.028),
    },
    {
        "id":         "short_momentum",
        "name":       "Short Momentum",
        "tagline":    "Short falling stocks, cover on reversal",
        "category":   "Trend Following",
        "risk":       "High",
        "complexity": "Moderate",
        "color":      "#ef4444",
        "status":     "live",
        "params": [
            {"name": "stop_loss", "label": "Max Loss %", "default": 0.07, "min": 0.01, "max": 0.25, "step": 0.01, "desc": "Cover short if price rises this % above entry"},
        ],
        "formula": "∂p/∂t < 0 → Short;  ∂p/∂t > 0 → Cover;  (p - entry)/entry > stop → Cover forced",
        "description": (
            "Mirror of the Momentum Chaser — profits from sustained downtrends by going short. "
            "Enters short when the price is falling tick-over-tick, covers when it reverses upward.\n\n"
            "Best suited for stocks in clear downtrends. Uses a percentage stop loss to cap upside risk on the short."
        ),
        "logic": {
            "entry": "p_t < p_{t-1} AND no_position",
            "exit":  "p_t >= p_{t-1} OR (p_t - entry) / entry >= stop_loss",
            "size":  "full capital (margin model)",
        },
        "edge": (
            "Momentum persists in equity markets — particularly on the downside where fear amplifies selling. "
            "Short momentum captures the asymmetric downside acceleration that long-only strategies cannot profit from."
        ),
        "risks": [
            "Short squeezes — sudden upward reversals can rapidly exceed stop loss",
            "Unlimited theoretical loss if price rises sharply without a stop in place",
            "Whipsaw in choppy markets triggers many entries and forced covers",
            "Short borrowing costs apply in real trading (modeled as zero here)",
        ],
        "performance": {"win_rate": 0, "avg_return": 0, "sharpe": 0, "max_dd": 0, "trades": 0},
        "synthetic_curve": _curve(88, trend=-0.004, noise=0.045),
    },
    {
        "id":         "short_zscore",
        "name":       "Short Z-Score",
        "tagline":    "Short overbought spikes, cover on mean reversion",
        "category":   "Statistical Arbitrage",
        "risk":       "High",
        "complexity": "Advanced",
        "color":      "#f43f5e",
        "status":     "live",
        "params": [
            {"name": "zscore_window", "label": "Window (days)",  "default": 20,  "min": 5,   "max": 100, "step": 1,   "desc": "Rolling window for mean/std calculation"},
            {"name": "zscore_entry",  "label": "Entry Z-Score",  "default": 1.5, "min": 0.5, "max": 4.0, "step": 0.1, "desc": "Short when z-score rises above +this value (overbought)"},
            {"name": "zscore_exit",   "label": "Exit Z-Score",   "default": 0.0, "min":-2.0, "max": 2.0, "step": 0.1, "desc": "Cover when z-score reverts to or below this level"},
            {"name": "stop_loss",     "label": "Loss Stop %",    "default": 0.07, "min": 0.01, "max": 0.25, "step": 0.01, "desc": "Cover if price rises this % above short entry"},
        ],
        "formula": "z = (p - μ_w) / σ_w;  z > +z_entry → Short;  z ≤ z_exit → Cover;  rise > stop → Cover forced",
        "description": (
            "Complement to Z-Score Reversion — shorts statistical overbought conditions instead of buying dips. "
            "Enters short when the z-score spikes above +entry_z, covers on mean reversion back to exit_z.\n\n"
            "Works best when a stock spikes on short-term sentiment without fundamental support, "
            "then reverts. Pair with Short Momentum for full short-side coverage."
        ),
        "logic": {
            "entry": "z_t > +z_entry AND no_position",
            "exit":  "z_t <= z_exit OR (p_t - entry) / entry >= stop_loss",
            "size":  "full capital (margin model)",
        },
        "edge": (
            "Overbought stocks frequently revert after sentiment-driven spikes. "
            "Z-score filters distinguish genuine breakouts from statistical noise, "
            "giving a more selective entry than pure price momentum."
        ),
        "risks": [
            "True breakouts can drive z-score higher for extended periods — stop loss essential",
            "Earnings surprises or macro events can cause gap-up moves that bypass stops",
            "Short borrowing costs apply in real trading (modeled as zero here)",
            "Window too short creates noisy signals; too long misses short-term spikes",
        ],
        "performance": {"win_rate": 0, "avg_return": 0, "sharpe": 0, "max_dd": 0, "trades": 0},
        "synthetic_curve": _curve(77, trend=-0.003, noise=0.035),
    },
    {
        "id":         "swing_reversion",
        "name":       "Swing Reversion",
        "tagline":    "Buy SMA dips, take the 5% bounce",
        "category":   "Mean Reversion",
        "risk":       "Medium",
        "complexity": "Intermediate",
        "color":      "#06b6d4",
        "status":     "live",
        "params": [
            {"name": "window",          "label": "SMA Window",    "default": 10,   "min": 5,    "max": 50,   "step": 1,    "desc": "Short-term SMA lookback (candles). Shorter = more responsive to oscillations."},
            {"name": "entry_threshold", "label": "Dip Entry %",   "default": 0.03, "min": 0.01, "max": 0.15, "step": 0.005,"desc": "Enter long when price is this % below the SMA (e.g. 0.03 = 3% dip)."},
            {"name": "exit_threshold",  "label": "Profit Target %","default": 0.05, "min": 0.01, "max": 0.20, "step": 0.005,"desc": "Exit when price recovers this % above entry (e.g. 0.05 = 5% gain)."},
            {"name": "stop_loss",       "label": "Hard Stop %",   "default": 0.02, "min": 0.01, "max": 0.15, "step": 0.005,"desc": "Exit immediately if price falls this % below entry. Prevents trend-riding losses."},
        ],
        "formula": "SMA_w = mean(p_{t-w..t});  dip = (SMA_w - p_t) / SMA_w;  dip ≥ entry% → Buy;  gain ≥ target% → Sell;  loss ≥ stop% → Sell forced",
        "description": (
            "Designed for stocks with regular short-term oscillations around a declining or flat trend. "
            "Where Threshold anchors to a rolling high (which drifts away on bearish stocks), "
            "Swing Reversion anchors to a short-window SMA — so entries remain valid throughout the trend.\n\n"
            "Enter long when price dips below the SMA by the entry threshold (signalling a temporary oversold condition), "
            "then exit when the price recovers the target percentage above your entry. "
            "A hard stop prevents getting trapped if the dip continues into a larger leg down.\n\n"
            "Best suited for stocks with identifiable ~3–7% oscillation ranges: consumer staples, large-cap cyclicals, "
            "beaten-down blue chips. Not effective on parabolic trends or low-volatility assets."
        ),
        "logic": {
            "entry": "price < SMA(window) × (1 - entry_threshold)  →  Buy",
            "exit":  "price ≥ entry × (1 + exit_threshold)  →  Sell  |  price ≤ entry × (1 - stop_loss)  →  Sell forced",
            "size":  "full available capital",
        },
        "edge": (
            "Bearish trending stocks still oscillate — the trend sets direction but short-term mean reversion "
            "creates tradable bounces. SMA anchoring captures these bounces without being fooled by the "
            "ever-lower rolling-high that makes Threshold progressively blind on downtrending names."
        ),
        "risks": [
            "Gap-down opens can breach the stop loss before the order fires",
            "Works poorly in strong directional moves with no reversion (e.g. earnings crash)",
            "Short SMA windows produce more entries but also more false signals",
            "Not designed for intraday — calibrated for daily candles",
        ],
        "performance": {"win_rate": 0, "avg_return": 0, "sharpe": 0, "max_dd": 0, "trades": 0},
        "synthetic_curve": _curve(60, trend=0.001, noise=0.025),
    },
    {
        "id":         "wizard",
        "name":       "Wizard",
        "tagline":    "Run all strategies — let the best one win",
        "category":   "Meta",
        "risk":       "Variable",
        "complexity": "Expert",
        "color":      "#a855f7",
        "status":     "live",
        "params":     [],
        "formula":    "winner = argmax_{s ∈ S} total_return(s, history)",
        "description": (
            "Runs every long strategy on the same price history simultaneously and returns "
            "the one that performed best — no guesswork, no manual selection.\n\n"
            "Rankings are shown for all strategies so you can see not just the winner "
            "but how each one fared. Useful for quickly profiling a new market or asset "
            "before committing to a strategy."
        ),
        "logic": {
            "entry": "delegate to each strategy",
            "exit":  "delegate to each strategy",
            "size":  "winner = highest total_return; sharpe used as tiebreaker",
        },
        "edge": (
            "Different market regimes favour different strategies. Wizard finds the best fit "
            "empirically rather than requiring you to predict the regime in advance."
        ),
        "risks": [
            "Winner is determined in-sample — results reflect past performance, not future",
            "Takes longer than a single strategy run (6× the compute)",
            "Does not ensemble or blend strategies — picks one winner only",
        ],
        "performance": {"win_rate": 0, "avg_return": 0, "sharpe": 0, "max_dd": 0, "trades": 0},
        "synthetic_curve": _curve(42, trend=0.006, noise=0.025),
    },
    {
        "id":         "structure_harvest",
        "name":       "Structure Harvest",
        "tagline":    "Exploit resolution structure and time-decay",
        "category":   "Event-Driven",
        "risk":       "High",
        "complexity": "Expert",
        "color":      "#f97316",
        "status":     "soon",
        "params": [],
        "formula": "E[payout | structure] > market_price → arbitrage opportunity",
        "description": (
            "Advanced strategy exploiting structural opportunities in Polymarket's "
            "resolution mechanics and time-decay of prediction shares. "
            "Targets systematic mispricings in correlated market bundles.\n\n"
            "Currently under development. Coming soon."
        ),
        "logic": {
            "entry": "E[payout | resolution_structure] > current_price × (1 + min_edge)",
            "exit":  "Structure arbitrage closes or time-decay captured",
            "size":  "position_limit × confidence_factor",
        },
        "edge": (
            "Polymarket's binary resolution creates structural mispricings in correlated events. "
            "Time-decay in near-resolution markets often underprices the tail. "
            "Exploiting these requires deep knowledge of the platform's mechanics."
        ),
        "risks": [
            "High complexity — requires deep understanding of Polymarket resolution rules",
            "Edge disappears if resolution criteria change or are clarified",
            "Requires careful monitoring of multiple correlated positions simultaneously",
            "Limited market availability — few markets exhibit sufficient structural mispricing",
        ],
        "performance": {"win_rate": 0, "avg_return": 0, "sharpe": 0, "max_dd": 0, "trades": 0},
        "synthetic_curve": [1.0] * 32,
    },
]

# Map for quick lookup by ID
STRATEGY_MAP = {s["id"]: s for s in ALL_STRATEGIES}
