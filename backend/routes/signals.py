import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Body

from ..models.schemas import SignalApproveRequest, SignalModifyRequest, SignalSchema, StageFromBacktestRequest, ExecutionMode
from ..services import signal_queue as sq
from ..services import alert_service as alerts
from ..services import position_tracker as pt
from ..services.exchange_router import get_exchange_client
from ..services.crypto_scanner import _pending_for as _crypto_pending
from ..services import telegram_service
from ..services.fraser_modifier import apply_fraser_modifier

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/signals", tags=["signals"])

# Coinbase spot product suffixes — used to route signals to Coinbase
_COINBASE_SUFFIXES = ("-USD", "-USDC", "-USDT", "-EUR", "-GBP")

# Quote currencies that can be substituted 1:1 (USD ↔ USDC)
_STABLE_SUBSTITUTES = {"USD": "USDC", "USDC": "USD"}


def _is_coinbase_signal(market_id: str) -> bool:
    return any(market_id.upper().endswith(s) for s in _COINBASE_SUFFIXES)


def _order_product_id(market_id: str) -> str:
    """Remap the product_id quote currency to match COINBASE_QUOTE_CURRENCY env var.

    Example: ETH-USD → ETH-USDC when COINBASE_QUOTE_CURRENCY=USDC
    Falls back to the original market_id if no substitution applies.
    """
    preferred = os.getenv("COINBASE_QUOTE_CURRENCY", "USD").upper()
    parts = market_id.upper().rsplit("-", 1)
    if len(parts) == 2:
        base, quote = parts
        if quote in _STABLE_SUBSTITUTES and preferred != quote:
            return f"{base}-{preferred}"
    return market_id


def _infer_exchange(market_id: str) -> str:
    if _is_coinbase_signal(market_id):
        return "coinbase"
    return "kalshi"  # default for prediction markets


def _is_kalshi_signal(sig) -> bool:
    """True when the signal should execute on Kalshi."""
    return (sig.exchange == "kalshi") or (
        sig.exchange in ("polymarket", "")
        and not _is_coinbase_signal(sig.market_id)
    )


def _asset_type(exchange: str) -> str:
    if exchange == "yahoo":
        return "stock"
    if exchange == "coinbase":
        return "crypto"
    return "prediction_market"


def _derive_crypto_target(req: StageFromBacktestRequest, live_price: float) -> float:
    """For crypto signals: exit_threshold is treated as a % gain (e.g. 0.05 = 5% above entry)."""
    if req.exit_threshold is not None and req.exit_threshold > 1.0:
        # User passed a dollar target (e.g. 2080.0) — use directly
        return round(req.exit_threshold, 2)
    if req.exit_threshold is not None:
        # Fractional: treat as % gain
        return round(live_price * (1.0 + req.exit_threshold), 2)
    # Fallback: 5% above live price
    return round(live_price * 1.05, 2)


def _derive_target(req: StageFromBacktestRequest) -> float:
    """Estimate a forward price target from the backtest params."""
    if req.exit_threshold is not None:
        if req.exchange == "yahoo":
            # exit_threshold is a % gain (e.g. 0.10 = 10% above entry)
            return round(req.last_price * (1.0 + req.exit_threshold), 4)
        # prediction market: exit_threshold is the target probability
        return req.exit_threshold
    # Fallback: project the average per-trade return
    avg_trade = req.total_return / max(req.total_trades, 1) / 100.0
    return round(req.last_price * (1.0 + avg_trade), 4)


def _derive_confidence(win_rate: float, sharpe: float) -> float:
    """Blend win-rate and Sharpe into a 0–1 confidence score."""
    sharpe_norm = min(sharpe / 3.0, 1.0)          # 3.0 Sharpe → full marks
    raw = win_rate * 0.6 + sharpe_norm * 0.4
    return round(min(max(raw, 0.05), 0.95), 3)


@router.post("/from-backtest", response_model=dict)
async def stage_from_backtest(req: StageFromBacktestRequest):
    """Create a signal directly from a completed backtest result."""

    # For crypto exchanges, the backtest engine clamps prices to [0,1] (probability scale).
    # Override with the live market price so the signal has valid dollar values.
    if _is_coinbase_signal(req.market_id):
        client = get_exchange_client("coinbase")
        live_price = await client.get_last_price(_order_product_id(req.market_id))
        if live_price is None or live_price <= 0.0:
            raise HTTPException(
                status_code=502,
                detail=f"Could not fetch live price for {req.market_id} — cannot stage crypto signal",
            )
        entry = live_price
    else:
        entry = req.last_price

    target  = _derive_target(req) if not _is_coinbase_signal(req.market_id) else _derive_crypto_target(req, entry)
    shares  = req.capital / entry
    edge    = (target - entry) / entry
    conf    = _derive_confidence(req.win_rate, req.sharpe_ratio)

    # Apply FRASER macro modifier (prediction markets only; no-op for crypto/stocks)
    adj_size, adj_conf, fraser_ctx = apply_fraser_modifier(
        float(req.capital), conf, req.exchange
    )

    reasoning = (
        f"Staged from {req.strategy} backtest on {req.market_title}. "
        f"Return {req.total_return:+.1f}% · Sharpe {req.sharpe_ratio:.2f} · "
        f"Win rate {req.win_rate*100:.0f}% over {req.total_trades} trades. "
        f"Capital ${req.capital:,.0f} → {shares:.6f} units @ ${entry:,.2f}."
    )
    if fraser_ctx is not None:
        reasoning += f" [{fraser_ctx.summary}]"

    sig = SignalSchema(
        market_id       = req.market_id,
        strategy        = req.strategy,
        side            = "BUY",
        entry_price     = round(entry, 4),
        target_price    = target,
        stop_loss       = req.stop_loss,
        suggested_size  = int(adj_size),
        suggested_shares= round(adj_size / entry, 6),
        expected_edge   = round(edge, 4),
        maker_edge      = 0.0,
        delta_taker     = 0.0,
        confidence      = adj_conf,
        reasoning       = reasoning,
        execution_mode  = req.execution_mode,
        exchange        = req.exchange,
        asset_type      = _asset_type(req.exchange),
    )

    # Auto mode: mark as auto_executed immediately (no human review step)
    if req.execution_mode == ExecutionMode.auto:
        sig.status = "auto_executed"

    added = sq.add_signal(sig)
    log.info(
        "Staged signal from backtest: %s %s %.4f  size=$%d  mode=%s",
        req.strategy, req.market_id, entry, int(req.capital), req.execution_mode,
    )

    # Auto-notify Telegram for stock signals (no execution venue yet)
    if req.exchange == "yahoo":
        import asyncio as _asyncio
        _asyncio.create_task(
            telegram_service.send_signal(sig, note="Stock signal — review and trade manually")
        )

    return {"status": "staged", "signal": added}


@router.get("")
async def list_signals(status: Optional[str] = None):
    """List signals filtered by status. Valid values: pending | approved | rejected"""
    if status == "pending":
        return {"signals": sq.get_pending()}
    if status in ("approved", "executed"):
        return {"signals": sq.get_executed()}
    if status == "rejected":
        return {"signals": sq.get_rejected()}
    return {
        "signals": {
            "pending": sq.get_pending(),
            "approved": sq.get_executed(),
            "rejected": sq.get_rejected(),
        }
    }


@router.get("/alerts")
async def get_alerts():
    """Get all in-app alerts generated by ALERT ONLY mode."""
    return {"alerts": alerts.get_alerts()}


@router.post("/alerts/{alert_id}/read")
async def mark_alert_read(alert_id: str):
    ok = alerts.mark_read(alert_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"status": "ok"}


@router.post("/{signal_id}/approve")
async def approve_signal(
    signal_id: str,
    body: SignalApproveRequest = Body(default=SignalApproveRequest()),
):
    # Peek at the signal before committing approval
    sig = sq.get_signal(signal_id)
    if sig is None or sig.status != "pending":
        raise HTTPException(status_code=404, detail="Signal not found or not pending")

    # ── Coinbase crypto signal → place real order FIRST, then commit ────────
    if _is_coinbase_signal(sig.market_id):
        client = get_exchange_client("coinbase")
        if client is None:
            raise HTTPException(status_code=503, detail="Coinbase client not configured")

        size_usd   = float(body.modified_size or sig.suggested_size)
        shares     = size_usd / sig.entry_price  # fractional crypto
        product_id = _order_product_id(sig.market_id)  # e.g. ETH-USD → ETH-USDC

        is_market_buy = sig.side == "BUY" and sig.execution_mode.value != "confirm"
        try:
            order = await client.place_order(
                product_id=product_id,
                side=sig.side,
                size=shares,
                limit_price=sig.entry_price if sig.execution_mode.value == "confirm" else None,
                # Market BUY: use quote_size (USD) — avoids base_size precision issues
                quote_size=size_usd if is_market_buy else None,
            )
        except Exception as exc:
            log.error("Coinbase order failed for signal %s: %s", signal_id, exc)
            raise HTTPException(status_code=502, detail=f"Coinbase order failed: {exc}")

        if order.get("status") != "submitted":
            log.error("Coinbase order rejected for signal %s: %s", signal_id, order.get("note"))
            raise HTTPException(
                status_code=502,
                detail=f"Coinbase order rejected: {order.get('note', 'unknown error')}",
            )

        # Order confirmed — now commit the approval
        sig = sq.approve_signal(signal_id, modified_size=body.modified_size)

        # Clear crypto scanner pending flag so it can signal again
        _crypto_pending.discard(sig.market_id)

        # Record as a position in tracker (adapts to crypto scale)
        _order_type = "limit" if sig.execution_mode.value == "confirm" else "market"
        pos = pt.open_position(
            sig,
            exchange="coinbase",
            coinbase_order_id=order.get("order_id"),
            order_type=_order_type,
        )
        log.info(
            "Coinbase order placed: %s (signal: %s) %s %.8f @ %.4f  order_id=%s  pos=%s",
            product_id, sig.market_id, sig.side, shares, sig.entry_price,
            order.get("order_id", "?"), pos["id"],
        )
        return {
            "status":     "approved",
            "exchange":   "coinbase",
            "signal":     sig,
            "position_id": pos["id"],
            "order":      order,
            "shares":     round(shares, 8),
            "size_usd":   size_usd,
        }

    # ── Kalshi prediction market signal → place real order ────────────────
    if _is_kalshi_signal(sig):
        client = get_exchange_client("kalshi")

        size_usd  = float(body.modified_size or sig.suggested_size)
        # Probability → cents (1–99); contracts = USD / cost-per-contract
        yes_price = max(1, min(99, int(round(sig.entry_price * 100))))
        count     = max(1, int(size_usd / sig.entry_price))
        action    = "buy" if sig.side.upper() == "BUY" else "sell"
        # Signals always trade YES side (long bias on prediction markets)
        kal_side  = "yes"

        try:
            order = await client.place_order(
                ticker=sig.market_id,
                side=kal_side,
                action=action,
                count=count,
                yes_price=yes_price,
                order_type="limit",
            )
        except Exception as exc:
            log.error("Kalshi order failed for signal %s: %s", signal_id, exc)
            raise HTTPException(status_code=502, detail=f"Kalshi order failed: {exc}")

        if order.get("status") != "submitted":
            log.error("Kalshi order rejected for signal %s: %s", signal_id, order.get("note"))
            raise HTTPException(
                status_code=502,
                detail=f"Kalshi order rejected: {order.get('note', 'unknown error')}",
            )

        sig = sq.approve_signal(signal_id, modified_size=body.modified_size)
        pos = pt.open_position(sig, exchange="kalshi")
        log.info(
            "Kalshi order placed: %s %s %s %dct @ %d¢  order_id=%s  pos=%s",
            sig.market_id, action, kal_side, count, yes_price,
            order.get("order_id", "?"), pos["id"],
        )
        return {
            "status":      "approved",
            "exchange":    "kalshi",
            "signal":      sig,
            "position_id": pos["id"],
            "order":       order,
            "contracts":   count,
            "yes_price":   yes_price,
        }

    # ── Generic fallthrough (manifold / unknown) ───────────────────────────
    sig = sq.approve_signal(signal_id, modified_size=body.modified_size)
    pos = pt.open_position(sig, exchange=_infer_exchange(sig.market_id))
    log.info("Approved signal %s  size=%d  position=%s", signal_id, sig.suggested_size, pos["id"])
    return {"status": "approved", "signal": sig, "position_id": pos["id"]}


@router.post("/{signal_id}/notify")
async def notify_signal(signal_id: str):
    """Send a signal to Telegram manually (works for any status)."""
    sig = sq.get_signal(signal_id)
    if sig is None:
        raise HTTPException(status_code=404, detail="Signal not found")
    sent = await telegram_service.send_signal(sig)
    if not sent:
        raise HTTPException(status_code=503, detail="Telegram not configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env")
    log.info("Sent Telegram notification for signal %s", signal_id)
    return {"status": "sent"}


@router.post("/{signal_id}/reject")
async def reject_signal(signal_id: str):
    sig = sq.reject_signal(signal_id)
    if sig is None:
        raise HTTPException(status_code=404, detail="Signal not found or not pending")
    log.info("Rejected signal %s", signal_id)
    return {"status": "rejected", "signal": sig}


@router.post("/{signal_id}/modify")
async def modify_signal(signal_id: str, body: SignalModifyRequest):
    sig = sq.modify_signal(signal_id, size=body.size, price=body.price)
    if sig is None:
        raise HTTPException(status_code=404, detail="Signal not found or not pending")
    log.info("Modified signal %s  size=%d", signal_id, body.size)
    return {"status": "modified", "signal": sig}
