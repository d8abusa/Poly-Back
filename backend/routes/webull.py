"""
Webull setup and account routes.

  POST /api/webull/setup/request-mfa   — send MFA code to registered email
  POST /api/webull/setup/confirm       — complete first-time login with emailed code
  GET  /api/webull/account             — buying power, equity, cash
  GET  /api/webull/status              — whether session token exists
"""

import asyncio
import logging
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

log    = logging.getLogger(__name__)
router = APIRouter(prefix="/api/webull", tags=["webull"])

_TOKEN_PATH = os.path.expanduser("~/.tokens/webull_client.pkl")


class MfaConfirmRequest(BaseModel):
    code: str


@router.get("/status")
async def webull_status():
    """Returns whether a saved session token exists."""
    token_exists = os.path.exists(_TOKEN_PATH)
    return {
        "token_saved":  token_exists,
        "email":        os.getenv("WEBULL_EMAIL", ""),
        "trade_pin_set": bool(os.getenv("WEBULL_TRADE_PIN", "").strip()),
        "message": (
            "Session token found — server will log in automatically on next restart."
            if token_exists else
            "No session token. Call /setup/request-mfa then /setup/confirm to authenticate."
        ),
    }


@router.post("/setup/request-mfa")
async def request_mfa():
    """
    Trigger Webull to email an MFA code to your registered email address.
    Call this once, then immediately call /setup/confirm with the code.
    """
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, _do_request_mfa)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    email = os.getenv("WEBULL_EMAIL", "")
    return {"status": "sent", "message": f"MFA code sent to {email}. Check your inbox and call /setup/confirm."}


@router.post("/setup/confirm")
async def confirm_mfa(body: MfaConfirmRequest):
    """
    Complete first-time login with the emailed MFA code.
    Session token is saved to ~/.tokens/webull_client.pkl.
    """
    if not body.code.strip():
        raise HTTPException(status_code=400, detail="MFA code is required")
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, _do_confirm_mfa, body.code.strip())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"status": "authenticated", "message": "Webull session saved. You won't need to do this again."}


@router.get("/account")
async def account_info():
    """Return Webull account balance and buying power."""
    from ..services.webull_client import get_webull_client
    client = get_webull_client()
    info = await client.get_account_info()
    return info


# ── Sync helpers (run in executor) ────────────────────────────────────────────

def _do_request_mfa():
    from ..services.webull_client import request_mfa_sync
    request_mfa_sync()


def _do_confirm_mfa(code: str):
    from ..services.webull_client import confirm_mfa_sync
    confirm_mfa_sync(code)
