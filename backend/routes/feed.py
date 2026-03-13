"""
Live market feed — supports all exchanges.
No auth required for public read endpoints.
"""

import logging
from fastapi import APIRouter, Query, HTTPException

from ..services.exchange_router import get_exchange_client
from ..config import settings

log    = logging.getLogger(__name__)
router = APIRouter(prefix="/api/feed", tags=["feed"])


@router.get("/auth/status")
async def auth_status():
    """Returns current auth level and capabilities. Never exposes key values."""
    return settings.status_dict()


@router.get("/snapshot")
async def market_snapshot(
    market_id:    str = Query(..., description="Market ID / ticker"),
    token_id:     str = Query(None, description="YES token ID (Polymarket only)"),
    condition_id: str = Query(None, description="Condition ID (Polymarket only)"),
    exchange:     str = Query("polymarket"),
):
    """
    Single combined call: order book, recent trades, last price, midpoint, market status.
    Designed for polling every 5–10 s from the frontend.
    """
    client = get_exchange_client(exchange)
    # Backward compat: Polymarket snapshot uses (token_id, condition_id)
    mid  = market_id or condition_id or token_id
    tid  = token_id or mid
    cid  = condition_id or mid
    try:
        if exchange == "polymarket" and hasattr(client, "get_market_snapshot"):
            return await client.get_market_snapshot(tid, cid)
        return await client.get_market_snapshot(mid, tid)
    except Exception as exc:
        log.warning("feed snapshot failed market=%s exchange=%s: %s", mid, exchange, exc)
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/book")
async def order_book(
    market_id: str = Query(...),
    token_id:  str = Query(None),
    exchange:  str = Query("polymarket"),
):
    client = get_exchange_client(exchange)
    try:
        return await client.get_order_book(market_id, token_id=token_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/trades")
async def recent_trades(
    market_id: str = Query(...),
    token_id:  str = Query(None),
    limit:     int = Query(default=20, ge=1, le=100),
    exchange:  str = Query("polymarket"),
):
    client = get_exchange_client(exchange)
    try:
        return {"trades": await client.get_recent_trades(market_id, token_id=token_id, limit=limit)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
