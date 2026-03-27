"""
Job registry — central catalog of all background tasks.

Every long-running loop or scheduled job registers itself here on startup.
The ops router exposes this catalog over the API so the frontend can display
live status, trigger jobs manually, and toggle them on/off.

Usage
-----
    from .job_registry import registry

    # At module level or in startup:
    registry.register(
        name="my_job",
        description="Does something useful",
        category="data",
        interval_seconds=60,
    )

    # Inside the loop body:
    async def my_loop():
        while True:
            async with registry.run_context("my_job"):
                await do_work()
            await asyncio.sleep(60)

    # Or manually:
    registry.record_run("my_job", "ok")
    registry.record_run("my_job", "error", "connection refused")
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

log = logging.getLogger(__name__)


# ── Job entry ─────────────────────────────────────────────────────────────────

@dataclass
class JobEntry:
    name:             str
    description:      str
    category:         str         # "risk" | "data" | "signal" | "alert" | "monitor"
    interval_seconds: int         # nominal cadence (informational)
    enabled:          bool = True

    # Live state
    status:      str = "idle"     # "idle" | "running" | "ok" | "error" | "disabled"
    last_run:    Optional[datetime] = None
    last_error:  Optional[str]      = None
    run_count:   int = 0
    error_count: int = 0

    # Asyncio task reference (set by registry.attach_task)
    task: Optional[asyncio.Task] = field(default=None, repr=False)

    def as_dict(self) -> dict:
        return {
            "name":             self.name,
            "description":      self.description,
            "category":         self.category,
            "interval_seconds": self.interval_seconds,
            "enabled":          self.enabled,
            "status":           self.status if self.enabled else "disabled",
            "last_run":         self.last_run.isoformat() if self.last_run else None,
            "last_error":       self.last_error,
            "run_count":        self.run_count,
            "error_count":      self.error_count,
            "task_alive":       self.task is not None and not self.task.done(),
        }


# ── Registry ──────────────────────────────────────────────────────────────────

class JobRegistry:
    def __init__(self):
        self._jobs: dict[str, JobEntry] = {}

    def register(
        self,
        name: str,
        description: str,
        category: str,
        interval_seconds: int,
        enabled: bool = True,
    ) -> JobEntry:
        """Register a job. Safe to call multiple times (idempotent)."""
        if name not in self._jobs:
            entry = JobEntry(
                name=name,
                description=description,
                category=category,
                interval_seconds=interval_seconds,
                enabled=enabled,
            )
            self._jobs[name] = entry
            log.debug("JobRegistry: registered '%s'", name)
        return self._jobs[name]

    def attach_task(self, name: str, task: asyncio.Task) -> None:
        """Attach a running asyncio.Task to a job entry."""
        if name in self._jobs:
            self._jobs[name].task = task

    def record_run(self, name: str, status: str, error: Optional[str] = None) -> None:
        """Called by each job iteration to update status counters."""
        if name not in self._jobs:
            return
        job = self._jobs[name]
        job.last_run    = datetime.now(timezone.utc)
        job.status      = status
        job.run_count  += 1
        if status == "error":
            job.error_count += 1
            job.last_error   = error
        else:
            job.last_error = None

    @asynccontextmanager
    async def run_context(self, name: str):
        """
        Async context manager that automatically records run status.

            async with registry.run_context("my_job"):
                await do_work()   # status → "ok" on exit, "error" on exception
        """
        if name in self._jobs:
            self._jobs[name].status = "running"
        try:
            yield
            self.record_run(name, "ok")
        except asyncio.CancelledError:
            if name in self._jobs:
                self._jobs[name].status = "idle"
            raise
        except Exception as exc:
            self.record_run(name, "error", str(exc))
            raise

    def set_enabled(self, name: str, enabled: bool) -> JobEntry:
        if name not in self._jobs:
            raise KeyError(f"Unknown job: {name}")
        self._jobs[name].enabled = enabled
        if not enabled:
            self._jobs[name].status = "disabled"
        return self._jobs[name]

    def get(self, name: str) -> Optional[JobEntry]:
        return self._jobs.get(name)

    def all(self) -> list[JobEntry]:
        return sorted(self._jobs.values(), key=lambda j: (j.category, j.name))

    def is_enabled(self, name: str) -> bool:
        job = self._jobs.get(name)
        return job.enabled if job else False


# ── Singleton ─────────────────────────────────────────────────────────────────

registry = JobRegistry()
