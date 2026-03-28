"""
In-app alert store for ALERT ONLY execution mode.

Structured for future email/webhook extension — add dispatchers
in send_alert() once external integrations are configured.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from ..models.schemas import SignalSchema

log = logging.getLogger(__name__)

_alerts: list[dict] = []


def send_alert(signal: SignalSchema, error: Optional[str] = None) -> dict:
    alert = {
        "id": str(uuid.uuid4()),
        "signal_id": signal.id,
        "market_id": signal.market_id,
        "strategy": signal.strategy,
        "side": signal.side,
        "entry_price": signal.entry_price,
        "suggested_size": signal.suggested_size,
        "confidence": signal.confidence,
        "reasoning": signal.reasoning,
        "error": error,
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _alerts.append(alert)

    # Fire-and-forget Telegram notification
    try:
        from .telegram_service import send_signal
        asyncio.get_event_loop().create_task(
            send_signal(signal, note="Alert-only mode — no order placed")
        )
    except Exception as exc:
        log.debug("Telegram task skipped: %s", exc)

    return alert


def send_alert_dict(data: dict) -> dict:
    """Send a free-form alert (used by stop-loss executor and other system events)."""
    alert = {
        "id":         str(uuid.uuid4()),
        "read":       False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **data,
    }
    _alerts.append(alert)
    return alert


def get_alerts() -> list[dict]:
    return list(reversed(_alerts))


def mark_read(alert_id: str) -> bool:
    for alert in _alerts:
        if alert["id"] == alert_id:
            alert["read"] = True
            return True
    return False
