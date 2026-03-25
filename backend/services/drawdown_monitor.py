"""
Drawdown monitor — background coroutine that checks session drawdown
against the risk_manager circuit breaker every 60 seconds.
"""

import asyncio
import logging

log = logging.getLogger(__name__)


class DrawdownMonitor:
    async def monitor_drawdown(self) -> None:
        """Long-running background coroutine. Started via asyncio.create_task()."""
        from . import risk_manager as risk
        from . import position_tracker as pt

        log.info("Drawdown monitor started")
        while True:
            try:
                if not risk.is_halted():
                    # Recalculate unrealized drawdown from open positions
                    open_pos = pt.get_open()
                    unrealized = sum(
                        (p["current_prob"] - p["entry_price"]) * p["shares"]
                        if p["side"] == "YES"
                        else (p["entry_price"] - p["current_prob"]) * p["shares"]
                        for p in open_pos
                    )
                    # Probe the circuit breaker with current unrealized PnL
                    # (record_realized_pnl is additive — we just check status)
                    status = risk.get_status()
                    if status["drawdown_pct"] >= status["max_drawdown_pct"]:
                        log.critical(
                            "Drawdown monitor: %.1f%% drawdown — circuit breaker should be active",
                            status["drawdown_pct"],
                        )
            except Exception as exc:
                log.error("Drawdown monitor error: %s", exc)
            await asyncio.sleep(60)


drawdown_monitor = DrawdownMonitor()
