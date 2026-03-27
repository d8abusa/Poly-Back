"""
FRED auto-refresh scheduler — background job that refreshes stale series
on a weekly cadence without burning the API budget unnecessarily.

Logic:
  - Runs every 6 hours
  - Checks _is_stale() for each tracked series
  - Pulls stale series (respects the per-series _REFRESH_DAYS window)
  - Skips if pull budget is >= 90 (leaves headroom for manual calls)
"""

import asyncio
import logging

from .job_registry import registry
from .fred_service import SERIES_META, get_series, get_pull_count

# Register one-shot trigger (exposed via ops router)
async def _trigger_once() -> None:
    """Force-refresh all stale FRED series immediately."""
    budget = get_pull_count()
    if budget >= 90:
        raise RuntimeError(f"Pull budget at {budget}/100 — manual refresh blocked")
    for sid in SERIES_META:
        await get_series(sid)

log = logging.getLogger(__name__)

_JOB      = "fred_auto_refresh"
_INTERVAL = 6 * 60 * 60   # 6 hours

registry.register(
    name=_JOB,
    description="Auto-refreshes stale FRED series every 6h (respects per-series schedule)",
    category="data",
    interval_seconds=_INTERVAL,
)


async def run_fred_scheduler() -> None:
    """Long-running background coroutine. Start via asyncio.create_task()."""
    log.info("FRED scheduler started (interval: 6h)")
    await asyncio.sleep(30)   # Let other startup tasks settle first

    while True:
        if registry.is_enabled(_JOB):
            try:
                async with registry.run_context(_JOB):
                    budget = get_pull_count()
                    if budget >= 90:
                        log.warning("FRED scheduler: pull budget at %d/100 — skipping auto-refresh", budget)
                    else:
                        refreshed = []
                        for sid in SERIES_META:
                            try:
                                result = await get_series(sid)  # cache-first, pulls only if stale
                                if not result["from_cache"]:
                                    refreshed.append(sid)
                            except Exception as exc:
                                log.warning("FRED scheduler: failed to refresh %s: %s", sid, exc)
                        if refreshed:
                            log.info("FRED scheduler: refreshed %s", refreshed)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("FRED scheduler error: %s", exc)
        await asyncio.sleep(_INTERVAL)
