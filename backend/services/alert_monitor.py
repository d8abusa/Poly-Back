"""
Alert monitor background task.

Checks watchlist items for trigger conditions against price updates.
"""

import asyncio
import logging
from typing import Optional

from ..services.watchlist_service import check_triggers
from .job_registry import registry

log = logging.getLogger(__name__)

_JOB = "alert_monitor"
registry.register(
    name=_JOB,
    description="Polls watchlist markets for price-trigger alerts every 10s",
    category="alert",
    interval_seconds=10,
)


async def check_watchlist_alerts() -> None:
    """Check all watchlist items for trigger conditions against current prices."""
    try:
        from ..services.exchange_router import get_exchange_client

        client = get_exchange_client("polymarket")
        if not client:
            log.warning("Alert monitor: No exchange client available")
            return

        # Poll all watched markets for price updates
        # In production, we would:
        # 1. Fetch watchlist
        # 2. For each market, get current price from feed
        # 3. Check_triggers(current_price, market_id)
        watchlist = get_watchlist()

        for item in watchlist:
            try:
                # Fetch current price from exchange
                snapshot = await client.get_market_snapshot(item.market_id, token_id=None)
                if snapshot and "last_price" in snapshot:
                    price = float(snapshot["last_price"])
                    triggered = check_triggers(item.market_id, price)

                    if triggered:
                        for alert in triggered:
                            log.info(
                                "Alert triggered: %s %s @ %.4f (trigger: %s %.4f)",
                                alert.market_id, alert.trigger.price_type,
                                price, alert.trigger.direction,
                                alert.trigger.threshold
                            )
            except Exception as exc:
                log.warning("Failed to check alerts for market %s: %s", item.market_id, exc)

    except Exception as exc:
        log.error("Alert monitor check failed: %s", exc)


async def run_alert_monitor() -> None:
    """
    Main alert monitoring loop.
    Polls every 10 seconds and checks for watchlist triggers.
    """
    log.info("Alert monitor started")
    await asyncio.sleep(5)  # Initial delay

    while True:
        if registry.is_enabled(_JOB):
            try:
                async with registry.run_context(_JOB):
                    await check_watchlist_alerts()
            except asyncio.CancelledError:
                log.info("Alert monitor shutting down")
                raise
            except Exception as exc:
                log.error("Alert monitor error: %s", exc)
        await asyncio.sleep(10)