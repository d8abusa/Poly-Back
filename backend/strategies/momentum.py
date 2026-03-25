from ..models.schemas import BaseStrategy, StrategyParam, StrategyPerformance

strategy = BaseStrategy(
    id="momentum",
    name="Momentum Chaser",
    tagline="Follow trend breakouts with trailing stop",
    category="Trend Following",
    risk="High",
    complexity="Beginner",
    color="#f59e0b",
    description=(
        "Enters positions when probability shows strong directional momentum — a breakout "
        "above a recent high or below a recent low. Follows the move with a trailing stop "
        "to lock in gains while letting winners run."
    ),
    logic={
        "entry": "prob > max(prob_window)  AND  momentum_score > threshold",
        "exit":  "prob < trailing_high − trail_pct  OR  prob ≤ stop_loss",
        "size":  "f = momentum_score · max_position",
    },
    formula="momentum = (p_now − p_{t−window}) / p_{t−window}  ×  100",
    params=[
        StrategyParam(name="window",       label="Breakout Window",   default=14, min=3,  max=30, step=1,  desc="Days to look back for breakout level"),
        StrategyParam(name="momentum_min", label="Min Momentum %",    default=5,  min=0.5, max=50, step=0.5, desc="Minimum % breakout above rolling high to confirm entry"),
        StrategyParam(name="trail_pct",    label="Trail Distance %",  default=10, min=3,  max=25, step=1,  desc="How far below peak before trailing stop fires"),
        StrategyParam(name="stop_loss",    label="Hard Stop %",       default=15, min=5,  max=40, step=1,  desc="Absolute stop loss regardless of trailing"),
    ],
    edge=(
        "Captures resolution momentum as markets approach binary outcomes. "
        "Most effective in final 2 weeks before resolution."
    ),
    risks=[
        "Whipsaws in choppy markets",
        "Late entries miss most of the move",
        "High turnover increases fee drag",
    ],
    performance=StrategyPerformance(win_rate=52, avg_return=12.4, sharpe=1.12, max_dd=22.7, trades=421),
    synthetic_curve=[0.5,0.48,0.5,0.47,0.49,0.52,0.55,0.6,0.58,0.62,0.65,0.61,0.64,0.67,0.7,0.68,0.72,0.75,0.74,0.77],
)
