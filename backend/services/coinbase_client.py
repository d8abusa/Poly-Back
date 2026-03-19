"""
Coinbase Advanced Trade client — prediction market order execution.

Authentication: JWT signed with ES256 using the Coinbase Cloud API EC private key.
Docs: https://docs.cdp.coinbase.com/advanced-trade/docs/rest-api-auth

Required env vars:
    COINBASE_KEY_NAME    — full key path, e.g. organizations/{org_id}/apiKeys/{key_id}
    COINBASE_PRIVATE_KEY — PEM-encoded EC private key (with literal \\n newlines)
"""

import logging
import os
import time
import uuid
from typing import Optional

import httpx
import jwt as pyjwt

from .base_client import BaseExchangeClient

log = logging.getLogger(__name__)

COINBASE_BASE    = "https://api.coinbase.com/api/v3/brokerage"
COINBASE_API_PFX = "/api/v3/brokerage"


def _build_jwt(method: str, api_path: str) -> str:
    """Build a short-lived JWT for the given request using ES256.

    api_path should be the route-only portion, e.g. '/products'.
    The full URI claim is built as: METHOD api.coinbase.com/api/v3/brokerage{api_path}
    """
    key_name = os.getenv("COINBASE_KEY_NAME", "")
    raw_key  = os.getenv("COINBASE_PRIVATE_KEY", "").replace("\\n", "\n")

    if not key_name or not raw_key:
        raise RuntimeError("COINBASE_KEY_NAME and COINBASE_PRIVATE_KEY must be set in .env")

    now = int(time.time())
    payload = {
        "sub": key_name,
        "iss": "cdp",
        "nbf": now,
        "exp": now + 120,
        "uri": f"{method} api.coinbase.com{COINBASE_API_PFX}{api_path}",
    }
    token = pyjwt.encode(
        payload,
        raw_key,
        algorithm="ES256",
        headers={"kid": key_name, "nonce": uuid.uuid4().hex},
    )
    return token


class CoinbaseClient(BaseExchangeClient):
    """
    Coinbase Advanced Trade client.
    Read endpoints work with valid JWT auth.
    Order placement requires a funded account with trading enabled.
    """

    def __init__(self):
        self._client = httpx.AsyncClient(
            timeout=30.0,
            headers={"User-Agent": "PolyBack/1.0", "Accept": "application/json"},
        )

    def _auth_headers(self, method: str, path: str) -> dict:
        token = _build_jwt(method, path)
        return {"Authorization": f"Bearer {token}"}

    # ── Market listing ────────────────────────────────────────────────────────

    async def search_markets(self, limit: int = 50, offset: int = 0, **kwargs) -> list[dict]:
        path = "/products"
        headers = self._auth_headers("GET", path)
        params = {"limit": min(limit + offset, 250), "product_type": "SPOT"}
        resp = await self._client.get(f"{COINBASE_BASE}{path}", headers=headers, params=params)
        resp.raise_for_status()
        products = resp.json().get("products", [])
        return products[offset:offset + limit]

    def normalize_market(self, raw: dict) -> dict:
        product_id = raw.get("product_id", "")
        price      = float(raw.get("price", 0) or 0)
        return {
            "id":           product_id,
            "condition_id": product_id,
            "token_id":     product_id,
            "title":        raw.get("display_name") or product_id,
            "category":     "Crypto",
            "prob":         round(price, 4),
            "volume":       float(raw.get("volume_24h", 0) or 0),
            "liquidity":    0.0,
            "resolved":     False,
            "outcome":      None,
            "end_date":     "",
            "tags":         [],
            "exchange":     "coinbase",
        }

    # ── Price history ─────────────────────────────────────────────────────────

    async def get_price_history(
        self,
        market_id: str,
        token_id: Optional[str] = None,
        interval: str = "max",
        fidelity: int = 60,
    ) -> list[dict]:
        product = token_id or market_id
        path    = f"/products/{product}/candles"
        headers = self._auth_headers("GET", path)

        _granularity_map = {
            "1m": "ONE_MINUTE", "5m": "FIVE_MINUTE", "15m": "FIFTEEN_MINUTE",
            "30m": "THIRTY_MINUTE", "1h": "ONE_HOUR", "6h": "SIX_HOUR",
            "1d": "ONE_DAY", "max": "ONE_DAY",
        }
        # Coinbase enforces a 300-candle max per request.
        # Cap the lookback window so we never exceed that limit.
        _max_seconds = {
            "1m": 290 * 60,        "5m":  290 * 5 * 60,
            "15m": 290 * 15 * 60,  "30m": 290 * 30 * 60,
            "1h": 290 * 3600,      "6h":  290 * 6 * 3600,
            "1d": 290 * 86400,     "max": 290 * 86400,
        }
        granularity = _granularity_map.get(interval, "ONE_DAY")
        end   = int(time.time())
        start = end - _max_seconds.get(interval, 290 * 86400)

        params = {"start": start, "end": end, "granularity": granularity}
        try:
            resp = await self._client.get(f"{COINBASE_BASE}{path}", headers=headers, params=params)
            resp.raise_for_status()
            candles = resp.json().get("candles", [])
            return [{"t": int(c["start"]), "p": round(float(c["close"]), 4)} for c in candles if c.get("close")]
        except Exception as exc:
            log.warning("Coinbase price history failed %s: %s", product, exc)
            return []

    # ── Order placement ───────────────────────────────────────────────────────

    async def place_order(
        self,
        product_id: str,
        side: str,
        size: float,
        limit_price: Optional[float] = None,
        client_order_id: Optional[str] = None,
    ) -> dict:
        """
        Place a limit or market order via Coinbase Advanced Trade.
        side: "BUY" or "SELL"
        """
        path    = "/orders"
        headers = self._auth_headers("POST", path)
        order_id = client_order_id or uuid.uuid4().hex

        body: dict = {
            "client_order_id": order_id,
            "product_id":      product_id,
            "side":            side.upper(),
        }

        if limit_price is not None:
            body["order_configuration"] = {
                "limit_limit_gtc": {
                    "base_size":   str(size),
                    "limit_price": str(limit_price),
                }
            }
        else:
            body["order_configuration"] = {
                "market_market_ioc": {"base_size": str(size)}
            }

        try:
            resp = await self._client.post(f"{COINBASE_BASE}{path}", headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()
            order = data.get("success_response", data)
            return {
                "order_id": order.get("order_id", order_id),
                "status":   "submitted",
                "note":     f"Coinbase order placed: {product_id} {side} {size}",
            }
        except httpx.HTTPStatusError as exc:
            log.error("Coinbase order failed %s: %s — %s", product_id, exc.response.status_code, exc.response.text)
            return {"order_id": order_id, "status": "error", "note": exc.response.text}

    async def cancel_order(self, order_id: str) -> dict:
        path    = "/orders/batch_cancel"
        headers = self._auth_headers("POST", path)
        try:
            resp = await self._client.post(f"{COINBASE_BASE}{path}", headers=headers, json={"order_ids": [order_id]})
            resp.raise_for_status()
            return {"status": "cancelled", "order_id": order_id}
        except Exception as exc:
            log.error("Coinbase cancel failed %s: %s", order_id, exc)
            return {"status": "error", "order_id": order_id, "note": str(exc)}

    async def close(self):
        await self._client.aclose()


# ── Singleton ─────────────────────────────────────────────────────────────────

_coinbase_client: Optional[CoinbaseClient] = None


def get_coinbase_client() -> CoinbaseClient:
    global _coinbase_client
    if _coinbase_client is None:
        _coinbase_client = CoinbaseClient()
    return _coinbase_client
