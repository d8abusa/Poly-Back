"""
Stop-loss executor — background task that monitors open positions and
closes them automatically when price breaches stop-loss or exit-target.

Runs every POLL_INTERVAL seconds. On each tick:
  1. Skip if system is halted
  2. Fetch current price for every open position from the active exchange
  3. Update current_prob in position_tracker
  4. If stop_loss breached or exit_target hit → attempt exchange close order
  5. Only close position in tracker if exchange order succeeds
  6. If exchange order fails → keep position open, fire alert
  7. Record realized PnL with risk_manager (triggers circuit breaker if needed)
"""

import asyncio
import logging
import os

from .exchange_router import get_exchange_client
from . import position_tracker as pt
from . import alert_service as alerts
from . import risk_manager as risk
from .job_registry import registry

log = logging.getLogger(__name__)

POLL_INTERVAL = int(os.getenv("STOP_LOSS_POLL_INTERVAL", "30"))  # seconds

_JOB = "stop_loss_executor"
registry.register(
    name=_JOB,
    description="Monitors open positions for stop-loss / exit-target breaches every 30s",
    category="risk",
    interval_seconds=POLL_INTERVAL,
)


async def _check_positions() -> None:
    if risk.is_halted():
        return

    open_pos = pt.get_open()

    if not open_pos:
        return

    for pos in open_pos:
        market_id = pos["market_id"]
        pos_id    = pos["id"]
        client    = get_exchange_client(pos.get("exchange", "coinbase"))

        try:
            price = await client.get_last_price(market_id)
        except Exception as exc:
            log.warning("stop-loss: price fetch failed %s: %s", market_id[:16], exc)
            continue

        if price is None:
            continue

        pt.update_prob(pos_id, price)

        stop   = pos.get("stop_loss")
        target = pos.get("exit_target")
        side   = pos.get("side", "YES")

        triggered    = False
        close_reason = None

        if stop is not None:
            if (side == "YES" and price <= stop) or (side == "NO" and price >= stop):
                triggered    = True
                close_reason = "stop_loss"

        if not triggered and target is not None:
            if (side == "YES" and price >= target) or (side == "NO" and price <= target):
                triggered    = True
                close_reason = "target_hit"

        if not triggered:
            continue

        log.warning(
            "TRIGGERED: pos=%s market=%s side=%s price=%.4f reason=%s",
            pos_id[:8], market_id[:20], side, price, close_reason,
        )

        # Attempt exchange close order
        close_side = "SELL" if side == "YES" else "BUY"
        order_ok   = False
        try:
            result   = await client.place_order(
                product_id=market_id,
                side=close_side,
                size=float(pos.get("shares", 1)),
            )
            order_ok = result.get("status") == "submitted"
        except Exception as exc:
            log.error("stop-loss: exchange order failed for %s: %s", pos_id[:8], exc)

        if order_ok:
            # Exchange confirmed — safe to close in tracker
            closed = pt.close_position(pos_id, close_reason=close_reason)
            if closed:
                realized = closed.get("realized_pnl") or 0.0
                risk.record_realized_pnl(realized)
                alerts.send_alert_dict({
                    "type":         "position_closed",
                    "position_id":  pos_id,
                    "market_id":    market_id,
                    "side":         side,
                    "close_reason": close_reason,
                    "price":        price,
                    "realized_pnl": realized,
                })
        else:
            # Exchange failed — position stays open, loud alert
            alerts.send_alert_dict({
                "type":        "stop_loss_exchange_failed",
                "position_id": pos_id,
                "market_id":   market_id,
                "side":        side,
                "close_reason": close_reason,
                "price":       price,
                "note":        "Exchange order failed — position still open. Manual intervention required.",
            })
            log.critical(
                "MANUAL INTERVENTION REQUIRED: stop-loss exchange order failed pos=%s market=%s",
                pos_id[:8], market_id[:20],
            )


async def run_stop_loss_loop() -> None:
    """Long-running background coroutine. Start via asyncio.create_task()."""
    enabled = os.getenv("STOP_LOSS_ENABLED", "true").lower() not in ("false", "0", "no")
    if not enabled:
        log.info("Stop-loss executor disabled via STOP_LOSS_ENABLED env var")
        registry.set_enabled(_JOB, False)
        return

    log.info("Stop-loss executor started (poll interval: %ds)", POLL_INTERVAL)
    while True:
        if registry.is_enabled(_JOB):
            try:
                async with registry.run_context(_JOB):
                    await _check_positions()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("stop-loss loop error: %s", exc)
        await asyncio.sleep(POLL_INTERVAL)
