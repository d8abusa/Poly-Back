"""
Feed scheduler — background task that auto-fetches enabled institutional feeds
on their configured interval.

Runs every 15 minutes. On startup, immediately fetches any feed that is overdue
(never fetched, or last_fetched + scrape_interval_hours < now).
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta

from .institutional_feed_service import get_feeds, fetch_feed

log = logging.getLogger(__name__)

POLL_INTERVAL = 15 * 60   # 15 minutes between scheduler ticks


def _is_overdue(feed: dict) -> bool:
    if not feed.get("enabled"):
        return False
    last = feed.get("last_fetched")
    if not last:
        return True   # never fetched
    if isinstance(last, str):
        last = datetime.fromisoformat(last.replace("Z", "+00:00"))
    interval = timedelta(hours=feed.get("scrape_interval_hours", 24))
    return datetime.now(timezone.utc) >= last + interval


async def _fetch_overdue() -> None:
    feeds = get_feeds()
    overdue = [f for f in feeds if _is_overdue(f)]
    if not overdue:
        return
    log.info("Feed scheduler: %d feed(s) overdue — fetching", len(overdue))
    for feed in overdue:
        try:
            result = await fetch_feed(feed["id"])
            log.info("Auto-fetched '%s': +%d docs", feed["name"], result.get("added", 0))
        except Exception as exc:
            log.warning("Auto-fetch failed for '%s': %s", feed["name"], exc)


async def run_feed_scheduler() -> None:
    # Brief startup delay — let DB pool and other services settle
    await asyncio.sleep(30)

    # Immediate pass: catch anything overdue at startup
    await _fetch_overdue()

    while True:
        await asyncio.sleep(POLL_INTERVAL)
        await _fetch_overdue()
