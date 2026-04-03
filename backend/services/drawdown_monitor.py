"""
Drawdown monitor — background coroutine that checks session drawdown
against the risk_manager circuit breaker every 60 seconds.
"""

import asyncio
import logging

from .job_registry import registry

log = logging.getLogger(__name__)

_JOB = "drawdown_monitor"


def _register():
    """Register the monitor job with the central queue."""
    registry.register(
        name=_JOB,
        description="Checks session drawdown against circuit-breaker threshold every 60s",
        category="risk",
        interval_seconds=60,
    )


_register()


class DrawdownMonitor:
    async def monitor_drawdown(self) -> None:
        """Long‑running coroutine started via `asyncio.create_task(drawdown_monitor.monitor_drawdown())`."""
        from . import risk_manager as risk
        from . import position_tracker as pt

        log.info("Drawdown monitor started")
        try:
            while True:
                async with registry.run_context(_JOB):
                    if not risk.is_halted():
                        # Pull current status for metrics (log only, we rely on the
                        # circuit‑breaker logic inside risk_manager.record_realized_pnl)
                        status = risk.get_status()
                        # Current open positions for optional detailed logging
                        open_positions = pt.get_open()
                        # Compute a quick drawdown amount (in USD) for human‑readable log
                        total = sum(
                            (p["current_prob"] - p["entry_price"]) * p["shares"]
                            if p["side"] == "YES"
                            else (p["entry_price"] - p["current_prob"]) * p["shares"]
                            for p in open_positions
                        )
                        if status["drawdown_pct"] >= status["max_drawdown_pct"]:
                            log.critical(
                                "Drawdown monitor: %.1f%% drawdown (exceeds %.1f%% limit). "
                                "Open positions: %d | unrealized %.2f USD",
                                status["drawdown_pct"],
                                status["max_drawdown_pct"],
                                len(open_positions),
                                total,
                            )
                            # Trigger immediate risk manager halt (in case other components missed it)
                            risk.record_realized_pnl(0.0)  # No PnL change; just record the event
                await asyncio.sleep(60)
        except asyncio.CancelledError:
            log.info("Drawdown monitor cancelled – exiting gracefully.")
            raise
        except Exception as exc:
            log.exception("Drawdown monitor encountered an error: %s", exc)
            raise


drawdown_monitor = DrawdownMonitor()
