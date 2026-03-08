from ..models.schemas import BaseStrategy, StrategyParam, StrategyPerformance

strategy = BaseStrategy(
    id="zscore_reversion",
    name="Z-Score Reversion",
    tagline="Mean reversion via statistical deviation",
    category="Statistical",
    risk="Medium",
    complexity="Intermediate",
    color="#00d4a8",
    description=(
        "Identifies markets where current probability has deviated significantly from its "
        "rolling mean. Enters when the z-score crosses a negative threshold, betting on "
        "reversion to mean. Position size scales with the magnitude of deviation."
    ),
    logic={
        "entry": "z = (p − μ) / σ  <  −z_entry",
        "exit":  "z ≥ 0  OR  prob ≥ exit_threshold  OR  prob ≤ stop_loss",
        "size":  "f = |z| / (2 · z_entry),  capped at max_position",
    },
    formula="z = (p_current − μ_window) / σ_window",
    params=[
        StrategyParam(name="z_entry",         label="Entry Z-Score",   default=1.5,  min=0.5,  max=3.0,  step=0.1, desc="How many std devs below mean to trigger entry"),
        StrategyParam(name="window",           label="Rolling Window",  default=20,   min=5,    max=60,   step=1,   desc="Lookback period for mean/std calculation (days)"),
        StrategyParam(name="exit_threshold",   label="Exit Prob %",     default=58,   min=51,   max=95,   step=1,   desc="Probability target to close position"),
        StrategyParam(name="stop_loss",        label="Stop Loss %",     default=8,    min=1,    max=30,   step=1,   desc="Max loss before forced exit"),
    ],
    edge=(
        "Exploits overreaction to short-term news. Most effective in markets with "
        ">30 days to resolution and high liquidity."
    ),
    risks=[
        "Trending markets — z-score keeps falling",
        "Thin liquidity amplifies slippage",
        "Resolution before reversion",
    ],
    performance=StrategyPerformance(win_rate=64, avg_return=18.2, sharpe=1.84, max_dd=14.1, trades=312),
    synthetic_curve=[0.3,0.28,0.25,0.22,0.2,0.21,0.24,0.28,0.33,0.38,0.44,0.5,0.56,0.61,0.65,0.68,0.7,0.71,0.72,0.73],
)
