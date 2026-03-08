from .zscore_reversion import strategy as zscore_reversion
from .structure_harvest import strategy as structure_harvest
from .kelly import strategy as kelly
from .momentum import strategy as momentum
from .market_making import strategy as market_making

ALL_STRATEGIES = [
    zscore_reversion,
    structure_harvest,
    kelly,
    momentum,
    market_making,
]

STRATEGY_MAP = {s.id: s for s in ALL_STRATEGIES}
