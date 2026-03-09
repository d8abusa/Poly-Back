"""
Live market feed — public Polymarket CLOB + Gamma data.
No auth required for these endpoints.
"""

import logging
from fastapi import APIRouter, Query, HTTPException

from ..services.polymarket_client import get_client
from ..config import settings

log    = logging.getLogger(__name__)
router = APIRouter(prefix="/api/feed", tags=["feed"])


@router.get("/auth/status")
async def auth_status():
    """Returns current auth level and capabilities. Never exposes key values."""
    return settings.status_dict()


@router.get("/snapshot")
async def market_snapshot(
    token_id:     str = Query(..., description="YES token ID"),
    condition_id: str = Query(..., description="Market condition ID"),
):
    """
    Single combined call: order book, recent trades, last price, midpoint, market status.
    Designed for polling every 5–10 s from the frontend.
    """
    client = get_client()
    try:
        return await client.get_market_snapshot(token_id, condition_id)
    except Exception as exc:
        log.warning("feed snapshot failed token=%s: %s", token_id, exc)
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/book")
async def order_book(token_id: str = Query(...)):
    client = get_client()
    try:
        return await client.get_order_book(token_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/trades")
async def recent_trades(
    token_id: str = Query(...),
    limit:    int = Query(default=20, ge=1, le=100),
):
    client = get_client()
    try:
        return {"trades": await client.get_recent_trades(token_id, limit=limit)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
