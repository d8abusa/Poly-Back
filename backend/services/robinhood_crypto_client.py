"""
Robinhood Crypto Trading Client
================================
Uses Robinhood's official Crypto Trading API (Ed25519 signing).
Separate from the robin_stocks stock client — different auth, different endpoints.

Setup (backend/.env):
    ROBINHOOD_CRYPTO_API_KEY=<key name assigned by Robinhood after registering public key>
    ROBINHOOD_CRYPTO_PRIVATE_KEY=<base64-encoded Ed25519 private key>

Key generation (one-time):
    python3 -c "
    import nacl.signing, base64
    pk = nacl.signing.SigningKey.generate()
    print('Private:', base64.b64encode(pk.encode()).decode())
    print('Public:', base64.b64encode(pk.verify_key.encode()).decode())
    "
    → Register the Public key at https://robinhood.com/account/crypto-api-keys
    → Robinhood assigns a key name — put that in ROBINHOOD_CRYPTO_API_KEY

Signature scheme:
    message  = api_key + timestamp + path + method.upper() + body
    signature = base64( ed25519_sign(message) )
    Headers: x-api-key, x-signature, x-timestamp
"""

import base64
import logging
import os
import time
import uuid
from typing import Optional

import httpx

log = logging.getLogger(__name__)

_BASE = "https://trading.robinhood.com"


def _credentials() -> tuple[str, bytes]:
    """Return (api_key, raw_private_key_bytes). Raises if not configured."""
    api_key = os.getenv("ROBINHOOD_CRYPTO_API_KEY", "").strip()
    priv_b64 = os.getenv("ROBINHOOD_CRYPTO_PRIVATE_KEY", "").strip()
    if not api_key or not priv_b64:
        raise RuntimeError(
            "Robinhood Crypto API not configured. "
            "Add ROBINHOOD_CRYPTO_API_KEY and ROBINHOOD_CRYPTO_PRIVATE_KEY to backend/.env"
        )
    return api_key, base64.b64decode(priv_b64)


def _sign_request(api_key: str, private_key_bytes: bytes,
                  method: str, path: str, body: str = "") -> dict:
    """Build auth headers for one request."""
    try:
        from nacl.signing import SigningKey
    except ImportError:
        raise RuntimeError("PyNaCl not installed. Run: pip install PyNaCl")

    timestamp = str(int(time.time()))
    message   = api_key + timestamp + path + method.upper() + body
    signing_key = SigningKey(private_key_bytes)
    sig = base64.b64encode(signing_key.sign(message.encode()).signature).decode()

    return {
        "x-api-key":   api_key,
        "x-signature": sig,
        "x-timestamp": timestamp,
        "Content-Type": "application/json",
    }


class RobinhoodCryptoClient:
    """
    Client for Robinhood's official Crypto Trading API.

    Supported operations:
      - get_account()      — buying power, portfolio value
      - get_holdings()     — current crypto positions
      - get_last_price()   — best bid/ask midpoint for a symbol
      - place_order()      — limit or market buy/sell
      - get_order()        — order status by ID
      - cancel_order()     — cancel an open order
    """

    async def _get(self, path: str) -> dict:
        api_key, priv = _credentials()
        headers = _sign_request(api_key, priv, "GET", path)
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(_BASE + path, headers=headers)
            r.raise_for_status()
            return r.json()

    async def _post(self, path: str, body: dict) -> dict:
        import json
        api_key, priv = _credentials()
        body_str = json.dumps(body)
        headers  = _sign_request(api_key, priv, "POST", path, body_str)
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(_BASE + path, headers=headers, content=body_str)
            r.raise_for_status()
            return r.json()

    async def _delete(self, path: str) -> dict:
        api_key, priv = _credentials()
        headers = _sign_request(api_key, priv, "DELETE", path)
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.delete(_BASE + path, headers=headers)
            r.raise_for_status()
            return r.json()

    # ── Market listing ────────────────────────────────────────────────────────

    async def search_markets(self, limit: int = 50, offset: int = 0,
                             q: str = "", **kwargs) -> list[dict]:
        """
        Return tradeable crypto pairs from Robinhood with live prices.
        Tries /api/v1/crypto/trading/trading_pairs/ first; falls back to a
        curated list of all known Robinhood-supported pairs.
        Prices are batch-fetched concurrently from the best_bid_ask endpoint.
        """
        import asyncio

        # ── All known Robinhood-supported crypto pairs ────────────────────────
        _KNOWN = [
            ("BTC-USD",  "Bitcoin"),           ("ETH-USD",  "Ethereum"),
            ("SOL-USD",  "Solana"),            ("DOGE-USD", "Dogecoin"),
            ("ADA-USD",  "Cardano"),           ("AVAX-USD", "Avalanche"),
            ("LINK-USD", "Chainlink"),         ("LTC-USD",  "Litecoin"),
            ("BCH-USD",  "Bitcoin Cash"),      ("XLM-USD",  "Stellar"),
            ("SHIB-USD", "Shiba Inu"),         ("MATIC-USD","Polygon"),
            ("UNI-USD",  "Uniswap"),           ("XRP-USD",  "XRP"),
            ("ETC-USD",  "Ethereum Classic"),  ("AAVE-USD", "Aave"),
            ("COMP-USD", "Compound"),          ("GRT-USD",  "The Graph"),
            ("MKR-USD",  "Maker"),             ("BAT-USD",  "Basic Attention Token"),
            ("ZRX-USD",  "0x Protocol"),       ("ALGO-USD", "Algorand"),
            ("ATOM-USD", "Cosmos"),            ("DOT-USD",  "Polkadot"),
            ("FIL-USD",  "Filecoin"),          ("ICP-USD",  "Internet Computer"),
            ("NEAR-USD", "NEAR Protocol"),     ("XTZ-USD",  "Tezos"),
            ("MANA-USD", "Decentraland"),      ("SAND-USD", "The Sandbox"),
            ("AXS-USD",  "Axie Infinity"),     ("APE-USD",  "ApeCoin"),
            ("LRC-USD",  "Loopring"),          ("ZEC-USD",  "Zcash"),
            ("DASH-USD", "Dash"),              ("ANKR-USD", "Ankr"),
            ("HBAR-USD", "Hedera"),            ("FLOW-USD", "Flow"),
            ("EOS-USD",  "EOS"),               ("PEPE-USD", "Pepe"),
            ("WIF-USD",  "Dogwifhat"),         ("BONK-USD", "Bonk"),
            ("ARB-USD",  "Arbitrum"),          ("OP-USD",   "Optimism"),
            ("SUI-USD",  "Sui"),               ("APT-USD",  "Aptos"),
            ("INJ-USD",  "Injective"),         ("TIA-USD",  "Celestia"),
            ("SEI-USD",  "Sei"),               ("PYTH-USD", "Pyth Network"),
        ]

        # ── Try live trading_pairs endpoint first ─────────────────────────────
        try:
            data = await self._get("/api/v1/crypto/trading/trading_pairs/")
            pairs = data.get("results", data) if isinstance(data, dict) else data
            if pairs:
                if q:
                    ql = q.lower()
                    pairs = [p for p in pairs
                             if ql in p.get("symbol", "").lower()
                             or ql in p.get("asset_currency", {}).get("name", "").lower()]
                page = pairs[offset: offset + limit]
                # Enrich with prices if the endpoint didn't include them
                if page and not page[0].get("mark_price"):
                    enrich_prices: dict[str, float] = {}
                    try:
                        api_key, priv = _credentials()
                        syms = [p.get("symbol", "") for p in page if p.get("symbol")]
                        qs = "&".join(f"symbol={s}" for s in syms)
                        epath = f"/api/v1/crypto/marketdata/best_bid_ask/?{qs}"
                        eheaders = _sign_request(api_key, priv, "GET", epath)
                        async with httpx.AsyncClient(timeout=8.0) as eclient:
                            er = await eclient.get(_BASE + epath, headers=eheaders)
                            er.raise_for_status()
                            for entry in er.json().get("results", []):
                                sym = entry.get("symbol", "")
                                bid = float(entry.get("bid_inclusive_of_sell_spread", 0) or 0)
                                ask = float(entry.get("ask_inclusive_of_buy_spread", 0) or 0)
                                enrich_prices[sym] = round((bid + ask) / 2, 8) if bid and ask else (bid or ask or 0)
                    except Exception as exc:
                        log.warning("Robinhood Crypto enrich prices failed: %s", exc)
                    page = [{**p, "mark_price": enrich_prices.get(p.get("symbol", ""), 0)} for p in page]
                return page
        except Exception as exc:
            log.warning("Robinhood Crypto trading_pairs failed: %s — using fallback list", exc)

        # ── Fallback: curated list + batch-fetch live prices ─────────────────
        results = [{"symbol": s, "name": n} for s, n in _KNOWN]
        if q:
            ql = q.lower()
            results = [r for r in results
                       if ql in r["symbol"].lower() or ql in r["name"].lower()]

        page = results[offset: offset + limit]

        # Batch all symbols in a single best_bid_ask request (API supports multi-symbol)
        prices: dict[str, float] = {}
        try:
            api_key, priv = _credentials()
            syms = [p["symbol"] for p in page]
            qs = "&".join(f"symbol={s}" for s in syms)
            path = f"/api/v1/crypto/marketdata/best_bid_ask/?{qs}"
            headers = _sign_request(api_key, priv, "GET", path)
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(_BASE + path, headers=headers)
                r.raise_for_status()
                for entry in r.json().get("results", []):
                    sym = entry.get("symbol", "")
                    bid = float(entry.get("bid_inclusive_of_sell_spread", 0) or 0)
                    ask = float(entry.get("ask_inclusive_of_buy_spread", 0) or 0)
                    prices[sym] = round((bid + ask) / 2, 8) if bid and ask else (bid or ask or 0)
        except Exception as exc:
            log.warning("Robinhood Crypto batch price fetch failed: %s", exc)

        return [{**item, "mark_price": prices.get(item["symbol"], 0)} for item in page]

    def normalize_market(self, raw: dict) -> dict:
        """Normalize a Robinhood Crypto pair into the standard market shape."""
        symbol = raw.get("symbol", raw.get("asset_currency", {}).get("code", "")) + "-USD"
        symbol = raw.get("symbol", symbol).upper()
        name   = (raw.get("name")
                  or raw.get("asset_currency", {}).get("name")
                  or symbol.split("-")[0])
        price  = float(raw.get("mark_price", raw.get("price", 0)) or 0)
        return {
            "id":           symbol,
            "condition_id": symbol,
            "token_id":     symbol,
            "title":        f"{name} ({symbol})",
            "category":     "Crypto",
            "prob":         price,
            "volume":       float(raw.get("volume_24h", raw.get("volume", 0)) or 0),
            "liquidity":    0.0,
            "resolved":     False,
            "active":       True,
            "tags":         ["crypto"],
            "exchange":     "robinhood_crypto",
            "url":          "",
        }

    # ── Account ───────────────────────────────────────────────────────────────

    async def get_account(self) -> dict:
        """Return buying power and portfolio value from the crypto account."""
        try:
            data = await self._get("/api/v1/crypto/trading/accounts/")
            acct = data.get("account", data)
            return {
                "buying_power":    float(acct.get("buying_power", 0) or 0),
                "portfolio_value": float(acct.get("portfolio_value", 0) or 0),
            }
        except Exception as exc:
            log.warning("Robinhood Crypto get_account failed: %s", exc)
            return {"buying_power": 0.0, "portfolio_value": 0.0}

    async def get_holdings(self) -> list[dict]:
        """Return current crypto holdings."""
        try:
            data = await self._get("/api/v1/crypto/trading/holdings/")
            return data.get("results", [])
        except Exception as exc:
            log.warning("Robinhood Crypto get_holdings failed: %s", exc)
            return []

    # ── Market data ───────────────────────────────────────────────────────────

    async def get_last_price(self, symbol: str) -> Optional[float]:
        """
        Get the best bid/ask midpoint for a crypto symbol.
        symbol: e.g. "BTC-USD", "ETH-USD"
        """
        try:
            sym = symbol.upper().replace("/", "-")
            data = await self._get(f"/api/v1/crypto/marketdata/best_bid_ask/?symbol={sym}")
            results = data.get("results", [])
            if not results:
                return None
            best = results[0]
            bid = float(best.get("bid_inclusive_of_sell_spread", 0) or 0)
            ask = float(best.get("ask_inclusive_of_buy_spread", 0) or 0)
            if bid and ask:
                return round((bid + ask) / 2, 8)
            return bid or ask or None
        except Exception as exc:
            log.warning("Robinhood Crypto price failed %s: %s", symbol, exc)
            return None

    # ── Orders ────────────────────────────────────────────────────────────────

    async def place_order(
        self,
        symbol: str,
        side: str,                        # "buy" or "sell"
        size: Optional[float] = None,     # asset quantity (e.g. 0.001 BTC)
        quote_amount: Optional[float] = None,  # USD amount (for market buys)
        limit_price: Optional[float] = None,
        time_in_force: str = "gtc",
    ) -> dict:
        """
        Place a crypto order on Robinhood.

        For market buys: pass quote_amount (USD).
        For limit or market sells: pass size (asset quantity).
        limit_price: set for limit orders; omit for market orders.
        """
        sym = symbol.upper().replace("/", "-")
        order_type = "limit" if limit_price else "market"
        client_order_id = str(uuid.uuid4())

        body: dict = {
            "client_order_id": client_order_id,
            "side":            side.lower(),
            "type":            order_type,
            "symbol":          sym,
        }

        if order_type == "limit":
            if size is None:
                raise ValueError("size (asset quantity) required for limit orders")
            body["limit_order_config"] = {
                "asset_quantity": str(round(size, 8)),
                "limit_price":    str(round(limit_price, 8)),
                "time_in_force":  time_in_force,
            }
        else:
            # Market order
            if quote_amount is not None:
                body["market_order_config"] = {
                    "asset_quantity": None,
                    "quote_amount":   str(round(quote_amount, 2)),
                }
            elif size is not None:
                body["market_order_config"] = {
                    "asset_quantity": str(round(size, 8)),
                    "quote_amount":   None,
                }
            else:
                raise ValueError("Either size or quote_amount required for market orders")

        try:
            result = await self._post("/api/v1/crypto/trading/orders/", body)
            order_id = result.get("id", "unknown")
            state    = result.get("state", "")
            log.info(
                "Robinhood Crypto %s %s %s  order_id=%s  state=%s",
                order_type, side, sym, order_id, state,
            )
            return {
                "order_id": order_id,
                "status":   "submitted" if state in ("open", "queued", "partially_filled", "filled") else state,
                "note":     f"Robinhood Crypto {order_type} {side} {sym} — state={state}",
                "raw":      result,
            }
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:300]
            log.error("Robinhood Crypto place_order failed: %s", detail)
            return {"order_id": None, "status": "error", "note": detail}
        except Exception as exc:
            log.error("Robinhood Crypto place_order error: %s", exc)
            return {"order_id": None, "status": "error", "note": str(exc)}

    async def get_order(self, order_id: str) -> Optional[dict]:
        try:
            return await self._get(f"/api/v1/crypto/trading/orders/{order_id}/")
        except Exception as exc:
            log.warning("Robinhood Crypto get_order %s failed: %s", order_id, exc)
            return None

    async def cancel_order(self, order_id: str) -> dict:
        try:
            return await self._post(f"/api/v1/crypto/trading/orders/{order_id}/cancel/", {})
        except Exception as exc:
            log.warning("Robinhood Crypto cancel_order %s failed: %s", order_id, exc)
            return {"status": "error", "note": str(exc)}


# ── Singleton ─────────────────────────────────────────────────────────────────

_client: Optional[RobinhoodCryptoClient] = None


def get_robinhood_crypto_client() -> RobinhoodCryptoClient:
    global _client
    if _client is None:
        _client = RobinhoodCryptoClient()
    return _client
