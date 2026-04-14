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

# Coinbase reserves base_size × limit_price + fees upfront for limit_limit_gtc orders.
# Standard taker fee is 0.6%; we use 1.5% to also absorb any account holds or rounding.
# Configurable via COINBASE_FEE_BUFFER env var.
_FEE_BUFFER = float(os.getenv("COINBASE_FEE_BUFFER", "0.015"))

# Well-known crypto base currencies — anything not in this set is treated as a stock
_CRYPTO_BASES = {
    "BTC","ETH","SOL","ADA","AVAX","DOGE","MATIC","LINK","DOT","ATOM","XRP",
    "LTC","BCH","UNI","AAVE","CRV","SNX","MKR","COMP","YFI","SUSHI","1INCH",
    "GRT","FIL","ICP","NEAR","ALGO","XLM","EOS","TRX","VET","THETA","FTM",
    "SAND","MANA","AXS","ENJ","CHZ","BAT","ZRX","OMG","LRC","SKL","STORJ",
    "NKN","CELO","ANKR","REN","BAND","KNC","BAL","OCEAN","PERP","RARI",
    "SHIB","APE","GMT","GAL","IMX","OP","ARB","BLUR","PEPE","WLD","PYTH",
    "TIA","STRK","MANTA","PIXEL","PORTAL","TNSR","SAGA","ZETA","OMNI",
    "REZ","ETHFI","ENS","PENDLE","W","IO","ZK","BLAST","NOT","LISTA","ZRO",
    "EIGEN","GRASS","GOAT","PNUT","ACT","HYPE","VIRTUAL","AI16Z","FARTCOIN",
    "USDC","USDT","DAI","BUSD","TUSD","USDP","GUSD","FRAX","LUSD",
    "WBTC","STETH","RETH","CBETH","WETH",
}


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
        self._precision_cache: dict[str, tuple[int, int]] = {}

    @staticmethod
    def _increment_decimals(increment: str) -> int:
        """'0.00001' → 5, '1' → 0, '0.01' → 2."""
        if not increment or increment == "1":
            return 0
        if "." in increment:
            return len(increment.rstrip("0").split(".")[1])
        return 0

    @staticmethod
    def _fmt(value: float, decimals: int) -> str:
        """Format a float to exactly `decimals` decimal places (no trailing dot for 0)."""
        if decimals == 0:
            return str(int(round(value, 0)))
        return f"{value:.{decimals}f}"

    async def _get_precision(self, product_id: str) -> tuple[int, int]:
        """Return (base_decimals, price_decimals) for a product, cached per session."""
        if product_id in self._precision_cache:
            return self._precision_cache[product_id]
        path = f"/products/{product_id}"
        try:
            resp = await self._client.get(
                f"{COINBASE_BASE}{path}", headers=self._auth_headers("GET", path)
            )
            data = resp.json()
            base_dec  = self._increment_decimals(data.get("base_increment",  "0.00000001"))
            quote_dec = self._increment_decimals(data.get("quote_increment", "0.01"))
        except Exception as exc:
            log.warning("Could not fetch precision for %s: %s — using defaults", product_id, exc)
            base_dec, quote_dec = 8, 2
        self._precision_cache[product_id] = (base_dec, quote_dec)
        return base_dec, quote_dec

    def _auth_headers(self, method: str, path: str) -> dict:
        token = _build_jwt(method, path)
        return {"Authorization": f"Bearer {token}"}

    # ── Market listing ────────────────────────────────────────────────────────

    async def search_markets(
        self,
        limit: int = 50,
        offset: int = 0,
        category: Optional[str] = None,   # "crypto", "stocks", or None for all
        **kwargs,
    ) -> list[dict]:
        path = "/products"
        headers = self._auth_headers("GET", path)
        # Fetch a larger pool so we can filter and still return `limit` results
        fetch_n = min((limit + offset) * 3, 500)
        params = {"limit": fetch_n, "product_type": "SPOT"}
        resp = await self._client.get(f"{COINBASE_BASE}{path}", headers=headers, params=params)
        resp.raise_for_status()
        products = resp.json().get("products", [])

        # Sort by USD-denominated volume (approximate_quote_24h_volume) so BTC/ETH
        # rank above token-count-heavy meme coins (PEPE has 881B tokens but low USD vol)
        products.sort(key=lambda p: float(p.get("approximate_quote_24h_volume", 0) or 0), reverse=True)

        # Apply category filter if requested
        if category == "stocks":
            products = [p for p in products if p.get("base_currency_id", "").upper() not in _CRYPTO_BASES]
        elif category == "crypto":
            products = [p for p in products if p.get("base_currency_id", "").upper() in _CRYPTO_BASES]

        return products[offset:offset + limit]

    def normalize_market(self, raw: dict) -> dict:
        product_id = raw.get("product_id", "")
        base       = raw.get("base_currency_id", product_id.split("-")[0]).upper()
        price      = float(raw.get("price", 0) or 0)
        is_stock   = base not in _CRYPTO_BASES
        category   = "Stocks" if is_stock else "Crypto"

        # Derive prev_prob from 24h percentage change so volatility calcs work
        pct_str   = raw.get("price_percentage_change_24h") or raw.get("price_percentage_change_24H")
        prev_prob = None
        if pct_str is not None and price > 0:
            try:
                pct = float(pct_str)
                if pct != -100:
                    prev_prob = round(price / (1 + pct / 100), 8)
            except (ValueError, ZeroDivisionError):
                pass

        return {
            "id":           product_id,
            "condition_id": product_id,
            "token_id":     product_id,
            "title":        raw.get("display_name") or product_id,
            "category":     category,
            "prob":         round(price, 8),
            "prev_prob":    prev_prob,
            "volume":       float(raw.get("volume_24h", 0) or 0),
            "liquidity":    0.0,
            "resolved":     False,
            "outcome":      None,
            "end_date":     "",
            "tags":         [category],
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
            pts = [{"t": int(c["start"]), "p": round(float(c["close"]), 8)} for c in candles if c.get("close")]
            return sorted(pts, key=lambda x: x["t"])
        except Exception as exc:
            log.warning("Coinbase price history failed %s: %s", product, exc)
            return []

    # ── Live price ────────────────────────────────────────────────────────────

    async def get_last_price(self, market_id: str, token_id: Optional[str] = None) -> Optional[float]:
        """Return the latest trade price for a product (e.g. 'ETH-USD')."""
        product = token_id or market_id
        path    = f"/products/{product}"
        try:
            resp = await self._client.get(
                f"{COINBASE_BASE}{path}",
                headers=self._auth_headers("GET", path),
            )
            resp.raise_for_status()
            price = resp.json().get("price")
            return float(price) if price else None
        except Exception as exc:
            log.warning("Coinbase get_last_price failed %s: %s", product, exc)
            return None

    # ── Live feed snapshot ────────────────────────────────────────────────────

    async def get_market_snapshot(self, market_id: str, token_id: Optional[str] = None) -> dict:
        """Snapshot: last price from /products, best bid/ask from /best_bid_ask."""
        import asyncio as _asyncio
        product = token_id or market_id
        prod_path = f"/products/{product}"
        bbo_path  = "/best_bid_ask"

        prod_resp, bbo_resp = await _asyncio.gather(
            self._client.get(f"{COINBASE_BASE}{prod_path}", headers=self._auth_headers("GET", prod_path)),
            self._client.get(f"{COINBASE_BASE}{bbo_path}",  headers=self._auth_headers("GET", bbo_path),
                             params={"product_ids": [product]}),
            return_exceptions=True,
        )
        try:
            data   = prod_resp.json() if not isinstance(prod_resp, Exception) else {}
            price  = float(data.get("price") or 0) or None
            active = not data.get("is_disabled", False) and not data.get("trading_disabled", False)
            title  = data.get("display_name") or product
        except Exception:
            price, active, title = None, True, product

        bid = ask = None
        bids_list = asks_list = []
        try:
            pb = bbo_resp.json().get("pricebooks", [{}])[0] if not isinstance(bbo_resp, Exception) else {}
            raw_bids = pb.get("bids", [])
            raw_asks = pb.get("asks", [])
            if raw_bids:
                bid = float(raw_bids[0]["price"])
                bids_list = [{"price": float(b["price"]), "size": float(b["size"])} for b in raw_bids[:5]]
            if raw_asks:
                ask = float(raw_asks[0]["price"])
                asks_list = [{"price": float(a["price"]), "size": float(a["size"])} for a in raw_asks[:5]]
        except Exception:
            pass

        mid    = round((bid + ask) / 2, 8) if bid and ask else price
        spread = round(ask - bid, 8) if bid and ask else None
        return {
            "token_id":      product,
            "condition_id":  market_id,
            "last_price":    price,
            "midpoint":      mid,
            "best_bid":      bid,
            "best_ask":      ask,
            "spread":        spread,
            "bids":          bids_list,
            "asks":          asks_list,
            "recent_trades": [],
            "market": {
                "title":    title,
                "active":   active,
                "closed":   data.get("status") == "delisted" if isinstance(data, dict) else False,
                "end_date": "",
                "outcome":  None,
            },
        }

    # ── Order placement ───────────────────────────────────────────────────────

    async def place_order(
        self,
        product_id: str,
        side: str,
        size: float,
        limit_price: Optional[float] = None,
        client_order_id: Optional[str] = None,
        quote_size: Optional[float] = None,   # USD amount for market BUY (avoids base_size precision issues)
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

        base_dec, price_dec = await self._get_precision(product_id)

        if limit_price is not None and limit_price > 0:
            # For BUY limit orders, reduce base_size by the fee buffer so that
            # base_size × limit_price + fees fits within the available balance.
            effective_size = size * (1 - _FEE_BUFFER) if side.upper() == "BUY" else size
            body["order_configuration"] = {
                "limit_limit_gtc": {
                    "base_size":   self._fmt(effective_size, base_dec),
                    "limit_price": self._fmt(limit_price, price_dec),
                }
            }
        elif quote_size is not None:
            # Market BUY with USD amount — cleaner than base_size for IOC orders
            body["order_configuration"] = {
                "market_market_ioc": {"quote_size": self._fmt(quote_size, 2)}
            }
        else:
            body["order_configuration"] = {
                "market_market_ioc": {"base_size": self._fmt(size, base_dec)}
            }

        try:
            resp = await self._client.post(f"{COINBASE_BASE}{path}", headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()

            # Coinbase returns HTTP 200 even for rejected orders — must check success flag
            if not data.get("success", True):
                err = data.get("error_response", {})
                note = err.get("preview_failure_reason") or err.get("message") or err.get("error") or str(data)
                log.error("Coinbase order rejected %s: %s", product_id, note)
                return {"order_id": order_id, "status": "error", "note": note}

            order = data.get("success_response", data)
            return {
                "order_id": order.get("order_id", order_id),
                "status":   "submitted",
                "note":     f"Coinbase order placed: {product_id} {side} {size}",
            }
        except httpx.HTTPStatusError as exc:
            log.error("Coinbase order failed %s: %s — %s", product_id, exc.response.status_code, exc.response.text)
            return {"order_id": order_id, "status": "error", "note": exc.response.text}

    async def get_account_balance(self, currency: str) -> Optional[float]:
        """Return the available balance for a given currency (e.g. 'ETH').
        Returns None if the account isn't found or the call fails."""
        path    = "/accounts"
        headers = self._auth_headers("GET", path)
        try:
            resp = await self._client.get(f"{COINBASE_BASE}{path}", headers=headers)
            if not resp.is_success:
                log.error("Coinbase get_accounts HTTP %s: %s", resp.status_code, resp.text[:200])
                return None
            data     = resp.json()
            accounts = data.get("accounts", [])
            log.debug("Coinbase accounts returned %d entries", len(accounts))
            for acct in accounts:
                if acct.get("currency") == currency.upper():
                    avail = acct.get("available_balance", {}).get("value")
                    log.info("Coinbase %s available_balance=%s", currency, avail)
                    return float(avail) if avail is not None else None
            log.warning("Coinbase: no %s account found in %d accounts", currency, len(accounts))
        except Exception as exc:
            log.error("Coinbase get_accounts failed: %s", exc)
        return None

    async def get_order(self, order_id: str) -> Optional[dict]:
        """Fetch a single order's status from Coinbase historical orders."""
        path = f"/orders/historical/{order_id}"
        try:
            resp = await self._client.get(
                f"{COINBASE_BASE}{path}", headers=self._auth_headers("GET", path)
            )
            resp.raise_for_status()
            return resp.json().get("order")
        except Exception as exc:
            log.warning("Coinbase get_order failed %s: %s", order_id, exc)
            return None

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
