"""
Webull routes.

  GET  /api/webull/status          — credential check (keys set, account_id set)
  GET  /api/webull/account         — fetch account profile (buying power, account_id)
  POST /api/webull/verify          — test-sign a request to confirm keys work
"""

import logging
import os

from fastapi import APIRouter, HTTPException

log    = logging.getLogger(__name__)
router = APIRouter(prefix="/api/webull", tags=["webull"])


@router.get("/status")
async def webull_status():
    """Returns whether credentials are configured."""
    app_key    = os.getenv("WEBULL_APP_KEY",    "").strip()
    app_secret = os.getenv("WEBULL_APP_SECRET", "").strip()
    account_id = os.getenv("WEBULL_ACCOUNT_ID", "").strip()
    return {
        "app_key_set":    bool(app_key),
        "app_secret_set": bool(app_secret),
        "account_id_set": bool(account_id),
        "app_key_preview": f"{app_key[:6]}…" if app_key else None,
        "message": (
            "Credentials configured — ready to trade."
            if app_key and app_secret and account_id else
            "Missing credentials. Set WEBULL_APP_KEY, WEBULL_APP_SECRET, "
            "and WEBULL_ACCOUNT_ID in .env, then call /account to fetch your account_id."
        ),
    }


@router.get("/account")
async def account_info():
    """
    Fetch account profile from Webull.
    Also returns account_id — copy this into WEBULL_ACCOUNT_ID in .env.
    """
    from ..services.webull_client import get_webull_client
    client = get_webull_client()
    try:
        info = await client.get_account_info()
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Webull API error: {exc}")
    return info


@router.post("/verify")
async def verify_credentials():
    """
    Sign a test request and attempt a lightweight API call to confirm
    the App Key + App Secret are valid.
    """
    from ..services.webull_client import _sign_headers, _QUOTES_BASE
    import httpx

    app_key = os.getenv("WEBULL_APP_KEY", "").strip()
    if not app_key:
        raise HTTPException(status_code=400, detail="WEBULL_APP_KEY not set in .env")

    uri = "/quotes/ticker/queryTickers"
    params = {"tickers": "AAPL", "includeSecu": "1"}
    try:
        headers = _sign_headers("GET", uri, body=None, queries=params)
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(f"{_QUOTES_BASE}{uri}", headers=headers, params=params)
        if r.status_code == 200:
            data = r.json()
            tickers = data.get("data") or data.get("tickerList") or []
            price = None
            if tickers:
                t = tickers[0]
                price = t.get("close") or t.get("pPrice")
            return {
                "status":  "ok",
                "message": "Credentials valid — Webull API responding.",
                "aapl_price": price,
            }
        else:
            return {
                "status":  "error",
                "http_status": r.status_code,
                "body": r.text[:500],
            }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Webull verify failed: {exc}")
