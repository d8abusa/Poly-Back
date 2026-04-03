"""
Watchlist and alerts service.

Manages watchlist items and alerts, checks for trigger conditions.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from ..models.watchlist_schema import WatchlistCreate, AlertCreate, WatchlistItem, Alert
from ..services.db import get_cursor, row_to_dict, row_to_list


# ── In-memory store (persisted to DB on mutation) ────────────────────────

_watchlist: list[WatchlistItem] = []
_alerts: list[Alert] = []
_loaded = False


def _load_from_db() -> None:
    """Load watchlist and alerts from database on first access."""
    global _watchlist, _alerts, _loaded
    if _loaded:
        return

    with get_cursor() as cur:
        # Load watchlist
        cur.execute("SELECT * FROM watchlist ORDER BY added_at")
        rows = row_to_list(cur.fetchall())
        _watchlist = [WatchlistItem(**row) for row in rows]

    with get_cursor() as cur:
        # Load alerts — trigger column stored as JSON text
        cur.execute("SELECT * FROM alerts ORDER BY created_at")
        rows = row_to_list(cur.fetchall())
        for row in rows:
            if isinstance(row.get("trigger"), str):
                row["trigger"] = json.loads(row["trigger"])
        _alerts = [Alert(**row) for row in rows]

    _loaded = True


def _save_watchlist() -> None:
    """Persist current watchlist to database."""
    with get_cursor() as cur:
        for item in _watchlist:
            cur.execute("""
                INSERT INTO watchlist
                    (id, market_id, market_title, category, exchange, added_at)
                VALUES
                    (%(id)s, %(market_id)s, %(market_title)s, %(category)s, %(exchange)s, %(added_at)s)
                ON CONFLICT (id) DO UPDATE SET
                    market_id=EXCLUDED.market_id,
                    market_title=EXCLUDED.market_title,
                    category=EXCLUDED.category,
                    exchange=EXCLUDED.exchange,
                    added_at=EXCLUDED.added_at
            """, item.model_dump(mode="json", exclude_none=True))


def _save_alerts() -> None:
    """Persist current alerts to database."""
    with get_cursor() as cur:
        for alert in _alerts:
            row = alert.model_dump(mode="json")
            # Serialize trigger sub-model to JSON text for TEXT column
            row["trigger"] = json.dumps(row["trigger"])
            # Ensure nullable columns are present as None so psycopg2 sends NULL
            row.setdefault("watchlist_item_id", None)
            row.setdefault("triggered_at", None)
            row.setdefault("dismissed_at", None)
            cur.execute("""
                INSERT INTO alerts
                    (id, watchlist_item_id, market_id, market_title, trigger,
                     triggered_at, dismissed_at, read, created_at)
                VALUES
                    (%(id)s, %(watchlist_item_id)s, %(market_id)s, %(market_title)s,
                     %(trigger)s, %(triggered_at)s, %(dismissed_at)s, %(read)s,
                     %(created_at)s)
                ON CONFLICT (id) DO UPDATE SET
                    read=EXCLUDED.read,
                    dismissed_at=EXCLUDED.dismissed_at,
                    triggered_at=EXCLUDED.triggered_at
            """, row)


# ── Watchlist API ────────────────────────────────────────────────────────

def add_to_watchlist(create: WatchlistCreate) -> WatchlistItem:
    """Add a market to the watchlist."""
    _load_from_db()

    item = WatchlistItem(
        id=str(uuid.uuid4()),
        market_id=create.market_id,
        market_title=create.market_title,
        category=create.category,
        exchange=create.exchange,
    )
    _watchlist.append(item)
    _save_watchlist()
    return item


def remove_from_watchlist(item_id: str) -> bool:
    """Remove item from watchlist (and any associated alerts)."""
    _load_from_db()

    item = next((i for i in _watchlist if i.id == item_id), None)
    if item is None:
        return False

    # Remove from DB first — _save_watchlist() only upserts, it never deletes
    with get_cursor() as cur:
        cur.execute("DELETE FROM watchlist WHERE id = %s", (item_id,))

    _watchlist.remove(item)

    # Remove associated alerts from memory and DB (CASCADE handles DB side,
    # but in-memory list needs manual cleanup)
    for alert in _alerts[:]:
        if alert.watchlist_item_id == item_id:
            _alerts.remove(alert)

    return True


def get_watchlist() -> list[WatchlistItem]:
    """Retrieve all watchlist items."""
    _load_from_db()
    return list(_watchlist)


def find_watchlist_item(market_id: str) -> Optional[WatchlistItem]:
    """Find watchlist item by market_id."""
    _load_from_db()
    return next((item for item in _watchlist if item.market_id == market_id), None)


# ── Alerts API ───────────────────────────────────────────────────────────

def create_alert(create: AlertCreate) -> Alert:
    """Create an alert for a market."""
    _load_from_db()

    watchlist_item = find_watchlist_item(create.market_id)

    alert = Alert(
        id=str(uuid.uuid4()),
        watchlist_item_id=watchlist_item.id if watchlist_item else None,
        market_id=create.market_id,
        market_title=watchlist_item.market_title if watchlist_item else "",
        trigger=create.trigger,
    )
    _alerts.append(alert)
    _save_alerts()
    return alert


def dismiss_alert(alert_id: str) -> bool:
    """Dismiss an alert (don't trigger again)."""
    _load_from_db()

    for alert in _alerts:
        if alert.id == alert_id:
            alert.dismissed_at = datetime.now(timezone.utc).isoformat()
            _save_alerts()
            return True
    return False


def mark_alert_read(alert_id: str) -> bool:
    """Mark alert as read in UI."""
    _load_from_db()

    for alert in _alerts:
        if alert.id == alert_id:
            alert.read = True
            _save_alerts()
            return True
    return False


def check_triggers(market_id: str, price: float) -> Optional[list[Alert]]:
    """
    Check all alerts for this market against current price.
    Returns alerts that triggered.
    """
    _load_from_db()

    triggered = []

    for alert in _alerts:
        if alert.market_id == market_id and not alert.dismissed_at:
            trigger = alert.trigger
            satisfied = False

            # Price threshold check
            if trigger.price_type == "entry":
                # Entry: ignore for now (user manually executes)
                continue
            elif trigger.price_type == "target":
                # Target: should be reached before stop_loss
                if trigger.direction == "above":
                    satisfied = price >= trigger.threshold
                else:
                    satisfied = price <= trigger.threshold
            elif trigger.price_type == "stop_loss":
                # Stop Loss: should be breached
                if trigger.direction == "below":
                    satisfied = price <= trigger.threshold

            if satisfied:
                alert.triggered_at = datetime.now(timezone.utc).isoformat()
                triggered.append(alert)

    if triggered:
        _save_alerts()

    return triggered


def get_alerts() -> list[dict]:
    """Get all alerts (unsorted)."""
    _load_from_db()
    # Convert to dicts for API JSON serialization
    return [alert.model_dump(mode="json", exclude_none=True) for alert in _alerts]


def get_unread_alerts() -> list[Alert]:
    """Get unread alerts (unread by read field)."""
    _load_from_db()
    return [alert for alert in _alerts if not alert.read]


