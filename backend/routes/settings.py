"""
Settings API — credential management for all exchanges.
Reads/writes the project .env file.
Never returns raw credential values to the frontend.
"""

import logging
import os
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

log    = logging.getLogger(__name__)
router = APIRouter(prefix="/api/settings", tags=["settings"])

ENV_PATH = Path(__file__).parent.parent.parent / ".env"

# ── .env helpers ──────────────────────────────────────────────────────────────

def _read_env() -> dict[str, str]:
    """Parse .env into a key→value dict (comments and blanks ignored)."""
    result: dict[str, str] = {}
    if not ENV_PATH.exists():
        return result
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            k, _, v = line.partition("=")
            result[k.strip()] = v.strip()
    return result


def _write_env(updates: dict[str, str]) -> None:
    """
    Update specific keys in .env, preserving all comments and unrelated lines.
    Appends new keys at the end if not already present.
    """
    existing_text = ENV_PATH.read_text() if ENV_PATH.exists() else ""
    lines = existing_text.splitlines(keepends=True)
    written: set[str] = set()

    new_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            new_lines.append(line)
            continue
        key, _, _ = stripped.partition("=")
        key = key.strip()
        if key in updates:
            new_lines.append(f"{key}={updates[key]}\n")
            written.add(key)
        else:
            new_lines.append(line)

    # Append any keys that didn't exist yet
    new_keys = [k for k in updates if k not in written]
    if new_keys:
        if new_lines and not new_lines[-1].endswith("\n"):
            new_lines.append("\n")
        for k in new_keys:
            new_lines.append(f"{k}={updates[k]}\n")

    ENV_PATH.write_text("".join(new_lines))


def _masked(val: Optional[str]) -> dict:
    """Return safe status dict — never expose the raw value."""
    if not val:
        return {"configured": False, "preview": None}
    preview = val[:4] + "…" + val[-4:] if len(val) > 10 else "****"
    return {"configured": True, "preview": preview}


# ── Response helpers ──────────────────────────────────────────────────────────

def _polymarket_status(env: dict) -> dict:
    has_creds = bool(env.get("POLY_API_KEY") and env.get("POLY_API_SECRET") and env.get("POLY_API_PASSPHRASE"))
    has_key   = bool(env.get("POLY_PRIVATE_KEY"))
    level     = "full" if (has_creds and has_key) else "api" if has_creds else "public"
    return {
        "auth_level": level,
        "capabilities": {
            "read_public":  True,
            "read_private": has_creds,
            "place_orders": level == "full",
        },
        "fields": {
            "POLY_API_KEY":        _masked(env.get("POLY_API_KEY")),
            "POLY_API_SECRET":     _masked(env.get("POLY_API_SECRET")),
            "POLY_API_PASSPHRASE": _masked(env.get("POLY_API_PASSPHRASE")),
            "POLY_PRIVATE_KEY":    _masked(env.get("POLY_PRIVATE_KEY")),
        },
    }


def _kalshi_status(env: dict) -> dict:
    has_api_key     = bool(env.get("KALSHI_API_KEY"))
    has_private_key = bool(env.get("KALSHI_PRIVATE_KEY"))
    full = has_api_key and has_private_key
    return {
        "auth_level": "full" if full else "api" if has_api_key else "public",
        "capabilities": {
            "read_public":  True,
            "read_private": has_api_key,
            "place_orders": full,
        },
        "fields": {
            "KALSHI_API_KEY":      _masked(env.get("KALSHI_API_KEY")),
            "KALSHI_PRIVATE_KEY":  _masked(env.get("KALSHI_PRIVATE_KEY")),
        },
    }


def _coinbase_status(env: dict) -> dict:
    has_key_name    = bool(env.get("COINBASE_KEY_NAME"))
    has_private_key = bool(env.get("COINBASE_PRIVATE_KEY"))
    full = has_key_name and has_private_key
    return {
        "auth_level": "full" if full else "public",
        "capabilities": {
            "read_public":  True,
            "read_private": full,
            "place_orders": full,
        },
        "fields": {
            "COINBASE_KEY_NAME":    _masked(env.get("COINBASE_KEY_NAME")),
            "COINBASE_PRIVATE_KEY": _masked(env.get("COINBASE_PRIVATE_KEY")),
        },
    }


def _manifold_status(_env: dict) -> dict:
    return {
        "auth_level": "public",
        "capabilities": {
            "read_public":  True,
            "read_private": False,
            "place_orders": False,
        },
        "fields": {},
        "note": "Manifold Markets is fully public — no credentials required.",
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
async def get_settings():
    """Return masked credential status for all exchanges."""
    env = _read_env()
    return {
        "coinbase":   _coinbase_status(env),
        "kalshi":     _kalshi_status(env),
        "manifold":   _manifold_status(env),
        "polymarket": _polymarket_status(env),
    }


class CoinbaseCredsRequest(BaseModel):
    key_name:    Optional[str] = None
    private_key: Optional[str] = None


@router.post("/coinbase")
async def update_coinbase_creds(body: CoinbaseCredsRequest):
    """Update Coinbase credentials in .env."""
    updates: dict[str, str] = {}
    if body.key_name    is not None: updates["COINBASE_KEY_NAME"]    = body.key_name
    if body.private_key is not None: updates["COINBASE_PRIVATE_KEY"] = body.private_key

    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided")

    try:
        _write_env(updates)
        from ..config import settings
        if body.key_name:    settings.coinbase_key_name    = body.key_name
        if body.private_key: settings.coinbase_private_key = body.private_key
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write credentials: {e}")

    env = _read_env()
    return {"ok": True, "status": _coinbase_status(env)}


@router.delete("/coinbase/{field}")
async def clear_coinbase_field(field: str):
    allowed = {"COINBASE_KEY_NAME", "COINBASE_PRIVATE_KEY"}
    if field not in allowed:
        raise HTTPException(status_code=400, detail=f"Unknown field: {field}")
    _write_env({field: ""})
    env = _read_env()
    return {"ok": True, "status": _coinbase_status(env)}


class PolymarketCredsRequest(BaseModel):
    api_key:        Optional[str] = None
    api_secret:     Optional[str] = None
    api_passphrase: Optional[str] = None
    private_key:    Optional[str] = None


@router.post("/polymarket")
async def update_polymarket_creds(body: PolymarketCredsRequest):
    """Update Polymarket credentials in .env (only non-None fields are written)."""
    updates: dict[str, str] = {}
    if body.api_key        is not None: updates["POLY_API_KEY"]        = body.api_key
    if body.api_secret     is not None: updates["POLY_API_SECRET"]     = body.api_secret
    if body.api_passphrase is not None: updates["POLY_API_PASSPHRASE"] = body.api_passphrase
    if body.private_key    is not None: updates["POLY_PRIVATE_KEY"]    = body.private_key

    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided")

    try:
        _write_env(updates)
        # Reload settings singleton so new values take effect without restart
        from ..config import settings
        if body.api_key:        settings.api_key        = body.api_key
        if body.api_secret:     settings.api_secret     = body.api_secret
        if body.api_passphrase: settings.api_passphrase = body.api_passphrase
        if body.private_key:    settings.private_key    = body.private_key
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write credentials: {e}")

    env = _read_env()
    return {"ok": True, "status": _polymarket_status(env)}


class KalshiCredsRequest(BaseModel):
    api_key:      Optional[str] = None
    api_password: Optional[str] = None
    private_key:  Optional[str] = None


@router.post("/kalshi")
async def update_kalshi_creds(body: KalshiCredsRequest):
    """Update Kalshi credentials in .env."""
    updates: dict[str, str] = {}
    if body.api_key      is not None: updates["KALSHI_API_KEY"]      = body.api_key
    if body.api_password is not None: updates["KALSHI_API_PASSWORD"] = body.api_password
    if body.private_key  is not None: updates["KALSHI_PRIVATE_KEY"]  = body.private_key

    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided")

    try:
        _write_env(updates)
        from ..config import settings
        if body.api_key:      settings.kalshi_api_key      = body.api_key
        if body.api_password: settings.kalshi_api_password = body.api_password
        if body.private_key:  settings.kalshi_private_key  = body.private_key
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write credentials: {e}")

    env = _read_env()
    return {"ok": True, "status": _kalshi_status(env)}


@router.delete("/polymarket/{field}")
async def clear_polymarket_field(field: str):
    """Clear a single Polymarket credential field."""
    allowed = {"POLY_API_KEY", "POLY_API_SECRET", "POLY_API_PASSPHRASE", "POLY_PRIVATE_KEY"}
    if field not in allowed:
        raise HTTPException(status_code=400, detail=f"Unknown field: {field}")
    _write_env({field: ""})
    env = _read_env()
    return {"ok": True, "status": _polymarket_status(env)}


@router.delete("/kalshi/{field}")
async def clear_kalshi_field(field: str):
    allowed = {"KALSHI_API_KEY", "KALSHI_API_PASSWORD", "KALSHI_PRIVATE_KEY"}
    if field not in allowed:
        raise HTTPException(status_code=400, detail=f"Unknown field: {field}")
    _write_env({field: ""})
    env = _read_env()
    return {"ok": True, "status": _kalshi_status(env)}
