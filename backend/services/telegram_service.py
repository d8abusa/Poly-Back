"""
Telegram alert service — sends trading signals via a Telegram bot.

Required env vars (leave blank to disable silently):
    TELEGRAM_BOT_TOKEN  — from @BotFather
    TELEGRAM_CHAT_ID    — your personal chat ID or a group/channel ID

Usage:
    await telegram_service.send_signal(signal)
    await telegram_service.send_message("plain text")
"""

import logging
import os
from typing import Optional

import httpx

from ..models.schemas import SignalSchema

log = logging.getLogger(__name__)

_TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"


def _is_configured() -> tuple[str, str] | tuple[None, None]:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat  = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    if token and chat:
        return token, chat
    return None, None


async def send_message(text: str, parse_mode: str = "HTML") -> bool:
    """Send a raw text message. Returns True on success, False if not configured or failed."""
    token, chat_id = _is_configured()
    if not token:
        return False
    url = _TELEGRAM_API.format(token=token)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json={
                "chat_id":    chat_id,
                "text":       text,
                "parse_mode": parse_mode,
            })
            resp.raise_for_status()
            return True
    except Exception as exc:
        log.warning("Telegram send failed: %s", exc)
        return False


async def send_signal(signal: SignalSchema, note: Optional[str] = None) -> bool:
    """Format a SignalSchema as a Telegram message and send it."""
    token, _ = _is_configured()
    if not token:
        return False

    exchange = (signal.exchange or "unknown").upper()
    asset    = signal.asset_type or "unknown"

    # Price formatting — crypto/stocks use dollar amounts, prediction markets use cents
    def _fmt(price: Optional[float]) -> str:
        if price is None:
            return "—"
        if asset in ("crypto", "stock"):
            return f"${price:,.2f}"
        return f"{price * 100:.0f}¢"

    stop_str   = _fmt(signal.stop_loss) if signal.stop_loss else "—"
    edge_str   = f"{signal.expected_edge * 100:+.2f}%"
    conf_str   = f"{signal.confidence * 100:.0f}%"
    size_str   = f"${signal.suggested_size:,}"
    shares_str = f"{signal.suggested_shares:.6f}" if asset == "crypto" else str(signal.suggested_shares)

    lines = [
        f"<b>📊 {signal.strategy} Signal — {exchange}</b>",
        f"<b>{signal.market_id}</b>",
        "",
        f"Side:       <b>{signal.side}</b>",
        f"Entry:      <b>{_fmt(signal.entry_price)}</b>",
        f"Target:     <b>{_fmt(signal.target_price)}</b>",
        f"Stop:       {stop_str}",
        f"Edge:       {edge_str}",
        f"Confidence: {conf_str}",
        f"Size:       {size_str}  ({shares_str} units)",
    ]

    if note:
        lines += ["", f"<i>{note}</i>"]

    if signal.reasoning:
        # Trim reasoning to keep the message compact
        short = signal.reasoning[:300] + ("…" if len(signal.reasoning) > 300 else "")
        lines += ["", short]

    return await send_message("\n".join(lines))
