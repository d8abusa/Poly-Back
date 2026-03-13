"""
Kalshi exchange client — wraps the Kalshi v2 Trading API.
Kalshi is a CFTC-regulated US prediction market exchange.

Public endpoints require no authentication.
Authenticated endpoints (order placement) require API key + password.

API base: https://trading-api.kalshi.com/trade-api/v2
Docs:     https://trading-api.kalshi.com/docs
"""

import logging
import time
from typing import Optional

import httpx

from .base_client import BaseExchangeClient

log = logging.getLogger(__name__)

KALSHI_BASE = "https://trading-api.kalshi.com/trade-api/v2"

# Kalshi category → our canonical category
_KALSHI_CAT_MAP: dict[str, str] = {
    "Politics":       "Politics",
    "Economics":      "Economics",
    "Financials":     "Economics",
    "Crypto":         "Crypto",
    "Sports":         "Sports",
    "Science":        "Science & Tech",
    "Technology":     "Science & Tech",
    "Geopolitics":    "Politics",
    "Entertainment":  "Pop Culture",
    "Pop Culture":    "Pop Culture",
    "Weather":        "Science & Tech",
    "Climate":        "Science & Tech",
    "Healthcare":     "Science & Tech",
    "Legal":          "Other",
    "Culture":        "Pop Culture",
}


def _map_kalshi_category(raw_cat: str | None) -> str:
    if not raw_cat:
        return "Other"
    return _KALSHI_CAT_MAP.get(raw_cat, "Other")


class KalshiClient(BaseExchangeClient):
    def __init__(self, api_key: Optional[str] = None, api_password: Optional[str] = None):
        headers = {"User-Agent": "PolyBack/1.0", "Accept": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.AsyncClient(timeout=30.0, headers=headers)
        self._api_key = api_key

    # ── Market listing ───────────────────────────────────────────────────────

    async def search_markets(
        self,
        limit: int = 50,
        offset: int = 0,
        status: str = "open",
        **kwargs,
    ) -> list[dict]:
        params = {"limit": min(limit, 200), "status": status}
        # Kalshi uses cursor-based pagination; simulate offset by fetching enough
        if offset > 0:
            # Fetch offset + limit and slice — acceptable for UI page sizes
            params["limit"] = min(offset + limit, 200)

        resp = await self._client.get(f"{KALSHI_BASE}/markets", params=params)
        resp.raise_for_status()
        markets = resp.json().get("markets", [])
        return markets[offset:offset + limit] if offset > 0 else markets

    def normalize_market(self, raw: dict) -> dict:
        ticker = raw.get("ticker", "")
        # Prices are in cents (0–100) → divide by 100
        yes_bid  = raw.get("yes_bid",   0) or 0
        yes_ask  = raw.get("yes_ask",   0) or 0
        last_p   = raw.get("last_price", 0) or 0
        # Best estimate of current probability
        if yes_bid and yes_ask:
            prob = ((yes_bid + yes_ask) / 2) / 100
        elif last_p:
            prob = last_p / 100
        else:
            prob = 0.5

        resolved = raw.get("status", "") in ("finalized", "settled")
        resolution = raw.get("result", None)
        outcome = None
        if resolved and resolution:
            outcome = "YES" if resolution.lower() == "yes" else "NO"

        close_time = raw.get("close_time") or raw.get("expected_expiration_time") or ""
        end_date = close_time[:10] if close_time else ""

        category = _map_kalshi_category(raw.get("category"))
        # Fall back to text matching on title
        if category == "Other":
            from .polymarket_client import _categorize_from_text
            category = _categorize_from_text(raw.get("title", ""))

        return {
            "id":           ticker,
            "condition_id": ticker,
            "token_id":     ticker,
            "title":        raw.get("title", raw.get("subtitle", ticker)),
            "category":     category,
            "prob":         round(prob, 4),
            "volume":       float(raw.get("volume", 0) or 0),
            "liquidity":    float(raw.get("liquidity", 0) or 0),
            "resolved":     resolved,
            "outcome":      outcome,
            "end_date":     end_date,
            "tags":         [raw.get("category", "")] if raw.get("category") else [],
            "exchange":     "kalshi",
        }

    # ── Price history ────────────────────────────────────────────────────────

    async def get_price_history(
        self,
        market_id: str,
        token_id: Optional[str] = None,
        interval: str = "max",
        fidelity: int = 60,
    ) -> list[dict]:
        ticker = token_id or market_id
        # Kalshi requires explicit start/end timestamps
        import time as _time
        end_ts   = int(_time.time())
        # "max" → go back 2 years
        start_ts = end_ts - (2 * 365 * 24 * 3600)

        # period_interval: minutes. Map our interval strings → minutes
        _interval_map = {
            "1m": 1, "5m": 5, "15m": 15, "30m": 30,
            "1h": 60, "6h": 360, "1d": 1440, "max": 60,
        }
        period_interval = _interval_map.get(interval, 60)

        params = {
            "start_ts":       start_ts,
            "end_ts":         end_ts,
            "period_interval": period_interval,
        }
        resp = await self._client.get(
            f"{KALSHI_BASE}/markets/{ticker}/candlesticks",
            params=params,
        )
        resp.raise_for_status()
        candles = resp.json().get("candlesticks", [])

        return [
            {"t": int(c["end_period_ts"]), "p": round(c["yes_price"] / 100, 4)}
            for c in candles
            if c.get("yes_price") is not None
        ]

    # ── Live feed ────────────────────────────────────────────────────────────

    async def get_order_book(self, market_id: str, token_id: Optional[str] = None) -> dict:
        ticker = token_id or market_id
        try:
            resp = await self._client.get(f"{KALSHI_BASE}/orderbook/{ticker}")
            resp.raise_for_status()
            ob = resp.json().get("orderbook", {})
            # yes bids/asks come as [[price_cents, qty], ...]
            bids = [{"price": p / 100, "size": float(q)} for p, q in (ob.get("yes", []) or [])]
            asks = [{"price": p / 100, "size": float(q)} for p, q in (ob.get("no",  []) or [])]
            # Sort: bids descending, asks ascending
            bids.sort(key=lambda x: -x["price"])
            asks.sort(key=lambda x:  x["price"])
            return {"bids": bids, "asks": asks}
        except Exception as exc:
            log.warning("Kalshi order book failed %s: %s", ticker, exc)
            return {"bids": [], "asks": []}

    async def get_recent_trades(self, market_id: str, token_id: Optional[str] = None, limit: int = 20) -> list:
        # Kalshi trades endpoint requires auth; return empty for public access
        return []

    async def get_last_price(self, market_id: str, token_id: Optional[str] = None) -> Optional[float]:
        ticker = token_id or market_id
        try:
            resp = await self._client.get(f"{KALSHI_BASE}/markets/{ticker}")
            resp.raise_for_status()
            m = resp.json().get("market", {})
            lp = m.get("last_price")
            return lp / 100 if lp is not None else None
        except Exception:
            return None

    async def close(self):
        await self._client.aclose()


# ── Singleton ─────────────────────────────────────────────────────────────────

_kalshi_client: Optional[KalshiClient] = None

def get_kalshi_client() -> KalshiClient:
    global _kalshi_client
    if _kalshi_client is None:
        from ..config import settings
        _kalshi_client = KalshiClient(
            api_key=getattr(settings, "kalshi_api_key", None),
        )
    return _kalshi_client
