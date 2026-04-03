"""
Background task — polls open Coinbase limit orders every 60 seconds and syncs
fill/cancel status back into PolyBack's position tracker.

Lifecycle:
  OPEN      → order not yet filled; poll again next cycle
  FILLED    → update entry_price to actual average fill price; position stays open
  CANCELLED / EXPIRED / FAILED → auto-close the position in PolyBack
"""

import asyncio
import logging

from . import position_tracker as pt
from .exchange_router import get_exchange_client

log = logging.getLogger(__name__)

POLL_INTERVAL = 60  # seconds between checks


async def run_order_monitor() -> None:
    await asyncio.sleep(20)  # let the rest of the backend fully start
    while True:
        try:
            pending = pt.get_open_limit_positions()
            if pending:
                client = get_exchange_client("coinbase")
                for pos in pending:
                    order_id = pos["coinbase_order_id"]
                    order = await client.get_order(order_id)
                    if order is None:
                        continue

                    status = (order.get("status") or "").upper()

                    if status == "FILLED":
                        raw_price = order.get("average_filled_price")
                        fill_price = float(raw_price) if raw_price else pos["entry_price"]
                        pt.update_fill_price(pos["id"], fill_price)
                        # Flip order_type to "market" so it won't be polled again
                        pos["order_type"] = "market"
                        log.info(
                            "Limit order %s FILLED at %.6f — position %s updated",
                            order_id, fill_price, pos["id"][:8],
                        )

                    elif status in ("CANCELLED", "EXPIRED", "FAILED"):
                        pt.close_position(pos["id"], close_reason=f"coinbase_{status.lower()}")
                        log.info(
                            "Limit order %s %s — position %s auto-closed",
                            order_id, status, pos["id"][:8],
                        )

        except Exception as exc:
            log.error("Coinbase order monitor error: %s", exc)

        await asyncio.sleep(POLL_INTERVAL)
