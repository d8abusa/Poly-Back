"""
Polymarket API client — wraps public CLOB and Gamma APIs.
Structured with hooks for authenticated endpoints when an account is added.
"""

import httpx
from typing import Optional

CLOB_BASE = "https://clob.polymarket.com"
GAMMA_BASE = "https://gamma-api.polymarket.com"


class PolymarketClient:
    def __init__(self, api_key: Optional[str] = None):
        self._api_key = api_key  # placeholder for future auth
        headers = {"User-Agent": "PolyBack/1.0"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.AsyncClient(timeout=30.0, headers=headers)

    # ── Market search (Gamma API — richer metadata) ──────────────────────────

    async def search_markets(
        self,
        limit: int = 50,
        offset: int = 0,
        active: Optional[bool] = None,
        closed: Optional[bool] = None,
        order: str = "volumeNum",   # volumeNum gives correct numeric sort
        tag_slug: Optional[str] = None,
    ) -> list:
        params: dict = {
            "limit": limit,
            "offset": offset,
            "order": order,
            "ascending": "false",
        }
        if active is not None:
            params["active"] = str(active).lower()
        if closed is not None:
            params["closed"] = str(closed).lower()
        if tag_slug:
            params["tag_slug"] = tag_slug

        resp = await self._client.get(f"{GAMMA_BASE}/markets", params=params)
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else data.get("markets", [])

    # ── Single market (CLOB API — includes token IDs for price history) ──────

    async def get_market(self, condition_id: str) -> dict:
        resp = await self._client.get(f"{CLOB_BASE}/markets/{condition_id}")
        resp.raise_for_status()
        return resp.json()

    # ── Price history (CLOB API) ─────────────────────────────────────────────

    async def get_price_history(
        self,
        token_id: str,
        interval: str = "max",
        start_ts: Optional[int] = None,
        end_ts: Optional[int] = None,
        fidelity: int = 60,
    ) -> list:
        params: dict = {"market": token_id, "interval": interval, "fidelity": fidelity}
        if start_ts:
            params["startTs"] = start_ts
        if end_ts:
            params["endTs"] = end_ts

        resp = await self._client.get(f"{CLOB_BASE}/prices-history", params=params)
        resp.raise_for_status()
        return resp.json().get("history", [])

    # ── Tags ─────────────────────────────────────────────────────────────────

    async def get_tags(self) -> list:
        resp = await self._client.get(f"{GAMMA_BASE}/tags")
        resp.raise_for_status()
        return resp.json()

    # ── Placeholder: authenticated endpoints (future) ────────────────────────

    async def get_balance(self) -> dict:
        """Requires API key. Returns USDC balance."""
        if not self._api_key:
            return {"error": "No API key configured"}
        resp = await self._client.get(f"{CLOB_BASE}/balance-allowance")
        resp.raise_for_status()
        return resp.json()

    async def close(self):
        await self._client.aclose()


# ── Singleton (used via FastAPI dependency injection) ─────────────────────────

_client: Optional[PolymarketClient] = None


def get_client() -> PolymarketClient:
    global _client
    if _client is None:
        _client = PolymarketClient()
    return _client
