from ..models.schemas import BaseStrategy, StrategyParam, StrategyPerformance

strategy = BaseStrategy(
    id="kelly",
    name="Kelly Criterion",
    tagline="Optimal position sizing from edge estimation",
    category="Probabilistic",
    risk="Variable",
    complexity="Intermediate",
    color="#7b61ff",
    description=(
        "Uses the Kelly formula to compute the theoretically optimal fraction of bankroll "
        "to wager, given an estimated true probability. Requires a reliable edge estimate "
        "(p_true). Fractional Kelly (0.5×) is recommended to reduce variance while "
        "preserving most of the growth rate."
    ),
    logic={
        "entry": "prob < kelly_p_true  AND  prob ≤ entry_threshold",
        "exit":  "prob ≥ exit_threshold  OR  prob ≤ stop_loss",
        "size":  "f* = (p_true − prob) / (1 − prob),  capped at 0.50",
    },
    formula="f* = (bp − q) / b  where b = (1−p)/p, p = p_true, q = 1−p_true",
    params=[
        StrategyParam(name="kelly_p_true",   label="True Probability",   default=0.60, min=0.51, max=0.95, step=0.01, desc="Your estimated true probability (your edge)"),
        StrategyParam(name="kelly_fraction", label="Kelly Fraction",      default=0.5,  min=0.1,  max=1.0,  step=0.1,  desc="Fraction of full Kelly (0.5 = half Kelly)"),
        StrategyParam(name="entry_threshold",label="Entry Threshold %",   default=40,   min=5,    max=49,   step=1,    desc="Market price must be below this to enter"),
        StrategyParam(name="stop_loss",      label="Stop Loss %",         default=10,   min=1,    max=30,   step=1,    desc="Exit if market moves this far against you"),
    ],
    edge=(
        "Maximizes long-run bankroll growth rate given accurate p_true. "
        "Half-Kelly cuts variance by ~75% with only ~25% reduction in growth rate."
    ),
    risks=[
        "Edge estimate error is catastrophic — overestimating p_true ruins the formula",
        "Requires calibrated probability model",
        "Full Kelly produces extreme volatility",
    ],
    performance=StrategyPerformance(win_rate=61, avg_return=21.3, sharpe=1.88, max_dd=8.1, trades=147),
    synthetic_curve=[0.5,0.51,0.49,0.52,0.55,0.53,0.57,0.6,0.58,0.62,0.64,0.63,0.66,0.68,0.7,0.69,0.72,0.74,0.75,0.76],
)
