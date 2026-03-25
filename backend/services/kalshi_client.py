"""
Kalshi exchange client — wraps the Kalshi v2 Trading API.
Kalshi is a CFTC-regulated US prediction market exchange.

Public endpoints: no authentication required.
Authenticated endpoints (order placement): RSA-PSS signed headers.

Auth headers for private endpoints:
    KALSHI-ACCESS-KEY       — API key UUID
    KALSHI-ACCESS-TIMESTAMP — epoch milliseconds (string)
    KALSHI-ACCESS-SIGNATURE — base64(RSA-PSS-SHA256(key, ts + METHOD + path))

Required env vars:
    KALSHI_API_KEY      — UUID API key
    KALSHI_PRIVATE_KEY  — PEM RSA private key (literal \\n newlines)

API base: https://api.elections.kalshi.com/trade-api/v2
Docs:     https://trading-api.kalshi.com/docs
"""

import base64
import logging
import time as _time
import uuid
from typing import Optional

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

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


def _build_kalshi_signature(
    method: str,
    path: str,
    timestamp_ms: int,
    private_key_pem: str,
) -> str:
    """
    Sign the canonical message for Kalshi API auth.
    Message = str(timestamp_ms) + METHOD_UPPER + path
    Algorithm: RSA-PSS, SHA-256, MGF1-SHA256, salt=digest length
    """
    pem_bytes = private_key_pem.replace("\\n", "\n").encode()
    private_key = serialization.load_pem_private_key(pem_bytes, password=None)
    message = f"{timestamp_ms}{method.upper()}{path}".encode("utf-8")
    signature = private_key.sign(
        message,
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.DIGEST_LENGTH,
        ),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode("utf-8")


class KalshiClient(BaseExchangeClient):
    def __init__(
        self,
        api_key: Optional[str] = None,
        api_password: Optional[str] = None,
        private_key: Optional[str] = None,
    ):
        headers = {"User-Agent": "PolyBack/1.0", "Accept": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._client      = httpx.AsyncClient(timeout=30.0, headers=headers)
        self._api_key     = api_key
        self._private_key = private_key  # PEM string with literal \n

    def _auth_headers(self, method: str, path: str) -> dict:
        """Build RSA-PSS signed headers for authenticated Kalshi endpoints."""
        if not self._api_key or not self._private_key:
            log.warning("Kalshi auth headers requested but credentials missing")
            return {}
        ts = int(_time.time() * 1000)
        try:
            sig = _build_kalshi_signature(method, path, ts, self._private_key)
        except Exception as exc:
            log.error("Kalshi signature build failed: %s", exc)
            return {}
        return {
            "KALSHI-ACCESS-KEY":       self._api_key,
            "KALSHI-ACCESS-TIMESTAMP": str(ts),
            "KALSHI-ACCESS-SIGNATURE": sig,
        }

    # ── Market listing ───────────────────────────────────────────────────────

    async def search_markets(
        self,
        limit: int = 50,
        offset: int = 0,
        status: str = "open",
        **kwargs,
    ) -> list[dict]:
        """
        Fetch real prediction markets via the /events endpoint with nested markets.
        The /markets endpoint returns parlay (KXMVE) markets only — useless for
        prediction market research. Real single-outcome markets live under /events.
        """
        params: dict = {
            "limit": min(limit + offset, 200),
            "status": status,
            "with_nested_markets": "true",
        }
        resp = await self._client.get(f"{KALSHI_BASE}/events", params=params)
        resp.raise_for_status()
        events = resp.json().get("events", [])

        # Flatten event → markets, attach event-level fields to each market
        flat: list[dict] = []
        for event in events:
            for market in event.get("markets", []):
                market.setdefault("category", event.get("category", ""))
                flat.append(market)

        # Sort by volume descending so callers get the most active first
        flat.sort(key=lambda m: float(m.get("volume_fp", 0) or 0), reverse=True)
        return flat[offset:offset + limit]

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
        try:
            resp = await self._client.get(f"{KALSHI_BASE}/markets/{ticker}/orderbook")
            resp.raise_for_status()
            ob = resp.json().get("orderbook_fp", {})
            # yes_dollars: bids for YES (probability of YES)
            # no_dollars: bids for NO; convert to YES ask = 1 - no_price
            bids = [{"price": _dollars_to_prob(p), "size": float(q)} for p, q in (ob.get("yes_dollars", []) or [])]
            asks = [{"price": round(1 - _dollars_to_prob(p), 4), "size": float(q)} for p, q in (ob.get("no_dollars",  []) or [])]
            bids.sort(key=lambda x: -x["price"])
            asks.sort(key=lambda x:  x["price"])
            return {"bids": bids, "asks": asks}
        except Exception as exc:
            log.warning("Kalshi order book failed %s: %s", ticker, exc)
            return {"bids": [], "asks": []}

    async def get_recent_trades(self, market_id: str, token_id: Optional[str] = None, limit: int = 20) -> list:
        # Kalshi trades require auth; return empty for public mode
        return []

    async def get_market_snapshot(self, market_id: str, token_id: Optional[str] = None) -> dict:
        """Combined snapshot: market info + orderbook in two parallel calls."""
        ticker = token_id or market_id
        import asyncio as _asyncio
        market_info, book = await _asyncio.gather(
            self._client.get(f"{KALSHI_BASE}/markets/{ticker}"),
            self.get_order_book(market_id, token_id),
            return_exceptions=True,
        )
        # Parse market info
        m = {}
        last_price = None
        bid = ask = None
        if not isinstance(market_info, Exception):
            try:
                market_info.raise_for_status()
                raw = market_info.json().get("market", {})
                last_price = _dollars_to_prob(raw.get("last_price_dollars")) or None
                bid = _dollars_to_prob(raw.get("yes_bid_dollars")) or None
                ask = _dollars_to_prob(raw.get("yes_ask_dollars")) or None
                m = {
                    "title":    raw.get("title") or ticker,
                    "active":   raw.get("status") == "active",
                    "closed":   raw.get("status") in ("finalized", "settled", "resolved"),
                    "end_date": raw.get("close_time", ""),
                    "outcome":  raw.get("result") or None,
                }
            except Exception as exc:
                log.warning("Kalshi market info failed %s: %s", ticker, exc)

        if isinstance(book, Exception):
            book = {"bids": [], "asks": []}

        bids = book.get("bids", [])
        asks = book.get("asks", [])
        best_bid = bid or (bids[0]["price"] if bids else None)
        best_ask = ask or (asks[0]["price"] if asks else None)
        mid      = round((best_bid + best_ask) / 2, 4) if best_bid and best_ask else last_price
        spread   = round(best_ask - best_bid, 4) if best_bid and best_ask else None
        return {
            "token_id":      ticker,
            "condition_id":  market_id,
            "last_price":    last_price,
            "midpoint":      mid,
            "best_bid":      best_bid,
            "best_ask":      best_ask,
            "spread":        spread,
            "bids":          bids[:10],
            "asks":          asks[:10],
            "recent_trades": [],
            "market":        m,
        }

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

    # ── Order placement ───────────────────────────────────────────────────────

    async def place_order(
        self,
        ticker: str,
        side: str,              # "yes" or "no"
        action: str,            # "buy" or "sell"
        count: int,             # number of contracts
        yes_price: int,         # limit price in cents (1–99); 0 for market
        order_type: str = "limit",
        client_order_id: Optional[str] = None,
    ) -> dict:
        """
        Place a limit or market order on Kalshi.

        Kalshi order body:
            ticker, action (buy/sell), side (yes/no), type (limit/market),
            count (contracts), yes_price (cents, only for limit orders)
        """
        path = "/portfolio/orders"
        auth = self._auth_headers("POST", path)
        if not auth:
            return {"order_id": "", "status": "error", "note": "Kalshi credentials not configured"}

        body: dict = {
            "ticker":          ticker,
            "action":          action.lower(),
            "side":            side.lower(),
            "type":            order_type,
            "count":           count,
            "client_order_id": client_order_id or uuid.uuid4().hex,
        }
        if order_type == "limit":
            body["yes_price"] = yes_price

        try:
            resp = await self._client.post(
                f"{KALSHI_BASE}{path}",
                headers=auth,
                json=body,
            )
            resp.raise_for_status()
            data  = resp.json()
            order = data.get("order", data)
            return {
                "order_id": order.get("order_id", body["client_order_id"]),
                "status":   "submitted",
                "note":     f"Kalshi order: {ticker} {action} {side} {count}ct @ {yes_price}¢",
            }
        except httpx.HTTPStatusError as exc:
            log.error(
                "Kalshi order failed %s: %s — %s",
                ticker, exc.response.status_code, exc.response.text,
            )
            return {
                "order_id": body["client_order_id"],
                "status":   "error",
                "note":     exc.response.text,
            }

    async def cancel_order(self, order_id: str) -> dict:
        path = f"/portfolio/orders/{order_id}"
        auth = self._auth_headers("DELETE", path)
        if not auth:
            return {"order_id": order_id, "status": "error", "note": "Kalshi credentials not configured"}
        try:
            resp = await self._client.delete(f"{KALSHI_BASE}{path}", headers=auth)
            resp.raise_for_status()
            return {"status": "cancelled", "order_id": order_id}
        except httpx.HTTPStatusError as exc:
            log.error("Kalshi cancel failed %s: %s — %s", order_id, exc.response.status_code, exc.response.text)
            return {"order_id": order_id, "status": "error", "note": exc.response.text}

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
            private_key=getattr(settings, "kalshi_private_key", None),
        )
    return _kalshi_client
