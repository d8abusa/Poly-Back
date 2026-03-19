from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..services.exchange_router import get_exchange_client, SUPPORTED_EXCHANGES
from ..services.base_client import BaseExchangeClient

router = APIRouter(prefix="/api/markets", tags=["markets"])


def _get_client(exchange: str = Query("kalshi")) -> BaseExchangeClient:
    return get_exchange_client(exchange)


@router.get("")
async def search_markets(
    q:        str            = Query(""),
    limit:    int            = Query(50, ge=1, le=200),
    offset:   int            = Query(0, ge=0),
    exchange: str            = Query("kalshi"),
    active:   Optional[bool] = Query(None),
    closed:   Optional[bool] = Query(None),
    order:    str            = Query("volumeNum"),
    tag_slug: Optional[str]  = Query(None),
    client: BaseExchangeClient = Depends(_get_client),
):
    kwargs: dict = {}
    if active   is not None: kwargs["active"]   = active
    if closed   is not None: kwargs["closed"]   = closed
    if order:                kwargs["order"]    = order
    if tag_slug:             kwargs["tag_slug"] = tag_slug

    try:
        raw = await client.search_markets(limit=limit, offset=offset, **kwargs)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Exchange error ({exchange}): {e}")
    markets = [client.normalize_market(m) for m in raw]

    if q:
        ql = q.lower()
        markets = [
            m for m in markets
            if ql in m["title"].lower() or any(ql in t.lower() for t in m.get("tags", []))
        ]

    return {"markets": markets, "count": len(markets), "exchange": exchange}


@router.get("/exchanges")
async def list_exchanges():
    """List all supported exchanges."""
    return {
        "exchanges": [
            {"id": "polymarket", "name": "Polymarket",       "type": "real_money", "description": "Decentralized prediction market on Polygon"},
            {"id": "kalshi",     "name": "Kalshi",           "type": "real_money", "description": "CFTC-regulated US prediction market exchange"},
            {"id": "manifold",   "name": "Manifold Markets", "type": "play_money", "description": "Open-source AMM platform — ideal for strategy research"},
        ]
    }


@router.get("/tags")
async def list_tags(
    exchange: str = Query("kalshi"),
    client: BaseExchangeClient = Depends(_get_client),
):
    if hasattr(client, "get_tags"):
        tags = await client.get_tags()
        return {"tags": tags}
    return {"tags": []}


@router.get("/{market_id}")
async def get_market(
    market_id: str,
    exchange:  str = Query("kalshi"),
    client: BaseExchangeClient = Depends(_get_client),
):
    try:
        if hasattr(client, "get_market"):
            return await client.get_market(market_id)
        raise HTTPException(status_code=404, detail="get_market not supported for this exchange")
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{market_id}/history")
async def price_history(
    market_id: str,
    token_id:  Optional[str] = Query(None, description="YES token ID (Polymarket only)"),
    interval:  str           = Query("max"),
    exchange:  str           = Query("kalshi"),
    client: BaseExchangeClient = Depends(_get_client),
):
    try:
        history = await client.get_price_history(market_id, token_id=token_id, interval=interval)
        return {"history": history, "exchange": exchange}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
