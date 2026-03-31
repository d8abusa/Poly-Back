"""
Exchange order execution wrapper.

Dispatches signals according to execution_mode:
  auto        → submit order immediately via active exchange (Coinbase)
  confirm     → enqueue in signal_queue for user approval
  alert_only  → log to alert_service, no order placed

Every attempt is logged; failures alert and never crash the caller.
"""

import logging
from datetime import datetime, timezone

from ..models.schemas import SignalSchema
from . import signal_queue as sq
from . import alert_service as alerts
from . import position_tracker as pt
from . import risk_manager as risk

log = logging.getLogger(__name__)


async def execute_order(signal: SignalSchema) -> dict:
    mode = signal.execution_mode

    if mode == "alert_only":
        alert = alerts.send_alert(signal)
        log.info(
            "ALERT: %s %s @ %.3f  market=%s",
            signal.side, signal.strategy, signal.entry_price, signal.market_id[:16],
        )
        return {"status": "alerted", "signal_id": signal.id, "alert_id": alert["id"]}

    if mode == "confirm":
        queued = sq.add_signal(signal)
        log.info(
            "QUEUED for confirmation: %s %s  id=%s",
            signal.side, signal.strategy, queued.id,
        )
        return {"status": "pending", "signal_id": queued.id}

    # AUTO — check risk limits before submitting
    allowed, reason = risk.check_new_order(float(signal.suggested_size))
    if not allowed:
        log.warning("RISK BLOCKED order for signal %s: %s", signal.id[:8], reason)
        alerts.send_alert(signal, error=f"RISK BLOCK: {reason}")
        return {"status": "risk_blocked", "signal_id": signal.id, "reason": reason}

    try:
        result = await _submit_to_clob(signal)
        signal.status = "auto_executed"
        signal.resolved_at = datetime.now(timezone.utc).isoformat()
        pos = pt.open_position(signal)
        log.info(
            "AUTO executed: %s %s  size=%d  clob_status=%s  position=%s",
            signal.side, signal.strategy, signal.suggested_size, result.get("status"), pos["id"],
        )
        return {"status": "auto_executed", "signal_id": signal.id, "clob_result": result, "position_id": pos["id"]}
    except Exception as exc:
        log.error("AUTO execution failed for signal %s: %s", signal.id, exc)
        alerts.send_alert(signal, error=str(exc))
        return {"status": "error", "signal_id": signal.id, "error": str(exc)}


async def cancel_order(order_id: str) -> dict:
    try:
        log.info("Cancelling order %s", order_id)
        from .exchange_router import get_exchange_client
        client = get_exchange_client()
        return await client.cancel_order(order_id)
    except Exception as exc:
        log.error("Cancel failed for %s: %s", order_id, exc)
        return {"status": "error", "order_id": order_id, "error": str(exc)}


async def _submit_to_clob(signal: SignalSchema) -> dict:
    """Submit order via the correct exchange for this signal."""
    from .exchange_router import get_exchange_client

    exchange = getattr(signal, "exchange", None) or "kalshi"

    if exchange == "kalshi":
        client = get_exchange_client("kalshi")
        yes_price = max(1, min(99, int(round(signal.entry_price * 100))))
        count     = max(1, int(float(signal.suggested_size) / signal.entry_price))
        action    = "buy" if signal.side.upper() == "BUY" else "sell"
        return await client.place_order(
            ticker=signal.market_id,
            side="yes",
            action=action,
            count=count,
            yes_price=yes_price,
            order_type="limit",
        )

    # Coinbase / Robinhood / Yahoo — standard product_id / size interface
    client = get_exchange_client(exchange)
    return await client.place_order(
        product_id=signal.market_id,
        side=signal.side.upper(),
        size=float(signal.suggested_size),
        limit_price=signal.entry_price if signal.entry_price else None,
    )
