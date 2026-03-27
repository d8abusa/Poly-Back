"""
Position store — backed by PostgreSQL with an in-memory cache.

Same public API as before; state now survives backend restarts.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from ..models.schemas import SignalSchema
from .db import get_cursor, row_to_dict, asset_type_from_exchange


# ── In-memory cache (populated on first access) ───────────────────────────────

_open:   dict[str, dict] = {}
_closed: list[dict]      = []
_loaded  = False


def _ensure_loaded() -> None:
    global _loaded
    if _loaded:
        return
    with get_cursor() as cur:
        cur.execute("SELECT * FROM positions ORDER BY entry_date ASC")
        rows = cur.fetchall()
    for row in rows:
        d = row_to_dict(row)
        if d["status"] == "open":
            _open[d["id"]] = d
        else:
            _closed.append(d)
    _loaded = True


# ── Mutations ─────────────────────────────────────────────────────────────────

def open_position(signal: SignalSchema, category: str = "Other", exchange: str = "coinbase") -> dict:
    _ensure_loaded()
    pos = {
        "id":           str(uuid.uuid4()),
        "signal_id":    signal.id,
        "market_id":    signal.market_id,
        "market_title": getattr(signal, "market_title", None) or signal.market_id[:40],
        "category":     category,
        "strategy":     signal.strategy,
        "side":         "YES" if signal.side == "BUY" else "NO",
        "entry_price":  signal.entry_price,
        "current_prob": signal.entry_price,
        "exit_target":  signal.target_price,
        "stop_loss":    signal.stop_loss,
        "shares":       signal.suggested_shares,
        "capital":      float(signal.suggested_size),
        "status":       "open",
        "entry_date":   signal.created_at or datetime.now(timezone.utc).isoformat(),
        "closed_at":    None,
        "exit_prob":    None,
        "close_reason": None,
        "realized_pnl": None,
        "exchange":     exchange,
        "asset_type":   asset_type_from_exchange(exchange),
    }
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO positions
                (id, signal_id, market_id, market_title, category, strategy, side,
                 entry_price, current_prob, exit_target, stop_loss, shares, capital,
                 status, entry_date, closed_at, exit_prob, close_reason, realized_pnl,
                 exchange, asset_type)
            VALUES
                (%(id)s, %(signal_id)s, %(market_id)s, %(market_title)s, %(category)s,
                 %(strategy)s, %(side)s, %(entry_price)s, %(current_prob)s, %(exit_target)s,
                 %(stop_loss)s, %(shares)s, %(capital)s, %(status)s, %(entry_date)s,
                 %(closed_at)s, %(exit_prob)s, %(close_reason)s, %(realized_pnl)s,
                 %(exchange)s, %(asset_type)s)
        """, pos)
    _open[pos["id"]] = pos
    return pos


def get_open() -> list[dict]:
    _ensure_loaded()
    return list(_open.values())


def get_closed() -> list[dict]:
    _ensure_loaded()
    return list(reversed(_closed))


def update_prob(position_id: str, prob: float) -> Optional[dict]:
    _ensure_loaded()
    pos = _open.get(position_id)
    if pos is not None:
        pos["current_prob"] = max(0.01, min(0.99, prob))
        with get_cursor() as cur:
            cur.execute(
                "UPDATE positions SET current_prob=%s WHERE id=%s",
                (pos["current_prob"], position_id),
            )
    return pos


def close_position(position_id: str, close_reason: str = "manual") -> Optional[dict]:
    _ensure_loaded()
    pos = _open.pop(position_id, None)
    if pos is None:
        return None
    exit_prob = pos["current_prob"]
    if pos["side"] == "YES":
        pnl = (exit_prob - pos["entry_price"]) * pos["shares"]
    else:
        pnl = (pos["entry_price"] - exit_prob) * pos["shares"]
    pos["status"]       = "closed"
    pos["closed_at"]    = datetime.now(timezone.utc).isoformat()
    pos["exit_prob"]    = round(exit_prob, 4)
    pos["close_reason"] = close_reason
    pos["realized_pnl"] = round(pnl, 4)
    with get_cursor() as cur:
        cur.execute("""
            UPDATE positions
            SET status=%(status)s, closed_at=%(closed_at)s, exit_prob=%(exit_prob)s,
                close_reason=%(close_reason)s, realized_pnl=%(realized_pnl)s
            WHERE id=%(id)s
        """, pos)
    _closed.append(pos)
    return pos


def get_summary() -> dict:
    _ensure_loaded()
    open_list = list(_open.values())

    def _pnl(p: dict) -> float:
        if p["side"] == "YES":
            return (p["current_prob"] - p["entry_price"]) * p["shares"]
        return (p["entry_price"] - p["current_prob"]) * p["shares"]

    pnl_values       = [_pnl(p) for p in open_list]
    unrealized       = sum(pnl_values)
    capital_deployed = sum(p["capital"] for p in open_list)

    today = datetime.now(timezone.utc).date().isoformat()
    today_realized = sum(
        p["realized_pnl"]
        for p in _closed
        if p.get("closed_at", "")[:10] == today and p["realized_pnl"] is not None
    )

    closed_pnl   = [p["realized_pnl"] for p in _closed if p["realized_pnl"] is not None]
    win_rate     = (len([v for v in closed_pnl if v > 0]) / len(closed_pnl) * 100) if closed_pnl else 0.0
    max_drawdown = min(pnl_values) if pnl_values else 0.0
    profitable   = sum(1 for v in pnl_values if v >= 0)
    at_risk      = len(pnl_values) - profitable

    return {
        "total_unrealized_pnl": round(unrealized, 2),
        "open_count":           len(open_list),
        "capital_deployed":     round(capital_deployed, 2),
        "today_realized":       round(today_realized, 2),
        "max_drawdown":         round(max_drawdown, 2),
        "win_rate":             round(win_rate, 1),
        "profitable_count":     profitable,
        "at_risk_count":        at_risk,
    }
