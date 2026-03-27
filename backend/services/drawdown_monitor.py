"""
Drawdown monitor — background coroutine that checks session drawdown
against the risk_manager circuit breaker every 60 seconds.
"""

import asyncio
import logging

from .job_registry import registry

log = logging.getLogger(__name__)

_JOB = "drawdown_monitor"

registry.register(
    name=_JOB,
    description="Checks session drawdown against circuit-breaker threshold every 60s",
    category="risk",
    interval_seconds=60,
)


class DrawdownMonitor:
    async def monitor_drawdown(self) -> None:
        """Long-running background coroutine. Started via asyncio.create_task()."""
        from . import risk_manager as risk
        from . import position_tracker as pt

        log.info("Drawdown monitor started")
        while True:
            try:
                async with registry.run_context(_JOB):
                    if not risk.is_halted():
                        open_pos = pt.get_open()
                        unrealized = sum(
                            (p["current_prob"] - p["entry_price"]) * p["shares"]
                            if p["side"] == "YES"
                            else (p["entry_price"] - p["current_prob"]) * p["shares"]
                            for p in open_pos
                        )
                        status = risk.get_status()
                        if status["drawdown_pct"] >= status["max_drawdown_pct"]:
                            log.critical(
                                "Drawdown monitor: %.1f%% drawdown — circuit breaker should be active",
                                status["drawdown_pct"],
                            )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("Drawdown monitor error: %s", exc)
            await asyncio.sleep(60)


drawdown_monitor = DrawdownMonitor()
