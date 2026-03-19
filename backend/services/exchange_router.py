"""
Exchange router — returns the correct exchange client based on the exchange name.
Supports: coinbase (default), kalshi, manifold
Note: polymarket is geoblocked for US users — requests fall back to coinbase.
"""

from .base_client import BaseExchangeClient


SUPPORTED_EXCHANGES = ["coinbase", "kalshi", "manifold"]
DEFAULT_EXCHANGE    = "coinbase"


def get_exchange_client(exchange: str = DEFAULT_EXCHANGE) -> BaseExchangeClient:
    """Return the singleton client for the requested exchange."""
    exchange = (exchange or DEFAULT_EXCHANGE).lower().strip()

    if exchange == "coinbase":
        from .coinbase_client import get_coinbase_client
        return get_coinbase_client()

    if exchange == "kalshi":
        from .kalshi_client import get_kalshi_client
        return get_kalshi_client()

    if exchange == "manifold":
        from .manifold_client import get_manifold_client
        return get_manifold_client()

    # Polymarket geoblocked for US users — redirect to Coinbase
    if exchange == "polymarket":
        from .coinbase_client import get_coinbase_client
        return get_coinbase_client()

    raise ValueError(f"Unknown exchange: {exchange!r}. Supported: {SUPPORTED_EXCHANGES}")
