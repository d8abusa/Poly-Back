"""
Admin routes — supplementary endpoints for risk management.
Core kill-switch, resume, and status endpoints live in positions.py.
This module adds any additional admin-only operations.
"""

import logging
from fastapi import APIRouter
from ..services.coinbase_client import get_coinbase_client, COINBASE_BASE
from ..services import telegram_service

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/status")
async def admin_status():
    """Basic admin health check."""
    return {"status": "ok"}


@router.post("/telegram/test")
async def test_telegram():
    """Send a test message to verify Telegram bot configuration."""
    from fastapi import HTTPException
    sent = await telegram_service.send_message("✅ PolyBack Telegram connected successfully.")
    if not sent:
        raise HTTPException(status_code=503, detail="Telegram not configured — check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env")
    return {"status": "sent"}


@router.get("/coinbase-probe")
async def coinbase_probe():
    """Probe Coinbase API for available product types and stock products."""
    client = get_coinbase_client()
    results = {}
    for pt in ["SPOT", "FUTURE", "PERPETUAL_FUTURE", "STOCK"]:
        try:
            path = "/products"
            headers = client._auth_headers("GET", path)
            resp = await client._client.get(
                f"{COINBASE_BASE}{path}",
                headers=headers,
                params={"limit": 5, "product_type": pt},
            )
            if resp.status_code == 200:
                products = resp.json().get("products", [])
                results[pt] = [p["product_id"] for p in products[:5]]
            else:
                results[pt] = f"HTTP {resp.status_code}"
        except Exception as e:
            results[pt] = str(e)

    # Also check if any known stock tickers appear in SPOT
    known = ["AAPL", "TSLA", "NVDA", "AMZN", "GOOGL", "MSFT"]
    try:
        headers = client._auth_headers("GET", "/products")
        resp = await client._client.get(
            f"{COINBASE_BASE}/products",
            headers=headers,
            params={"limit": 250, "product_type": "SPOT"},
        )
        all_ids = [p["product_id"] for p in resp.json().get("products", [])]
        results["stock_tickers_found"] = [i for i in all_ids if i.split("-")[0] in known]
        results["total_spot_products"] = len(all_ids)
        # Show first product's full keys to understand structure
        if resp.json().get("products"):
            results["sample_fields"] = list(resp.json()["products"][0].keys())
    except Exception as e:
        results["spot_check_error"] = str(e)

    return results
