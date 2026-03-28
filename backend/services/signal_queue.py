"""
Signal queue — backed by PostgreSQL with an in-memory cache.

Same public API as before; state now survives backend restarts.
CONFIRM-mode signals persist across restarts so no pending approvals are lost.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from ..models.schemas import SignalSchema
from .db import get_cursor, signal_to_row


# ── In-memory cache ───────────────────────────────────────────────────────────

_pending:  dict[str, SignalSchema] = {}
_executed: list[SignalSchema] = []
_rejected: list[SignalSchema] = []
_loaded = False


def _ensure_loaded() -> None:
    global _loaded
    if _loaded:
        return
    with get_cursor() as cur:
        cur.execute("SELECT * FROM signals ORDER BY created_at ASC")
        rows = cur.fetchall()
    for row in rows:
        d = dict(row)
        payload = json.loads(d.get("payload") or "{}")
        try:
            sig = SignalSchema(**payload)
        except Exception:
            continue
        if sig.status == "pending":
            _pending[sig.id] = sig
        elif sig.status in ("approved", "auto_executed"):
            _executed.append(sig)
        elif sig.status == "rejected":
            _rejected.append(sig)
    _loaded = True


def _upsert(sig: SignalSchema) -> None:
    row = signal_to_row(sig)
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO signals
                (id, status, market_id, market_title, strategy, side, entry_price,
                 target_price, stop_loss, suggested_size, suggested_shares,
                 execution_mode, created_at, resolved_at, asset_type, payload)
            VALUES
                (%(id)s, %(status)s, %(market_id)s, %(market_title)s, %(strategy)s,
                 %(side)s, %(entry_price)s, %(target_price)s, %(stop_loss)s,
                 %(suggested_size)s, %(suggested_shares)s, %(execution_mode)s,
                 %(created_at)s, %(resolved_at)s, %(asset_type)s, %(payload)s)
            ON CONFLICT (id) DO UPDATE SET
                status=EXCLUDED.status,
                resolved_at=EXCLUDED.resolved_at,
                suggested_size=EXCLUDED.suggested_size,
                asset_type=EXCLUDED.asset_type,
                payload=EXCLUDED.payload
        """, row)


# ── Mutations ─────────────────────────────────────────────────────────────────

def add_signal(signal: SignalSchema) -> SignalSchema:
    _ensure_loaded()
    if not signal.id:
        signal.id = str(uuid.uuid4())
    signal.status = "pending"
    signal.created_at = datetime.now(timezone.utc).isoformat()
    signal.resolved_at = None
    _upsert(signal)
    _pending[signal.id] = signal
    return signal


def approve_signal(signal_id: str, modified_size: Optional[int] = None) -> Optional[SignalSchema]:
    _ensure_loaded()
    sig = _pending.pop(signal_id, None)
    if sig is None:
        return None
    if modified_size is not None:
        sig.suggested_size = modified_size
    sig.status = "approved"
    sig.resolved_at = datetime.now(timezone.utc).isoformat()
    _upsert(sig)
    _executed.append(sig)
    return sig


def reject_signal(signal_id: str) -> Optional[SignalSchema]:
    _ensure_loaded()
    sig = _pending.pop(signal_id, None)
    if sig is None:
        return None
    sig.status = "rejected"
    sig.resolved_at = datetime.now(timezone.utc).isoformat()
    _upsert(sig)
    _rejected.append(sig)
    return sig


def modify_signal(signal_id: str, size: int, price: Optional[float] = None) -> Optional[SignalSchema]:
    _ensure_loaded()
    sig = _pending.get(signal_id)
    if sig is None:
        return None
    sig.suggested_size = size
    if price is not None:
        sig.entry_price = price
    _upsert(sig)
    return sig


# ── Reads ─────────────────────────────────────────────────────────────────────

def get_pending() -> list[SignalSchema]:
    _ensure_loaded()
    return list(_pending.values())


def get_executed() -> list[SignalSchema]:
    _ensure_loaded()
    return list(_executed)


def get_rejected() -> list[SignalSchema]:
    _ensure_loaded()
    return list(_rejected)


def get_signal(signal_id: str) -> Optional[SignalSchema]:
    """Look up any signal by ID regardless of status."""
    _ensure_loaded()
    if signal_id in _pending:
        return _pending[signal_id]
    for sig in _executed:
        if sig.id == signal_id:
            return sig
    for sig in _rejected:
        if sig.id == signal_id:
            return sig
    return None
