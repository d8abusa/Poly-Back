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
