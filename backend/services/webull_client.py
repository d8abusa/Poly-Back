"""
Webull brokerage client — official Trading API (HMAC-SHA1).

Credentials (root .env):
    WEBULL_APP_KEY    = <app key from Webull OpenAPI Management>
    WEBULL_APP_SECRET = <app secret from Webull OpenAPI Management>
    WEBULL_ACCOUNT_ID = <numeric account id — retrieved once via /account/profile>

Auth:
    Every request is signed with HMAC-SHA1 via webullsdkcore.
    Signing is handled by calc_signature() from the installed SDK core package.

Market data:
    Live quotes  → Webull REST  GET /quotes/ticker/queryTickers
    Price history → Yahoo Finance (Webull history API requires separate mdata SDK
                    which can't install on Python 3.13 due to grpcio pin; Yahoo
                    provides identical US equity history and is already in use)

Order execution:
    POST /trade/order/place  on api.webull.com

Setup:
    1. Add WEBULL_APP_KEY and WEBULL_APP_SECRET to root .env
    2. Call GET /api/webull/account to fetch and confirm your account_id
    3. Add WEBULL_ACCOUNT_ID to root .env
"""

import asyncio
import json
import logging
import os
import uuid
from typing import Optional

import httpx

from .base_client import BaseExchangeClient
from .yahoo_client import YahooFinanceClient

log = logging.getLogger(__name__)

_BASE = "https://api.webull.com"
_QUOTES_BASE = "https://api.webull.com"


# ── HMAC-SHA1 signing ──────────────────────────────────────────────────────────
# Implemented directly — webullsdkcore's composer relies on vendored `six` which
# is missing from the installed package on Python 3.13.

def _sign_headers(method: str, uri: str, body: Optional[dict], queries: Optional[dict] = None, host: str = "") -> dict:
    """
    Build Webull-signed request headers (HMAC-SHA1).

    Algorithm (from webullsdkcore source):
      1. Collect sign_params: lowercased sign headers + query params
      2. If body: body_string = MD5_hex(compact_json(body)).upper()
      3. string_to_sign = uri + "&" + sorted_kv_pairs [ + "&" + body_string ]
      4. string_to_sign = url_quote(string_to_sign, safe='')
      5. signature = base64( HMAC-SHA1(secret + "&", string_to_sign) )
    """
    import hashlib
    import hmac
    import base64
    from datetime import datetime, timezone
    from urllib.parse import quote

    app_key    = os.getenv("WEBULL_APP_KEY", "")
    app_secret = os.getenv("WEBULL_APP_SECRET", "")
    if not app_key or not app_secret:
        raise RuntimeError("WEBULL_APP_KEY and WEBULL_APP_SECRET must be set in .env")

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    nonce     = str(uuid.uuid4())
    effective_host = host or _BASE.replace("https://", "")

    # Sign headers (these go into both the HTTP headers and the signature)
    sign_headers = {
        "x-app-key":             app_key,
        "x-timestamp":           timestamp,
        "x-signature-version":   "1.0",
        "x-signature-algorithm": "HMAC-SHA1",
        "x-signature-nonce":     nonce,
    }

    # sign_params = lowercased sign headers + host (lowercased) + query params (original case)
    sign_params: dict = {k.lower(): v for k, v in sign_headers.items()}
    sign_params["host"] = effective_host
    for k, v in (queries or {}).items():
        # Query params keep their original case (SDK does not lowercase them)
        sign_params[k] = f"{sign_params[k]}&{v}" if k in sign_params else str(v)

    # Body string (uppercase MD5 hex of compact JSON)
    body_string = None
    if body is not None:
        raw = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
        body_string = hashlib.md5(raw.encode("utf-8")).hexdigest().upper()

    # Build string to sign
    sorted_kv = "&".join(f"{k}={v}" for k, v in sorted(sign_params.items()))
    sts = uri + "&" + sorted_kv
    if body_string:
        sts += "&" + body_string
    sts_encoded = quote(sts, safe="")

    # HMAC-SHA1
    key    = (app_secret + "&").encode("utf-8")
    sig    = base64.b64encode(
        hmac.new(key, sts_encoded.encode("utf-8"), hashlib.sha1).digest()
    ).decode("utf-8").strip()

    headers: dict = {
        **sign_headers,
        "x-signature":    sig,
        "x-version":      "v2",
        "Content-Type":   "application/json;charset=utf-8",
        "Accept-Encoding": "gzip",
    }
    return headers


# ── Helpers ────────────────────────────────────────────────────────────────────

def _compact_json(obj: dict) -> str:
    """Compact JSON with no spaces — required by Webull signature verification."""
    return json.dumps(obj, separators=(",", ":"))


def _account_id() -> str:
    aid = os.getenv("WEBULL_ACCOUNT_ID", "").strip()
    if not aid:
        raise RuntimeError(
            "WEBULL_ACCOUNT_ID not set. "
            "Call GET /api/webull/account first to retrieve your account id."
        )
    return aid


# ── Yahoo singleton (price history fallback) ───────────────────────────────────

_yahoo: Optional[YahooFinanceClient] = None


def _get_yahoo() -> YahooFinanceClient:
    global _yahoo
    if _yahoo is None:
        _yahoo = YahooFinanceClient()
    return _yahoo


# ── Client ─────────────────────────────────────────────────────────────────────

class WebullClient(BaseExchangeClient):
    """
    Webull exchange client using the official Trading API.

    Market data  → Webull live quotes + Yahoo price history
    Order placement → Webull REST /trade/order/place
    """

    def __init__(self):
        self._yahoo = _get_yahoo()

    # ── Market listing ─────────────────────────────────────────────────────────

    async def search_markets(self, limit: int = 50, offset: int = 0, **kwargs) -> list[dict]:
        return await self._yahoo.search_markets(limit=limit, offset=offset, **kwargs)

    def normalize_market(self, raw: dict) -> dict:
        m = self._yahoo.normalize_market(raw)
        m["exchange"] = "webull"
        return m

    # ── Price history (Yahoo) ──────────────────────────────────────────────────

    async def get_price_history(
        self,
        market_id: str,
        token_id: Optional[str] = None,
        interval: str = "max",
        fidelity: int = 60,
    ) -> list[dict]:
        return await self._yahoo.get_price_history(
            market_id, token_id=token_id, interval=interval, fidelity=fidelity
        )

    # ── Live quote ─────────────────────────────────────────────────────────────

    async def get_last_price(
        self, market_id: str, token_id: Optional[str] = None
    ) -> Optional[float]:
        """
        Live quote from Webull /quotes/ticker/queryTickers.
        Falls back to Yahoo on any failure.
        """
        ticker = (token_id or market_id).upper().split("-")[0]
        uri    = "/quotes/ticker/queryTickers"
        params = {"tickers": ticker, "includeSecu": "1"}

        try:
            headers = _sign_headers("GET", uri, body=None, queries=params)
            url = f"{_QUOTES_BASE}{uri}"
            async with httpx.AsyncClient(timeout=6.0) as client:
                r = await client.get(url, headers=headers, params=params)
                r.raise_for_status()
                data = r.json()
                tickers = data.get("data") or data.get("tickerList") or []
                if tickers:
                    t = tickers[0]
                    price = t.get("close") or t.get("pPrice") or t.get("nPrice")
                    if price:
                        return float(price)
        except Exception as exc:
            log.debug("Webull live quote failed %s: %s — using Yahoo", ticker, exc)

        return await self._yahoo.get_last_price(market_id, token_id)

    # ── Account info ───────────────────────────────────────────────────────────

    async def get_account_info(self) -> dict:
        """Fetch account list and balance from Webull."""
        try:
            # Step 1: get account list (returns account_id + account_number)
            list_uri = "/openapi/account/list"
            headers  = _sign_headers("GET", list_uri, body=None)
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(f"{_BASE}{list_uri}", headers=headers)
                r.raise_for_status()
            accounts = r.json() if isinstance(r.json(), list) else [r.json()]
            if not accounts:
                return {"buying_power": 0.0, "portfolio_value": 0.0, "equity": 0.0, "cash": 0.0}
            acct    = accounts[0]
            acct_id = acct.get("account_id", "")

            # Step 2: get balance for this account_id
            bal_uri = "/account/balance"
            params  = {"account_id": acct_id, "total_asset_currency": "USD"}
            headers = _sign_headers("GET", bal_uri, body=None, queries=params)
            async with httpx.AsyncClient(timeout=8.0) as client:
                r2 = await client.get(f"{_BASE}{bal_uri}", headers=headers, params=params)
                r2.raise_for_status()
            bal = r2.json() if not isinstance(r2.json(), list) else (r2.json()[0] if r2.json() else {})

            # Balance is nested under account_currency_assets[0] (USD slot)
            usd = (bal.get("account_currency_assets") or [{}])[0]
            buying_power    = float(usd.get("cash_power",             bal.get("buying_power",    0)) or 0)
            portfolio_value = float(usd.get("net_liquidation_value",  bal.get("net_liquidation", 0)) or 0)
            cash            = float(usd.get("cash_balance",           bal.get("total_cash_balance", 0)) or 0)

            return {
                "account_id":      acct_id,
                "account_number":  acct.get("account_number", ""),
                "account_type":    acct.get("account_type", ""),
                "buying_power":    buying_power,
                "portfolio_value": portfolio_value,
                "equity":          portfolio_value,
                "cash":            cash,
            }
        except Exception as exc:
            log.warning("Webull account info failed: %s", exc)
            return {"buying_power": 0.0, "portfolio_value": 0.0, "equity": 0.0, "cash": 0.0}

    # ── Order placement ────────────────────────────────────────────────────────

    async def place_order(
        self,
        product_id: str,
        side: str,
        size: float,
        limit_price: Optional[float] = None,
        client_order_id: Optional[str] = None,
        **kwargs,
    ) -> dict:
        """
        Place a stock order via the Webull Trading API.

        product_id  : ticker symbol — "NVDA", "AAPL", or "NVDA-USD" (base extracted)
        side        : "BUY" or "SELL"
        size        : number of shares (integer for Webull; fractional via qty string)
        limit_price : optional — omit for market order
        """
        ticker  = product_id.upper().split("-")[0]
        acct_id = _account_id()
        coid    = client_order_id or str(uuid.uuid4()).replace("-", "")[:40]
        uri     = "/trade/order/place"

        # Webull requires instrument_id (numeric) — look it up first
        instrument_id = await self._get_instrument_id(ticker)
        if not instrument_id:
            return {"order_id": None, "status": "error",
                    "note": f"Could not resolve instrument_id for {ticker}"}

        order_type = "LMT" if limit_price else "MKT"
        body: dict = {
            "account_id":              acct_id,
            "client_order_id":         coid,
            "side":                    side.upper(),
            "tif":                     "DAY",
            "extended_hours_trading":  False,
            "instrument_id":           str(instrument_id),
            "order_type":              order_type,
            "qty":                     str(int(size)),
        }
        if limit_price:
            body["limit_price"] = str(limit_price)

        try:
            headers = _sign_headers("POST", uri, body=body)
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.post(
                    f"{_BASE}{uri}",
                    headers=headers,
                    content=_compact_json(body),
                )
                r.raise_for_status()
                resp = r.json()
                returned_coid = resp.get("client_order_id", coid)
                log.info(
                    "Webull %s %s %d shares @ %s  client_order_id=%s",
                    side, ticker, int(size), limit_price or "MKT", returned_coid,
                )
                return {
                    "order_id": returned_coid,
                    "status":   "submitted",
                    "note":     f"Webull {side} {int(size)} {ticker} @ {limit_price or 'MKT'}",
                }
        except httpx.HTTPStatusError as exc:
            body_text = exc.response.text
            log.error("Webull place_order HTTP %s: %s", exc.response.status_code, body_text)
            return {"order_id": None, "status": "error", "note": body_text}
        except Exception as exc:
            log.error("Webull place_order failed: %s %s — %s", side, ticker, exc)
            return {"order_id": None, "status": "error", "note": str(exc)}

    # ── Instrument ID lookup ───────────────────────────────────────────────────

    async def _get_instrument_id(self, ticker: str) -> Optional[str]:
        """Resolve ticker symbol to Webull numeric instrument_id."""
        uri    = "/quotes/ticker/queryTickers"
        params = {"tickers": ticker, "includeSecu": "1"}
        try:
            headers = _sign_headers("GET", uri, body=None, queries=params)
            async with httpx.AsyncClient(timeout=6.0) as client:
                r = await client.get(f"{_QUOTES_BASE}{uri}", headers=headers, params=params)
                r.raise_for_status()
                data    = r.json()
                tickers = data.get("data") or data.get("tickerList") or []
                if tickers:
                    return str(tickers[0].get("tickerId") or tickers[0].get("instrumentId") or "")
        except Exception as exc:
            log.debug("Webull instrument_id lookup failed %s: %s", ticker, exc)
        return None


# ── Singleton factory ──────────────────────────────────────────────────────────

_client: Optional[WebullClient] = None


def get_webull_client() -> WebullClient:
    global _client
    if _client is None:
        _client = WebullClient()
    return _client
