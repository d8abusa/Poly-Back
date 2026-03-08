from ..models.schemas import BaseStrategy, StrategyParam, StrategyPerformance

strategy = BaseStrategy(
    id="structure_harvest",
    name="Structure Harvest",
    tagline="Exploit the maker-taker structural leak",
    category="Market Microstructure",
    risk="Low-Medium",
    complexity="Advanced",
    color="#ff6b35",
    description=(
        "Targets the systematic wealth transfer from takers to makers documented across "
        "72.1M Polymarket trades. Takers consistently overpay for probability by 57% of "
        "implied value. This strategy posts limit orders on the maker side, waiting for "
        "emotional taker flow to execute against them."
    ),
    logic={
        "entry": "Post YES limit at prob < entry_threshold  AND  affirmative_bias_score > bias_min",
        "exit":  "Fill confirmed  →  hold to exit_target  OR  resolution",
        "size":  "ΔW = (S_spread + Δ_taker) · position  |  f = edge / max(σ, 0.01)",
    },
    formula="ΔW = (S_spread + Δ_taker) − (−Δ_taker)  |  Δ_taker = P_implied − P_actual",
    params=[
        StrategyParam(name="entry_threshold", label="Entry Threshold ¢", default=15,   min=1,   max=30,   step=1,    desc="Max price to post maker limit (longshot range)"),
        StrategyParam(name="bias_min",        label="Min Bias Score",    default=70,   min=50,  max=95,   step=5,    desc="Minimum affirmative bias % to qualify market"),
        StrategyParam(name="exit_target",     label="Exit Target ¢",     default=45,   min=20,  max=90,   step=5,    desc="Price target to close filled position"),
        StrategyParam(name="spread_min",      label="Min Spread %",      default=1.25, min=0.5, max=5.0,  step=0.25, desc="Minimum maker edge to enter"),
    ],
    edge=(
        "Cohen's d ≈ 0.02 confirms pure structure harvest — zero directional bet required. "
        "Edge reproduces across 80 of 99 price levels."
    ),
    risks=[
        "Low fill rate — limit orders may not execute",
        "Market resolves before fill",
        "Liquidity dries up mid-hold",
    ],
    performance=StrategyPerformance(win_rate=71, avg_return=28.4, sharpe=2.41, max_dd=6.8, trades=89),
    synthetic_curve=[0.5,0.52,0.55,0.54,0.57,0.6,0.58,0.62,0.65,0.67,0.69,0.71,0.73,0.74,0.76,0.77,0.78,0.79,0.8,0.81],
)
