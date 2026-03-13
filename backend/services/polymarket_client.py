"""
Polymarket API client — wraps public CLOB and Gamma APIs.
Structured with hooks for authenticated endpoints when an account is added.
"""

import asyncio
import json
import logging
import time
import httpx
from typing import Optional

from .base_client import BaseExchangeClient

log = logging.getLogger(__name__)

CLOB_BASE  = "https://clob.polymarket.com"
GAMMA_BASE = "https://gamma-api.polymarket.com"

# ── Category helpers (imported by kalshi_client and manifold_client) ──────────

_TAG_MAP: dict[str, str] = {
    "politics": "Politics", "elections": "Politics", "election": "Politics",
    "us elections": "Politics", "2024 elections": "Politics", "2026 elections": "Politics",
    "donald trump": "Politics", "joe biden": "Politics", "kamala harris": "Politics",
    "republican": "Politics", "democrat": "Politics", "democrats": "Politics",
    "congress": "Politics", "senate": "Politics", "house": "Politics",
    "government": "Politics", "geopolitics": "Politics", "world leaders": "Politics",
    "uk politics": "Politics", "eu politics": "Politics", "nato": "Politics",
    "supreme court": "Politics", "white house": "Politics",
    "bitcoin": "Crypto", "ethereum": "Crypto", "crypto": "Crypto",
    "cryptocurrency": "Crypto", "defi": "Crypto", "nft": "Crypto",
    "blockchain": "Crypto", "solana": "Crypto", "dogecoin": "Crypto",
    "xrp": "Crypto", "altcoins": "Crypto", "web3": "Crypto", "stablecoins": "Crypto",
    "sports": "Sports", "nba": "Sports", "nfl": "Sports", "mlb": "Sports",
    "nhl": "Sports", "soccer": "Sports", "football": "Sports", "basketball": "Sports",
    "baseball": "Sports", "tennis": "Sports", "golf": "Sports",
    "ufc": "Sports", "mma": "Sports", "boxing": "Sports",
    "world cup": "Sports", "super bowl": "Sports", "formula 1": "Sports", "f1": "Sports",
    "premier league": "Sports", "champions league": "Sports", "olympics": "Sports",
    "economics": "Economics", "economy": "Economics", "finance": "Economics",
    "federal reserve": "Economics", "fed": "Economics", "inflation": "Economics",
    "gdp": "Economics", "stocks": "Economics", "recession": "Economics",
    "interest rates": "Economics", "forex": "Economics", "oil": "Economics",
    "science": "Science & Tech", "technology": "Science & Tech", "tech": "Science & Tech",
    "ai": "Science & Tech", "artificial intelligence": "Science & Tech",
    "spacex": "Science & Tech", "nasa": "Science & Tech", "space": "Science & Tech",
    "climate": "Science & Tech", "health": "Science & Tech", "biotech": "Science & Tech",
    "openai": "Science & Tech", "chatgpt": "Science & Tech",
    "entertainment": "Pop Culture", "pop culture": "Pop Culture",
    "movies": "Pop Culture", "film": "Pop Culture", "music": "Pop Culture",
    "awards": "Pop Culture", "oscars": "Pop Culture", "celebrity": "Pop Culture",
    "tv": "Pop Culture", "gaming": "Pop Culture", "streaming": "Pop Culture",
}


def _category_from_tags(tags: list[str]) -> str:
    for tag in tags:
        hit = _TAG_MAP.get(tag.lower().strip())
        if hit:
            return hit
    return "Other"


def _categorize_from_text(text: str) -> str:
    s = text.lower()
    if any(k in s for k in ["election", "president", "politic", "congress", "senate", "vote",
        "trump", "biden", "harris", "democrat", "republican", "white house",
        "supreme court", "nato", "geopolit"]):
        return "Politics"
    if any(k in s for k in ["bitcoin", "btc", "ethereum", "eth", "crypto", "solana",
        "doge", "nft", "blockchain", "defi", "coin", "xrp", "web3"]):
        return "Crypto"
    if any(k in s for k in ["nba", "nfl", "mlb", "nhl", "soccer", "football", "basketball",
        "baseball", "tennis", "golf", "ufc", "mma", "boxing", "championship",
        "world cup", "super bowl", "formula 1", " f1 ", "premier league",
        "champions league", "olympics", "ncaa", "esport"]):
        return "Sports"
    if any(k in s for k in ["federal reserve", " fed ", "gdp", "inflation", "recession",
        "stock market", "interest rate", "nasdaq", "s&p", "economy", "economic",
        "tariff", "trade war", "oil price", "gold price"]):
        return "Economics"
    if any(k in s for k in [" ai ", "artificial intelligence", "chatgpt", "openai", "gpt",
        "spacex", "nasa", "tech ", "apple ", "google ", "microsoft ", "nvidia ",
        "climate change", "vaccine", "biotech", "drug approval"]):
        return "Science & Tech"
    if any(k in s for k in ["oscar", "grammy", "emmy", "celebrity", "movie ", "film ",
        "music ", "entertainment", "award", "taylor swift", "box office",
        "television", "streaming", "gaming"]):
        return "Pop Culture"
    return "Other"


class PolymarketClient(BaseExchangeClient):
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

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_market(self, m: dict) -> dict:
        """Map Gamma API market dict → common MarketSummary dict."""
        try:
            prices = json.loads(m["outcomePrices"]) if isinstance(m.get("outcomePrices"), str) else m.get("outcomePrices", [])
            prob = float(prices[0]) if prices else 0.5
        except (TypeError, ValueError, IndexError):
            prob = 0.5

        resolved = bool(m.get("closed") or m.get("resolved"))
        outcome = m.get("winningOutcome") or (
            "YES" if prob >= 0.99 else "NO" if prob <= 0.01 else None
        ) if resolved else None

        events = m.get("events") or []
        event_tags: list[str] = []
        if events and isinstance(events, list):
            ev = events[0]
            raw_tags = ev.get("tags") or []
            if raw_tags:
                event_tags = [t["label"] if isinstance(t, dict) else str(t) for t in raw_tags]

        category = _category_from_tags(event_tags)
        if category == "Other":
            category = _categorize_from_text(m.get("question") or "")
        if category == "Other":
            slug = m.get("slug") or ""
            for ev in events:
                slug = slug or (ev.get("slug") or ev.get("ticker") or "")
            category = _categorize_from_text(slug)

        token_id = None
        raw_ids = m.get("clobTokenIds")
        if raw_ids:
            try:
                ids = json.loads(raw_ids) if isinstance(raw_ids, str) else raw_ids
                token_id = ids[0] if ids else None
            except Exception:
                pass

        end_date = (m.get("endDate") or "")[:10]

        return {
            "id":           m.get("conditionId", str(m.get("id", ""))),
            "condition_id": m.get("conditionId"),
            "token_id":     token_id,
            "title":        m.get("question", ""),
            "category":     category,
            "prob":         prob,
            "volume":       float(m.get("volumeNum") or m.get("volume") or 0),
            "liquidity":    float(m.get("liquidity") or 0),
            "resolved":     resolved,
            "outcome":      outcome,
            "end_date":     end_date,
            "tags":         event_tags,
            "exchange":     "polymarket",
        }

    # ── Single market (CLOB API — includes token IDs for price history) ──────

    async def get_market(self, condition_id: str) -> dict:
        resp = await self._client.get(f"{CLOB_BASE}/markets/{condition_id}")
        resp.raise_for_status()
        return resp.json()

    # ── Price history (CLOB API) ─────────────────────────────────────────────

    async def get_price_history(
        self,
        market_id: str,
        token_id: Optional[str] = None,
        interval: str = "max",
        start_ts: Optional[int] = None,
        end_ts: Optional[int] = None,
        fidelity: int = 60,
    ) -> list:
        tid = token_id or market_id
        params: dict = {"market": tid, "interval": interval, "fidelity": fidelity}
        if start_ts:
            params["startTs"] = start_ts
        if end_ts:
            params["endTs"] = end_ts

        resp = await self._client.get(f"{CLOB_BASE}/prices-history", params=params)
        resp.raise_for_status()
        return resp.json().get("history", [])

    # ── Batch price history (concurrent) ────────────────────────────────────

    async def fetch_market_histories_batch(
        self,
        token_ids: list[str],
        interval: str = "max",
        fidelity: int = 60,
    ) -> tuple[dict[str, list], float]:
        """
        Fetch price history for multiple markets concurrently via asyncio.gather.

        Returns (results, elapsed_ms) where results maps token_id → history list.
        Per-market failures are logged as warnings and stored as [] without
        aborting the rest of the batch.
        """
        log.info("batch fetch: %d token(s), interval=%s", len(token_ids), interval)
        t0 = time.perf_counter()

        async def _safe_fetch(token_id: str) -> tuple[str, list]:
            try:
                history = await self.get_price_history(
                    token_id, interval=interval, fidelity=fidelity
                )
                return token_id, history
            except Exception as exc:
                log.warning("batch fetch: token %s failed — %s", token_id, exc)
                return token_id, []

        pairs: list[tuple[str, list]] = await asyncio.gather(
            *(_safe_fetch(tid) for tid in token_ids)
        )

        elapsed_ms = (time.perf_counter() - t0) * 1000
        succeeded = sum(1 for _, h in pairs if h)
        log.info(
            "batch fetch complete: %d/%d succeeded in %.0f ms",
            succeeded, len(token_ids), elapsed_ms,
        )
        return dict(pairs), elapsed_ms

    # ── Tags ─────────────────────────────────────────────────────────────────

    async def get_tags(self) -> list:
        resp = await self._client.get(f"{GAMMA_BASE}/tags")
        resp.raise_for_status()
        return resp.json()

    # ── Live market data (public CLOB) ──────────────────────────────────────

    async def get_order_book(self, token_id: str) -> dict:
        """Returns {bids: [{price, size}], asks: [{price, size}]}."""
        resp = await self._client.get(f"{CLOB_BASE}/book", params={"token_id": token_id})
        resp.raise_for_status()
        data = resp.json()
        return {
            "bids": [{"price": float(b["price"]), "size": float(b["size"])} for b in data.get("bids", [])],
            "asks": [{"price": float(a["price"]), "size": float(a["size"])} for a in data.get("asks", [])],
        }

    async def get_recent_trades(self, token_id: str, limit: int = 20) -> list:
        """Returns recent matched trades for a token."""
        resp = await self._client.get(
            f"{CLOB_BASE}/trades",
            params={"token_id": token_id, "limit": limit},
        )
        resp.raise_for_status()
        data = resp.json()
        trades = data.get("data", data) if isinstance(data, dict) else data
        return [
            {
                "price":      float(t.get("price", 0)),
                "size":       float(t.get("size", 0)),
                "side":       t.get("side", ""),
                "match_time": t.get("match_time") or t.get("last_update") or "",
            }
            for t in trades[:limit]
        ]

    async def get_last_price(self, token_id: str) -> Optional[float]:
        try:
            resp = await self._client.get(f"{CLOB_BASE}/last-trade-price", params={"token_id": token_id})
            resp.raise_for_status()
            return float(resp.json().get("price", 0))
        except Exception:
            return None

    async def get_midpoint(self, token_id: str) -> Optional[float]:
        try:
            resp = await self._client.get(f"{CLOB_BASE}/midpoint", params={"token_id": token_id})
            resp.raise_for_status()
            return float(resp.json().get("mid", 0))
        except Exception:
            return None

    async def get_market_snapshot(self, token_id: str, condition_id: str) -> dict:
        """Single call that fetches order book, recent trades, last price, and market status concurrently."""
        import asyncio

        book_task    = asyncio.create_task(self._safe(self.get_order_book(token_id),    {"bids": [], "asks": []}))
        trades_task  = asyncio.create_task(self._safe(self.get_recent_trades(token_id), []))
        price_task   = asyncio.create_task(self._safe(self.get_last_price(token_id),    None))
        mid_task     = asyncio.create_task(self._safe(self.get_midpoint(token_id),      None))
        market_task  = asyncio.create_task(self._safe(self.get_market(condition_id),    {}))

        book, trades, last_price, midpoint, market = await asyncio.gather(
            book_task, trades_task, price_task, mid_task, market_task,
        )

        bids = book.get("bids", [])
        asks = book.get("asks", [])
        best_bid = bids[0]["price"] if bids else None
        best_ask = asks[0]["price"] if asks else None
        spread   = round(best_ask - best_bid, 4) if best_bid and best_ask else None

        return {
            "token_id":     token_id,
            "condition_id": condition_id,
            "last_price":   last_price,
            "midpoint":     midpoint,
            "best_bid":     best_bid,
            "best_ask":     best_ask,
            "spread":       spread,
            "bids":         bids[:10],
            "asks":         asks[:10],
            "recent_trades": trades,
            "market": {
                "title":    market.get("question") or market.get("title", ""),
                "active":   market.get("active", True),
                "closed":   market.get("closed", False),
                "end_date": market.get("end_date_iso") or market.get("endDateIso") or market.get("end_date", ""),
                "outcome":  market.get("outcome"),
            },
        }

    @staticmethod
    async def _safe(coro, default):
        try:
            return await coro
        except Exception:
            return default

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
        from ..config import settings
        _client = PolymarketClient(api_key=settings.api_key)
    return _client
