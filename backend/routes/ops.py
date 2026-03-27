"""
Ops routes — job catalog and operational controls.

GET  /api/ops/catalog              → all registered jobs + live status
POST /api/ops/{name}/toggle        → enable / disable a job
POST /api/ops/{name}/trigger       → fire a one-shot run immediately
"""

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.job_registry import registry

log    = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ops", tags=["ops"])


# ── Catalog ───────────────────────────────────────────────────────────────────

@router.get("/catalog")
async def get_catalog():
    """Return all registered jobs with their current status."""
    jobs = [j.as_dict() for j in registry.all()]
    return {
        "jobs":       jobs,
        "total":      len(jobs),
        "running":    sum(1 for j in jobs if j["status"] == "running"),
        "errors":     sum(1 for j in jobs if j["status"] == "error"),
        "disabled":   sum(1 for j in jobs if not j["enabled"]),
        "server_time": datetime.now(timezone.utc).isoformat(),
    }


# ── Toggle ────────────────────────────────────────────────────────────────────

class ToggleBody(BaseModel):
    enabled: bool

@router.post("/{name}/toggle")
async def toggle_job(name: str, body: ToggleBody):
    """Enable or disable a registered job."""
    try:
        job = registry.set_enabled(name, body.enabled)
        return {"name": name, "enabled": job.enabled, "status": job.as_dict()["status"]}
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown job: {name}")


# ── Manual trigger ────────────────────────────────────────────────────────────

# Map job names to their one-shot async callables.
# Jobs register their trigger here by importing and calling register_trigger().
_triggers: dict[str, callable] = {}

def register_trigger(name: str, fn) -> None:
    """Called by job modules to expose a one-shot trigger function."""
    _triggers[name] = fn


@router.post("/{name}/trigger")
async def trigger_job(name: str):
    """Fire a registered job once immediately, outside its normal schedule."""
    job = registry.get(name)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job: {name}")

    fn = _triggers.get(name)
    if fn is None:
        raise HTTPException(
            status_code=422,
            detail=f"Job '{name}' has no trigger registered (loop-only jobs cannot be manually fired)"
        )

    async def _run():
        async with registry.run_context(name):
            await fn()

    asyncio.create_task(_run())
    return {"name": name, "triggered": True, "note": "running in background"}
