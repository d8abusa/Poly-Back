"""
Kalshi exchange client — wraps the Kalshi v2 Trading API.
Kalshi is a CFTC-regulated US prediction market exchange.

Public endpoints require no authentication.
Authenticated endpoints (order placement) require API key + password.

API base: https://api.elections.kalshi.com/trade-api/v2
Docs:     https://trading-api.kalshi.com/docs
"""

import logging
import time as _time
from typing import Optional

import httpx

from .base_client import BaseExchangeClient

log = logging.getLogger(__name__)

KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2"

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
    "World":          "Other",
}


def _map_kalshi_category(raw_cat: str | None) -> str:
    if not raw_cat:
        return "Other"
    return _KALSHI_CAT_MAP.get(raw_cat, "Other")


def _dollars_to_prob(val) -> float:
    """Convert a Kalshi _dollars string/float (0.0–1.0) to probability."""
    try:
        return float(val)
    except (TypeError, ValueError):
        return 0.0


def _series_from_ticker(ticker: str) -> str:
    """
    Derive series ticker from market/event ticker.
    e.g. 'KXELONMARS-99' → 'KXELONMARS'
         'KXNBAPTS-26MAR13CLEDAL-CLEJHARDEN1-15' → 'KXNBAPTS'
    """
    return ticker.split("-")[0]


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
        params: dict = {"limit": min(limit + offset, 200), "status": status}
        resp = await self._client.get(f"{KALSHI_BASE}/markets", params=params)
        resp.raise_for_status()
        markets = resp.json().get("markets", [])
        return markets[offset:offset + limit]

    def normalize_market(self, raw: dict) -> dict:
        ticker = raw.get("ticker", "")

        # New API uses _dollars fields (0.0–1.0 = probability directly)
        yes_bid = _dollars_to_prob(raw.get("yes_bid_dollars", 0))
        yes_ask = _dollars_to_prob(raw.get("yes_ask_dollars", 0))
        last_p  = _dollars_to_prob(raw.get("last_price_dollars", 0))

        if yes_bid > 0 and yes_ask > 0:
            prob = (yes_bid + yes_ask) / 2
        elif last_p > 0:
            prob = last_p
        else:
            prob = 0.5

        status   = raw.get("status", "")
        resolved = status in ("finalized", "settled", "closed")
        result   = raw.get("result", "")
        outcome  = None
        if resolved and result:
            outcome = "YES" if result.lower() == "yes" else "NO"

        close_time = raw.get("close_time") or raw.get("expected_expiration_time") or ""
        end_date   = close_time[:10] if close_time else ""

        # Category — Kalshi puts it on the event, not always the market
        category = _map_kalshi_category(raw.get("category"))
        if category == "Other":
            from .polymarket_client import _categorize_from_text
            category = _categorize_from_text(raw.get("title", ""))

        # Volume — new API uses volume_fp (floating point string)
        vol = float(raw.get("volume_fp", 0) or raw.get("volume", 0) or 0)
        liq = float(raw.get("liquidity_dollars", 0) or 0)

        return {
            "id":           ticker,
            "condition_id": ticker,
            "token_id":     ticker,
            "title":        raw.get("title") or raw.get("subtitle") or ticker,
            "category":     category,
            "prob":         round(prob, 4),
            "volume":       vol,
            "liquidity":    liq,
            "resolved":     resolved,
            "outcome":      outcome,
            "end_date":     end_date,
            "tags":         [raw.get("category")] if raw.get("category") else [],
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
        ticker      = token_id or market_id
        series      = _series_from_ticker(ticker)
        end_ts      = int(_time.time())
        start_ts    = end_ts - (2 * 365 * 24 * 3600)  # max = 2 years

        _interval_map = {
            "1m": 1, "5m": 5, "15m": 15, "30m": 30,
            "1h": 60, "6h": 360, "1d": 1440, "max": 1440,
        }
        period_interval = _interval_map.get(interval, 1440)

        params = {"start_ts": start_ts, "end_ts": end_ts, "period_interval": period_interval}
        url    = f"{KALSHI_BASE}/series/{series}/markets/{ticker}/candlesticks"

        resp = await self._client.get(url, params=params)
        resp.raise_for_status()
        candles = resp.json().get("candlesticks", [])

        result = []
        for c in candles:
            ts = c.get("end_period_ts")
            # New API: price.close_dollars (already 0–1)
            price_block = c.get("price", {})
            p = _dollars_to_prob(price_block.get("close_dollars") or price_block.get("mean_dollars"))
            if ts and p > 0:
                result.append({"t": int(ts), "p": round(p, 4)})

        return result

    # ── Live feed ────────────────────────────────────────────────────────────

    async def get_order_book(self, market_id: str, token_id: Optional[str] = None) -> dict:
        ticker = token_id or market_id
        series = _series_from_ticker(ticker)
        try:
            resp = await self._client.get(f"{KALSHI_BASE}/series/{series}/markets/{ticker}/orderbook")
            resp.raise_for_status()
            ob   = resp.json().get("orderbook", {})
            # New API: yes/no lists of [price_dollars_str, qty]
            bids = [{"price": _dollars_to_prob(p), "size": float(q)} for p, q in (ob.get("yes", []) or [])]
            asks = [{"price": _dollars_to_prob(p), "size": float(q)} for p, q in (ob.get("no",  []) or [])]
            bids.sort(key=lambda x: -x["price"])
            asks.sort(key=lambda x:  x["price"])
            return {"bids": bids, "asks": asks}
        except Exception as exc:
            log.warning("Kalshi order book failed %s: %s", ticker, exc)
            return {"bids": [], "asks": []}

    async def get_recent_trades(self, market_id: str, token_id: Optional[str] = None, limit: int = 20) -> list:
        # Kalshi trades require auth; return empty for public mode
        return []

    async def get_last_price(self, market_id: str, token_id: Optional[str] = None) -> Optional[float]:
        ticker = token_id or market_id
        try:
            resp = await self._client.get(f"{KALSHI_BASE}/markets/{ticker}")
            resp.raise_for_status()
            m = resp.json().get("market", resp.json())
            lp = m.get("last_price_dollars")
            return _dollars_to_prob(lp) if lp is not None else None
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
