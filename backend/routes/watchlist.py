"""
Watchlist and alerts API endpoints.
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException

from ..models.watchlist_schema import (
    WatchlistCreate,
    WatchlistItem,
    AlertCreate,
    Alert,
    AlertTrigger,
)
from ..services.watchlist_service import (
    add_to_watchlist,
    remove_from_watchlist,
    get_watchlist,
    find_watchlist_item,
    create_alert,
    dismiss_alert,
    mark_alert_read,
    check_triggers,
    get_alerts,
    get_unread_alerts,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


@router.get("", response_model=list[WatchlistItem])
async def list_watchlist():
    """List all watchlist items."""
    return get_watchlist()


@router.get("/alerts", response_model=list[Alert])
async def list_alerts():
    """List all alerts."""
    return get_alerts()


@router.get("/alerts/unread", response_model=list[Alert])
async def list_unread_alerts():
    """List unread alerts."""
    return get_unread_alerts()


@router.post("")
async def add_watchlist_item(create: WatchlistCreate) -> WatchlistItem:
    """Add a market to the watchlist."""
    try:
        return add_to_watchlist(create)
    except Exception as exc:
        log.error("Failed to add watchlist item: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/item/{item_id}")
async def remove_watchlist_item(item_id: str):
    """Remove a watchlist item."""
    if not remove_from_watchlist(item_id):
        raise HTTPException(status_code=404, detail="Item not found")
    return {"status": "ok"}


@router.post("/alert", response_model=Alert)
async def create_alert_api(create: AlertCreate) -> Alert:
    """Create an alert for a market."""
    try:
        return create_alert(create)
    except Exception as exc:
        log.error("Failed to create alert: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/alert/{alert_id}")
async def dismiss_alert_route(alert_id: str):
    """Dismiss an alert (stop it from triggering again)."""
    if not dismiss_alert(alert_id):
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"status": "dismissed"}


@router.post("/alert/{alert_id}/read")
async def mark_alert_read_route(alert_id: str):
    """Mark alert as read in UI."""
    if not mark_alert_read(alert_id):
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"status": "read"}