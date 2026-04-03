"""
Exchange router — returns the correct exchange client based on the exchange name.
Supports: kalshi (default), coinbase, manifold, yahoo (stocks)
Note: polymarket is geoblocked for US users — requests fall back to kalshi.
"""

from .base_client import BaseExchangeClient


SUPPORTED_EXCHANGES = ["kalshi", "coinbase", "manifold", "yahoo", "robinhood", "webull"]
DEFAULT_EXCHANGE    = "kalshi"


def get_exchange_client(exchange: str = DEFAULT_EXCHANGE) -> BaseExchangeClient:
    """Return the singleton client for the requested exchange."""
    exchange = (exchange or DEFAULT_EXCHANGE).lower().strip()

    if exchange == "kalshi":
        from .kalshi_client import get_kalshi_client
        return get_kalshi_client()

    if exchange == "coinbase":
        from .coinbase_client import get_coinbase_client
        return get_coinbase_client()

    if exchange == "yahoo":
        from .yahoo_client import get_yahoo_client
        return get_yahoo_client()

    if exchange == "manifold":
        from .manifold_client import get_manifold_client
        return get_manifold_client()

    if exchange == "robinhood":
        from .robinhood_client import get_robinhood_client
        return get_robinhood_client()

    if exchange == "webull":
        from .webull_client import get_webull_client
        return get_webull_client()

    # Polymarket geoblocked for US users — redirect to Kalshi
    if exchange == "polymarket":
        from .kalshi_client import get_kalshi_client
        return get_kalshi_client()

    raise ValueError(f"Unknown exchange: {exchange!r}. Supported: {SUPPORTED_EXCHANGES}")
