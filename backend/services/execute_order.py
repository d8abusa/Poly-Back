"""
Polymarket CLOB execution wrapper.

Dispatches signals according to execution_mode:
  auto        → submit order immediately (stub until API key configured)
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

    # AUTO — execute immediately
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
        # TODO: wire to CLOB DELETE /order/{order_id}
        return {"status": "cancelled", "order_id": order_id}
    except Exception as exc:
        log.error("Cancel failed for %s: %s", order_id, exc)
        return {"status": "error", "order_id": order_id, "error": str(exc)}


async def _submit_to_clob(signal: SignalSchema) -> dict:
    """
    Stub — real implementation requires Polymarket CLOB API key + L1/L2 auth.
    Docs: https://docs.polymarket.com/#place-order
    Add API key to polymarket_client.py and replace this stub.
    """
    log.warning(
        "_submit_to_clob: stub — CLOB auth not configured (signal=%s)", signal.id[:8]
    )
    return {
        "order_id": f"stub_{signal.id[:8]}",
        "status": "stub",
        "note": "Real CLOB auth not yet configured — add API key to enable live trading",
    }
