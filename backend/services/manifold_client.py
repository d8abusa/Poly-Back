"""
Manifold Markets client — wraps the Manifold v0 REST API.
Manifold is an open-source prediction market platform.

All read endpoints are public — no authentication required.
Markets use play money (Mana), making this ideal for strategy research.

API base: https://api.manifold.markets/v0
Docs:     https://docs.manifold.markets/api
"""

import logging
import time
from typing import Optional

import httpx

from .base_client import BaseExchangeClient

log = logging.getLogger(__name__)

MANIFOLD_BASE = "https://api.manifold.markets/v0"


class ManifoldClient(BaseExchangeClient):
    def __init__(self):
        self._client = httpx.AsyncClient(
            timeout=30.0,
            headers={"User-Agent": "PolyBack/1.0", "Accept": "application/json"},
        )

    # ── Market listing ───────────────────────────────────────────────────────

    async def search_markets(
        self,
        limit: int = 50,
        offset: int = 0,
        sort: str = "liquidity",   # newest | score | liquidity
        **kwargs,
    ) -> list[dict]:
        params = {
            "limit":  min(limit + offset, 1000),
            "sort":   sort,
        }
        resp = await self._client.get(f"{MANIFOLD_BASE}/markets", params=params)
        resp.raise_for_status()
        markets = resp.json()
        # Filter to binary YES/NO markets only
        markets = [m for m in markets if m.get("outcomeType") == "BINARY"]
        return markets[offset:offset + limit]

    def normalize_market(self, raw: dict) -> dict:
        from .polymarket_client import _categorize_from_text

        prob     = float(raw.get("probability", 0.5) or 0.5)
        resolved = bool(raw.get("isResolved", False))
        resolution = raw.get("resolution")
        outcome = None
        if resolved and resolution:
            outcome = "YES" if resolution == "YES" else "NO" if resolution == "NO" else None

        close_ts = raw.get("closeTime")  # milliseconds
        end_date = ""
        if close_ts:
            from datetime import datetime, timezone
            end_date = datetime.fromtimestamp(close_ts / 1000, tz=timezone.utc).date().isoformat()

        question = raw.get("question", "")
        category = _categorize_from_text(question)

        # Manifold group tags
        tags = [g.get("name", "") for g in (raw.get("groups") or []) if isinstance(g, dict)]

        market_id = raw.get("id", "")
        return {
            "id":           market_id,
            "condition_id": market_id,
            "token_id":     market_id,
            "title":        question,
            "category":     category,
            "prob":         round(prob, 4),
            "volume":       float(raw.get("volume", 0) or 0),
            "liquidity":    float(raw.get("totalLiquidity", 0) or 0),
            "resolved":     resolved,
            "outcome":      outcome,
            "end_date":     end_date,
            "tags":         tags,
            "exchange":     "manifold",
        }

    # ── Price history ────────────────────────────────────────────────────────

    async def get_price_history(
        self,
        market_id: str,
        token_id: Optional[str] = None,
        interval: str = "max",
        fidelity: int = 60,
    ) -> list[dict]:
        mid = token_id or market_id
        # Fetch bets sorted oldest-first; each bet has probAfter (probability after the trade)
        # We page through all bets to reconstruct a full price series
        all_bets = []
        before: Optional[str] = None
        max_pages = 10  # cap at 10k bets to avoid hammering the API

        for _ in range(max_pages):
            params: dict = {"contractId": mid, "limit": 1000, "order": "asc"}
            if before:
                params["after"] = before
            resp = await self._client.get(f"{MANIFOLD_BASE}/bets", params=params)
            resp.raise_for_status()
            page = resp.json()
            if not page:
                break
            all_bets.extend(page)
            if len(page) < 1000:
                break
            before = page[-1].get("id")

        if not all_bets:
            return []

        # Convert to {t, p} format — sample to avoid excessive points
        _interval_seconds = {
            "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
            "1h": 3600, "6h": 21600, "1d": 86400, "1w": 604800, "max": 3600,
        }
        bucket_s = _interval_seconds.get(interval, 3600)

        history: list[dict] = []
        last_bucket = -1
        for bet in all_bets:
            ts_ms = bet.get("createdTime", 0)
            p     = bet.get("probAfter")
            if p is None or ts_ms == 0:
                continue
            ts_s = ts_ms // 1000
            bucket = ts_s // bucket_s
            if bucket != last_bucket:
                history.append({"t": ts_s, "p": round(float(p), 4)})
                last_bucket = bucket

        return history

    # ── Live feed ────────────────────────────────────────────────────────────
    # Manifold uses an AMM — no traditional order book.
    # We return the current probability as both bid and ask with synthetic spread.

    async def get_last_price(self, market_id: str, token_id: Optional[str] = None) -> Optional[float]:
        mid = token_id or market_id
        try:
            resp = await self._client.get(f"{MANIFOLD_BASE}/market/{mid}")
            resp.raise_for_status()
            return float(resp.json().get("probability", 0.5))
        except Exception:
            return None

    async def get_midpoint(self, market_id: str, token_id: Optional[str] = None) -> Optional[float]:
        return await self.get_last_price(market_id, token_id)

    async def close(self):
        await self._client.aclose()


# ── Singleton ─────────────────────────────────────────────────────────────────

_manifold_client: Optional[ManifoldClient] = None

def get_manifold_client() -> ManifoldClient:
    global _manifold_client
    if _manifold_client is None:
        _manifold_client = ManifoldClient()
    return _manifold_client
