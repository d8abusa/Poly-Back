"""
Data models for Watchlist and Alerts features.
"""

from datetime import datetime, timezone
from typing import Optional, Literal
from pydantic import BaseModel, Field


class WatchlistItem(BaseModel):
    """Individual watchlist entry."""
    id: str
    market_id: str
    market_title: str
    category: str = "Other"
    exchange: str = "polymarket"
    added_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class WatchlistCreate(BaseModel):
    """Request to create watchlist item."""
    market_id: str
    market_title: str
    category: str = "Other"
    exchange: str = "polymarket"


class AlertTrigger(BaseModel):
    """Type of alert trigger."""
    price_type: Literal["entry", "target", "stop_loss"]
    threshold: float
    direction: Literal["above", "below"]


class AlertCreate(BaseModel):
    """Request to create alert."""
    market_id: str
    trigger: AlertTrigger


class Alert(BaseModel):
    """Alert record."""
    id: str
    watchlist_item_id: Optional[str] = None
    market_id: str
    market_title: str
    trigger: AlertTrigger
    triggered_at: Optional[str] = Field(default=None)
    dismissed_at: Optional[str] = Field(default=None)
    read: bool = False
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())