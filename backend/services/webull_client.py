"""
Webull brokerage client.

Data layer: delegates to YahooFinanceClient — same US equity universe, free, no API key.
Execution layer: webull Python library for order placement via the Webull API.

Setup (backend/.env):
    WEBULL_EMAIL=your@email.com
    WEBULL_PASSWORD=yourpassword
    WEBULL_TRADE_PIN=123456         # 6-digit trading PIN set in the Webull app
    WEBULL_DEVICE_NAME=PolyBack     # any string — identifies this server session

First login: Webull emails an MFA code to your account.
    → Call POST /api/webull/setup/request-mfa  (sends the email)
    → Then POST /api/webull/setup/confirm { "code": "123456" }  (completes login)
    Session token is saved to ~/.tokens/webull_client.pkl — subsequent restarts
    skip MFA entirely.

Every order requires the trading PIN (WEBULL_TRADE_PIN) to unlock the trade token.
This is the same 6-digit PIN you use in the Webull app.
"""

import asyncio
import logging
import os
from typing import Optional

from .base_client import BaseExchangeClient
from .yahoo_client import YahooFinanceClient

log = logging.getLogger(__name__)

_TOKEN_PATH = os.path.expanduser("~/.tokens/webull_client.pkl")
_DEVICE_NAME = os.getenv("WEBULL_DEVICE_NAME", "PolyBack")


# ── Yahoo singleton ────────────────────────────────────────────────────────────

_yahoo: Optional[YahooFinanceClient] = None


def _get_yahoo() -> YahooFinanceClient:
    global _yahoo
    if _yahoo is None:
        _yahoo = YahooFinanceClient()
    return _yahoo


# ── webull auth ────────────────────────────────────────────────────────────────

_wb = None
_wb_logged_in = False


def _get_wb():
    global _wb
    if _wb is None:
        try:
            from webull import webull
        except ImportError:
            raise RuntimeError(
                "webull is not installed. Run: pip install webull"
            )
        import os
        os.makedirs(os.path.dirname(_TOKEN_PATH), exist_ok=True)
        _wb = webull()
        _wb._token_path = _TOKEN_PATH
    return _wb


def _login_sync() -> None:
    """
    Authenticate with Webull using saved session token.
    Raises RuntimeError if no token exists (first-time setup required).
    """
    global _wb_logged_in
    if _wb_logged_in:
        return

    wb = _get_wb()

    # Attempt login with saved token (no MFA needed after first login)
    try:
        wb.login(
            username=os.getenv("WEBULL_EMAIL", ""),
            password=os.getenv("WEBULL_PASSWORD", ""),
            device_name=_DEVICE_NAME,
            save_token=True,
            token_path=_TOKEN_PATH,
        )
        _wb_logged_in = True
        log.info("Webull: authenticated via saved session token")
    except Exception as exc:
        raise RuntimeError(
            f"Webull login failed: {exc}. "
            "If this is first-time setup, call POST /api/webull/setup/request-mfa "
            "then POST /api/webull/setup/confirm with the emailed code."
        ) from exc


def _unlock_trade_sync() -> None:
    """Call get_trade_token with the trading PIN before placing any order."""
    pin = os.getenv("WEBULL_TRADE_PIN", "").strip()
    if not pin:
        raise RuntimeError(
            "WEBULL_TRADE_PIN not set in .env. "
            "Add your 6-digit Webull trading PIN."
        )
    wb = _get_wb()
    wb.get_trade_token(pin)
    log.debug("Webull: trade token unlocked")


# ── Setup helpers (used by the /api/webull/setup routes) ─────────────────────

def request_mfa_sync() -> None:
    """Send MFA code to the registered Webull email address."""
    wb = _get_wb()
    email = os.getenv("WEBULL_EMAIL", "").strip()
    if not email:
        raise RuntimeError("WEBULL_EMAIL not set in .env")
    wb.get_mfa(email)
    log.info("Webull: MFA code sent to %s", email)


def confirm_mfa_sync(mfa_code: str) -> None:
    """Complete first-time login with the emailed MFA code."""
    global _wb_logged_in
    wb = _get_wb()
    email    = os.getenv("WEBULL_EMAIL",    "").strip()
    password = os.getenv("WEBULL_PASSWORD", "").strip()
    if not email or not password:
        raise RuntimeError("WEBULL_EMAIL and WEBULL_PASSWORD must be set in .env")

    wb.login(
        username=email,
        password=password,
        device_name=_DEVICE_NAME,
        mfa=mfa_code,
        save_token=True,
        token_path=_TOKEN_PATH,
    )
    _wb_logged_in = True
    log.info("Webull: first-time login complete, session token saved to %s", _TOKEN_PATH)


# ── Client ─────────────────────────────────────────────────────────────────────

class WebullClient(BaseExchangeClient):
    """
    Webull exchange client.

    Market data → YahooFinanceClient (same US equity universe, no API key needed).
    normalize_market() stamps exchange='webull' so signals route here for execution.
    Order placement uses the webull library, run in a thread executor (synchronous).
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

    # ── Price data ─────────────────────────────────────────────────────────────

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

    async def get_last_price(
        self, market_id: str, token_id: Optional[str] = None
    ) -> Optional[float]:
        """Live quote from Webull; falls back to Yahoo on auth failure."""
        ticker = (token_id or market_id).upper().split("-")[0]
        loop = asyncio.get_event_loop()

        def _quote():
            _login_sync()
            wb = _get_wb()
            q = wb.get_quote(stock=ticker) or {}
            # Webull quote fields: close, pPrice (pre-market), nPrice (after-hours)
            price = q.get("close") or q.get("pPrice") or q.get("nPrice")
            return float(price) if price else None

        try:
            return await loop.run_in_executor(None, _quote)
        except Exception as exc:
            log.debug("Webull live quote failed %s: %s — using Yahoo", ticker, exc)
            return await self._yahoo.get_last_price(market_id, token_id)

    # ── Order execution ────────────────────────────────────────────────────────

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
        Place a stock order via Webull.

        product_id  : ticker symbol — "NVDA", "AAPL", or "NVDA-USD" (base extracted)
        side        : "BUY" or "SELL"
        size        : number of shares (fractional supported)
        limit_price : optional — omit for market order
        """
        ticker = product_id.upper().split("-")[0]
        loop   = asyncio.get_event_loop()

        def _place():
            _login_sync()
            _unlock_trade_sync()
            wb = _get_wb()

            order_type = "LMT" if limit_price else "MKT"
            price      = limit_price or 0

            result = wb.place_order(
                stock=ticker,
                price=price,
                action=side.upper(),
                orderType=order_type,
                enforce="DAY",
                quant=size,
                outsideRegularTradingHour=False,
            )

            if not result:
                return {"order_id": None, "status": "error", "note": "Webull returned empty response"}

            order_id = result.get("orderId") or result.get("clientOrderId") or "unknown"
            status   = result.get("status", "").lower()
            log.info(
                "Webull %s %s %.4f shares @ %s  order_id=%s  status=%s",
                side, ticker, size, limit_price or "MKT", order_id, status,
            )
            # Webull statuses: Working, Filled, Cancelled, Failed
            submitted = status in ("working", "filled", "pending", "") or order_id != "unknown"
            return {
                "order_id": order_id,
                "status":   "submitted" if submitted else "error",
                "note":     f"Webull {side} {size} shares {ticker} — status={status}",
            }

        try:
            return await loop.run_in_executor(None, _place)
        except Exception as exc:
            log.error("Webull place_order failed: %s %s — %s", side, ticker, exc)
            return {"order_id": None, "status": "error", "note": str(exc)}

    async def get_account_info(self) -> dict:
        """Return buying power, equity, and cash balance from Webull account."""
        loop = asyncio.get_event_loop()

        def _fetch():
            _login_sync()
            wb = _get_wb()
            acct = wb.get_account() or {}
            # Webull account fields vary — extract common keys safely
            buying_power    = float(acct.get("buyingPower",    0) or 0)
            net_liquidation = float(acct.get("netLiquidation", 0) or 0)
            cash_balance    = float(acct.get("cashBalance",    0) or 0)
            return {
                "buying_power":    buying_power,
                "portfolio_value": net_liquidation,
                "equity":          net_liquidation,
                "cash":            cash_balance,
            }

        try:
            return await loop.run_in_executor(None, _fetch)
        except Exception as exc:
            log.warning("Webull account info failed: %s", exc)
            return {"buying_power": 0.0, "portfolio_value": 0.0, "equity": 0.0, "cash": 0.0}


# ── Singleton factory ──────────────────────────────────────────────────────────

_client: Optional[WebullClient] = None


def get_webull_client() -> WebullClient:
    global _client
    if _client is None:
        _client = WebullClient()
    return _client
