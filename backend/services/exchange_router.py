"""
Exchange router — returns the correct exchange client based on the exchange name.
Supports: polymarket (default), kalshi, manifold
"""

from .base_client import BaseExchangeClient


SUPPORTED_EXCHANGES = ["polymarket", "kalshi", "manifold"]
DEFAULT_EXCHANGE    = "polymarket"


def get_exchange_client(exchange: str = DEFAULT_EXCHANGE) -> BaseExchangeClient:
    """Return the singleton client for the requested exchange."""
    exchange = (exchange or DEFAULT_EXCHANGE).lower().strip()

    if exchange == "kalshi":
        from .kalshi_client import get_kalshi_client
        return get_kalshi_client()

    if exchange == "manifold":
        from .manifold_client import get_manifold_client
        return get_manifold_client()

    # Default: polymarket
    from .polymarket_client import get_client
    return get_client()
