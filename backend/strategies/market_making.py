from ..models.schemas import BaseStrategy, StrategyParam, StrategyPerformance

strategy = BaseStrategy(
    id="market_making",
    name="Market Making",
    tagline="Quote both sides, capture the spread",
    category="Liquidity Provision",
    risk="Low",
    complexity="Advanced",
    color="#22c55e",
    description=(
        "Posts simultaneous limit orders on both YES and NO sides of the book, collecting "
        "the bid-ask spread from traders who need immediate execution. Profits from volume "
        "rather than directional moves. Requires tight risk management to avoid adverse selection."
    ),
    logic={
        "entry": "Post YES bid at (midpoint − spread/2)  AND  NO ask at (midpoint + spread/2)",
        "exit":  "One side fills  →  immediately hedge or flatten  OR  hold to capture full spread",
        "size":  "f = min(max_inventory, available_liquidity · inventory_pct)",
    },
    formula="Edge = spread / 2 − adverse_selection_cost  |  spread = ask − bid",
    params=[
        StrategyParam(name="spread_target",  label="Target Spread %",    default=2.5,   min=0.5, max=10.0,   step=0.5,  desc="Minimum spread to quote (your gross edge)"),
        StrategyParam(name="inventory_pct",  label="Inventory Limit %",  default=20,    min=5,   max=50,     step=5,    desc="Max % of available liquidity to hold"),
        StrategyParam(name="hedge_threshold",label="Hedge Threshold %",   default=10,    min=5,   max=30,     step=1,    desc="Net inventory imbalance to trigger hedge"),
        StrategyParam(name="min_volume",     label="Min Daily Volume $",  default=10000, min=1000,max=100000, step=1000, desc="Minimum market volume to quote"),
    ],
    edge=(
        "Captures spread on every round-trip. Profitable in high-volume, stable markets. "
        "Cohen's d ≈ 0.02 confirms makers don't need directional view."
    ),
    risks=[
        "Adverse selection — informed traders pick off your quotes",
        "Inventory risk if one side never fills",
        "Low spread in efficient markets",
    ],
    performance=StrategyPerformance(win_rate=71, avg_return=18.6, sharpe=1.61, max_dd=6.4, trades=892),
    synthetic_curve=[0.5,0.51,0.52,0.51,0.53,0.54,0.55,0.56,0.55,0.57,0.58,0.59,0.6,0.61,0.62,0.63,0.64,0.65,0.66,0.67],
)
