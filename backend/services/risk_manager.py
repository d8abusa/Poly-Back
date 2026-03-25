"""
Risk manager — session-level guardrails.

Tracks realized PnL, enforces drawdown circuit breaker,
provides halt/resume for the kill switch endpoint.

Functions called by other modules:
  is_halted()             → bool
  record_realized_pnl()   → updates session PnL, may trip circuit breaker
  get_status()            → dict
  flatten_all_and_halt()  → async, closes all positions and halts
  resume_trading()        → clears halt flag
"""

import asyncio
import logging
import os

log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

_MAX_SESSION_DRAWDOWN = float(os.getenv("MAX_SESSION_DRAWDOWN", "0.20"))   # 20%
_SESSION_CAPITAL      = float(os.getenv("SESSION_CAPITAL",      "1000.0")) # starting capital

# ── State ─────────────────────────────────────────────────────────────────────

_halted:          bool  = False
_halt_reason:     str   = ""
_session_pnl:     float = 0.0
_peak_value:      float = _SESSION_CAPITAL


# ── Persistence ───────────────────────────────────────────────────────────────

def _save_state() -> None:
    from .db import get_cursor
    with get_cursor() as cur:
        for key, value in [
            ("halted",      "1" if _halted else "0"),
            ("halt_reason", _halt_reason),
            ("session_pnl", str(_session_pnl)),
            ("peak_value",  str(_peak_value)),
        ]:
            cur.execute(
                "INSERT INTO risk_state (key, value) VALUES (%s, %s) "
                "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
                (key, value),
            )


def _load_state() -> None:
    global _halted, _halt_reason, _session_pnl, _peak_value
    from .db import get_cursor
    try:
        with get_cursor() as cur:
            cur.execute("SELECT key, value FROM risk_state")
            rows = {r["key"]: r["value"] for r in cur.fetchall()}
        if rows:
            _halted      = rows.get("halted", "0") == "1"
            _halt_reason = rows.get("halt_reason", "")
            _session_pnl = float(rows.get("session_pnl", 0.0))
            _peak_value  = float(rows.get("peak_value", _SESSION_CAPITAL))
            if _halted:
                log.warning("Risk state restored from DB — system is HALTED: %s", _halt_reason)
    except Exception as exc:
        log.warning("Could not load risk state from DB: %s", exc)


_load_state()


# ── Core interface ─────────────────────────────────────────────────────────────

def is_halted() -> bool:
    return _halted


def record_realized_pnl(pnl: float) -> None:
    global _session_pnl, _halted, _halt_reason
    _session_pnl += pnl
    current_value = _SESSION_CAPITAL + _session_pnl
    drawdown = (_peak_value - current_value) / _peak_value if _peak_value > 0 else 0.0
    if drawdown >= _MAX_SESSION_DRAWDOWN and not _halted:
        _halted = True
        _halt_reason = f"Session drawdown {drawdown*100:.1f}% exceeded {_MAX_SESSION_DRAWDOWN*100:.0f}% limit"
        log.critical("CIRCUIT BREAKER TRIPPED: %s", _halt_reason)
    _save_state()


def get_status() -> dict:
    current_value = _SESSION_CAPITAL + _session_pnl
    drawdown = (_peak_value - current_value) / _peak_value if _peak_value > 0 else 0.0
    return {
        "halted":          _halted,
        "halt_reason":     _halt_reason,
        "session_pnl":     round(_session_pnl, 2),
        "current_value":   round(current_value, 2),
        "session_capital": _SESSION_CAPITAL,
        "drawdown_pct":    round(drawdown * 100, 2),
        "max_drawdown_pct": _MAX_SESSION_DRAWDOWN * 100,
    }


async def flatten_all_and_halt(reason: str = "manual_kill_switch") -> dict:
    global _halted, _halt_reason
    _halted      = True
    _halt_reason = reason
    _save_state()
    log.critical("HALT triggered: %s", reason)

    # Import here to avoid circular imports
    from . import position_tracker as pt
    from .exchange_router import get_exchange_client

    open_positions = pt.get_open()
    closed, failed = [], []

    for pos in open_positions:
        try:
            client     = get_exchange_client(pos.get("exchange", "coinbase"))
            close_side = "SELL" if pos["side"] == "YES" else "BUY"
            result     = await client.place_order(
                product_id=pos["market_id"],
                side=close_side,
                size=float(pos.get("shares", 1)),
            )
            if result.get("status") == "submitted":
                closed_pos = pt.close_position(pos["id"], close_reason=reason)
                if closed_pos:
                    record_realized_pnl(closed_pos.get("realized_pnl") or 0.0)
                    closed.append(pos["id"])
            else:
                failed.append(pos["id"])
        except Exception as exc:
            log.error("flatten_all: failed to close %s: %s", pos["id"][:8], exc)
            failed.append(pos["id"])

    return {
        "halted":   True,
        "reason":   reason,
        "closed":   closed,
        "failed":   failed,
    }


def resume_trading(override_reason: str = "") -> dict:
    global _halted, _halt_reason
    _halted      = False
    _halt_reason = ""
    _save_state()
    log.warning("Trading RESUMED. Override reason: %s", override_reason)
    return {"halted": False, "override_reason": override_reason}
