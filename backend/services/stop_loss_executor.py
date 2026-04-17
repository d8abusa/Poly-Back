"""
Stop-loss executor — background task that monitors open positions and
closes them automatically when price breaches stop-loss or exit-target.

Runs every POLL_INTERVAL seconds. On each tick:
  1. Skip if system is halted
  2. Fetch current price for every open position from the active exchange
  3. Update current_prob in position_tracker
  4. If stop_loss breached or exit_target hit → attempt exchange close order
  5. Only close position in tracker if exchange order succeeds
  6. If exchange order fails → keep position open, fire alert
  7. Record realized PnL with risk_manager (triggers circuit breaker if needed)
"""

import asyncio
import logging
import os

from .exchange_router import get_exchange_client
from . import position_tracker as pt
from . import alert_service as alerts
from . import risk_manager as risk
from . import compound_engine
from .job_registry import registry

log = logging.getLogger(__name__)

POLL_INTERVAL = int(os.getenv("STOP_LOSS_POLL_INTERVAL", "30"))  # seconds

_JOB = "stop_loss_executor"
registry.register(
    name=_JOB,
    description="Monitors open positions for stop-loss / exit-target breaches every 30s",
    category="risk",
    interval_seconds=POLL_INTERVAL,
)


async def _check_positions() -> None:
    if risk.is_halted():
        return

    open_pos = pt.get_open()

    if not open_pos:
        return

    for pos in open_pos:
        market_id = pos["market_id"]
        pos_id    = pos["id"]
        client    = get_exchange_client(pos.get("exchange", "coinbase"))

        try:
            price = await client.get_last_price(market_id)
        except Exception as exc:
            log.warning("stop-loss: price fetch failed %s: %s", market_id[:16], exc)
            continue

        if price is None:
            continue

        pt.update_prob(pos_id, price)

        stop   = pos.get("stop_loss")
        target = pos.get("exit_target")
        side   = pos.get("side", "YES")

        triggered    = False
        close_reason = None

        if stop is not None:
            if (side == "YES" and price <= stop) or (side == "NO" and price >= stop):
                triggered    = True
                close_reason = "stop_loss"

        if not triggered and target is not None:
            if (side == "YES" and price >= target) or (side == "NO" and price <= target):
                triggered    = True
                close_reason = "target_hit"

        if not triggered:
            continue

        log.warning(
            "TRIGGERED: pos=%s market=%s side=%s price=%.4f reason=%s",
            pos_id[:8], market_id[:20], side, price, close_reason,
        )

        # Attempt exchange close order
        close_side = "SELL" if side == "YES" else "BUY"
        order_ok   = False
        try:
            raw_shares  = float(pos.get("shares", 1))
            exchange_id = pos.get("exchange", "coinbase")

            # For Coinbase SELL, clamp sell size to the actual available balance.
            # If tracker shares is NULL/missing it defaults to 1.0 which would
            # attempt to sell a full unit — far more than the actual holding.
            # Use min(tracker_shares, actual_balance) to be safe, which handles
            # both the dust-from-fees case and the default-1.0 fallback case.
            sell_size = raw_shares
            if close_side == "SELL" and exchange_id == "coinbase":
                base_currency = market_id.split("-")[0]   # "ETH" from "ETH-USD"
                actual = await client.get_account_balance(base_currency)
                if actual is not None and actual > 0:
                    sell_size = min(raw_shares, actual)
                    log.info(
                        "stop-loss: CB balance=%.8f tracker=%.8f using=%.8f %s",
                        actual, raw_shares, sell_size, base_currency,
                    )
                else:
                    # Balance query failed — estimate from position capital/entry_price
                    # rather than raw_shares which may be a bad default (1.0).
                    capital      = pos.get("capital") or pos.get("suggested_size")
                    entry_price  = pos.get("entry_price")
                    if capital and entry_price:
                        sell_size = round(float(capital) / float(entry_price) * 0.99, 8)
                        log.warning(
                            "stop-loss: CB balance unavailable for %s — "
                            "estimating from capital=%.2f/entry=%.4f → %.8f",
                            base_currency, float(capital), float(entry_price), sell_size,
                        )
                    else:
                        log.warning(
                            "stop-loss: CB balance unavailable for %s, no capital/entry fallback, "
                            "using tracker shares %.8f",
                            base_currency, raw_shares,
                        )

            if sell_size <= 0:
                log.error(
                    "stop-loss: computed sell_size=%.8f for pos=%s — skipping order, manual close required",
                    sell_size, pos_id[:8],
                )
                alerts.send_alert_dict({
                    "type":        "stop_loss_bad_size",
                    "position_id": pos_id,
                    "market_id":   market_id,
                    "sell_size":   sell_size,
                    "note":        "sell_size <= 0 — could not compute valid order size. Manual close required.",
                })
                continue

            # Remap quote currency to match account denomination (e.g. XRP-USDC → XRP-USD)
            from ..routes.signals import _order_product_id
            close_product_id = _order_product_id(market_id) if exchange_id == "coinbase" else market_id
            result = await client.place_order(
                product_id=close_product_id,
                side=close_side,
                size=sell_size,
            )
            order_ok = result.get("status") == "submitted"
        except Exception as exc:
            log.error("stop-loss: exchange order failed for %s: %s", pos_id[:8], exc)

        if order_ok:
            # Exchange confirmed — safe to close in tracker
            closed = pt.close_position(pos_id, close_reason=close_reason)
            if closed:
                realized = closed.get("realized_pnl") or 0.0
                risk.record_realized_pnl(realized)
                alerts.send_alert_dict({
                    "type":         "position_closed",
                    "position_id":  pos_id,
                    "market_id":    market_id,
                    "side":         side,
                    "close_reason": close_reason,
                    "price":        price,
                    "realized_pnl": realized,
                })
                # Compound engine: update HWM and optionally queue retrade
                asyncio.create_task(
                    compound_engine.on_position_closed(closed, close_reason)
                )
        else:
            # Exchange failed — position stays open, loud alert
            alerts.send_alert_dict({
                "type":        "stop_loss_exchange_failed",
                "position_id": pos_id,
                "market_id":   market_id,
                "side":        side,
                "close_reason": close_reason,
                "price":       price,
                "note":        "Exchange order failed — position still open. Manual intervention required.",
            })
            log.critical(
                "MANUAL INTERVENTION REQUIRED: stop-loss exchange order failed pos=%s market=%s",
                pos_id[:8], market_id[:20],
            )


async def run_stop_loss_loop() -> None:
    """Long-running background coroutine. Start via asyncio.create_task()."""
    enabled = os.getenv("STOP_LOSS_ENABLED", "true").lower() not in ("false", "0", "no")
    if not enabled:
        log.info("Stop-loss executor disabled via STOP_LOSS_ENABLED env var")
        registry.set_enabled(_JOB, False)
        return

    log.info("Stop-loss executor started (poll interval: %ds)", POLL_INTERVAL)
    while True:
        if registry.is_enabled(_JOB):
            try:
                async with registry.run_context(_JOB):
                    await _check_positions()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("stop-loss loop error: %s", exc)
        await asyncio.sleep(POLL_INTERVAL)
