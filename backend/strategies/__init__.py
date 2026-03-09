ALL_STRATEGIES = [
    {
        "id":       "threshold",
        "name":     "Threshold",
        "tagline":  "Buy low, sell high on fixed probability bands",
        "category": "Mean Reversion",
        "risk":     "Low",
        "color":    "#00d4a8",
        "status":   "live",
        "params": ["entry_threshold", "exit_threshold", "stop_loss"],
    },
    {
        "id":       "momentum",
        "name":     "Momentum Chaser",
        "tagline":  "Ride rising probabilities, exit on reversal",
        "category": "Trend Following",
        "risk":     "Medium",
        "color":    "#f59e0b",
        "status":   "live",
        "params": ["entry_threshold", "exit_threshold", "stop_loss"],
    },
    {
        "id":       "zscore_reversion",
        "name":     "Z-Score Reversion",
        "tagline":  "Trade statistical dislocations back to the mean",
        "category": "Statistical Arbitrage",
        "risk":     "Medium",
        "color":    "#7b61ff",
        "status":   "live",
        "params": ["zscore_window", "zscore_entry", "zscore_exit", "zscore_stop", "stop_loss"],
        "description": (
            "Maintains a rolling window of recent probabilities and computes a z-score. "
            "Enters long when the probability is statistically depressed (z < -entry), "
            "exits when it reverts to the mean (z >= exit). "
            "Captures noise-driven dislocations in thin prediction markets."
        ),
    },
    {
        "id":       "kelly",
        "name":     "Kelly Criterion",
        "tagline":  "Optimal fractional sizing based on estimated edge",
        "category": "Position Sizing",
        "risk":     "Medium-High",
        "color":    "#22c55e",
        "status":   "live",
        "params": ["kelly_fraction", "entry_threshold", "exit_threshold", "stop_loss"],
        "description": (
            "Uses the Kelly formula (f* = bp-q / b) to size each position "
            "proportional to estimated edge. Dynamically adjusts stake based on "
            "recent win rate. Half-Kelly (0.5) is default for variance reduction."
        ),
    },
    {
        "id":       "market_making",
        "name":     "Market Making",
        "tagline":  "Collect bid-ask spread with inventory management",
        "category": "Market Making",
        "risk":     "Low-Medium",
        "color":    "#ef4444",
        "status":   "live",
        "params": ["mm_spread", "stop_loss"],
        "description": (
            "Posts bids below fair value and exits when price rises by the spread. "
            "Uses a rolling short-term mean as the fair value estimate. "
            "Hard inventory cap prevents directional over-exposure."
        ),
    },
    {
        "id":       "structure_harvest",
        "name":     "Structure Harvest",
        "tagline":  "Exploit resolution structure and time-decay",
        "category": "Event-Driven",
        "risk":     "High",
        "color":    "#f97316",
        "status":   "soon",
        "params": [],
    },
]

STRATEGY_MAP = {s["id"]: s for s in ALL_STRATEGIES}
