"""
In-memory signal queue for CONFIRM mode execution.

Module-level dicts/lists are safe for single-process uvicorn.
Replace with Redis / DB for multi-worker deployments.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from ..models.schemas import SignalSchema


# ── Stores ─────────────────────────────────────────────────────────────────────
_pending:  dict[str, SignalSchema] = {}
_executed: list[SignalSchema] = []
_rejected: list[SignalSchema] = []


# ── Mutations ──────────────────────────────────────────────────────────────────

def add_signal(signal: SignalSchema) -> SignalSchema:
    if not signal.id:
        signal.id = str(uuid.uuid4())
    signal.status = "pending"
    signal.created_at = datetime.now(timezone.utc).isoformat()
    signal.resolved_at = None
    _pending[signal.id] = signal
    return signal


def approve_signal(signal_id: str, modified_size: Optional[int] = None) -> Optional[SignalSchema]:
    sig = _pending.pop(signal_id, None)
    if sig is None:
        return None
    if modified_size is not None:
        sig.suggested_size = modified_size
    sig.status = "approved"
    sig.resolved_at = datetime.now(timezone.utc).isoformat()
    _executed.append(sig)
    return sig


def reject_signal(signal_id: str) -> Optional[SignalSchema]:
    sig = _pending.pop(signal_id, None)
    if sig is None:
        return None
    sig.status = "rejected"
    sig.resolved_at = datetime.now(timezone.utc).isoformat()
    _rejected.append(sig)
    return sig


def modify_signal(signal_id: str, size: int, price: Optional[float] = None) -> Optional[SignalSchema]:
    sig = _pending.get(signal_id)
    if sig is None:
        return None
    sig.suggested_size = size
    if price is not None:
        sig.entry_price = price
    return sig


# ── Reads ──────────────────────────────────────────────────────────────────────

def get_pending() -> list[SignalSchema]:
    return list(_pending.values())


def get_executed() -> list[SignalSchema]:
    return list(_executed)


def get_rejected() -> list[SignalSchema]:
    return list(_rejected)
