"""
Alert monitor background task.

Checks watchlist items for trigger conditions against price updates.
"""

import asyncio
import logging
from typing import Optional

from ..services.watchlist_service import check_triggers, get_watchlist
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

        watchlist = get_watchlist()

        for item in watchlist:
            try:
                exchange = getattr(item, "exchange", None) or "polymarket"
                client = get_exchange_client(exchange)
                if not client:
                    log.debug("Alert monitor: no client for exchange %s", exchange)
                    continue

                snapshot = await client.get_market_snapshot(item.market_id, token_id=None)
                raw_price = snapshot.get("last_price") if snapshot else None
                if raw_price is None:
                    continue

                price = float(raw_price)
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
                # Downgrade 404s to debug — stale/expired markets are expected
                msg = str(exc)
                if "404" in msg or "Not Found" in msg:
                    log.debug("Alert monitor: market not found (expired?) %s — remove from watchlist", item.market_id)
                else:
                    log.warning("Failed to check alerts for market %s: %s", item.market_id, exc)

    except Exception:
        log.exception("Alert monitor check failed")


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
            except Exception:
                log.exception("Alert monitor error")
        await asyncio.sleep(10)