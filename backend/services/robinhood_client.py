"""
Robinhood brokerage client.

Data layer: delegates entirely to YahooFinanceClient — same stocks, free, no API key.
Execution layer: robin_stocks for order placement via the Robinhood brokerage API.

Setup (backend/.env):
    ROBINHOOD_USERNAME=your@email.com
    ROBINHOOD_PASSWORD=yourpassword
    ROBINHOOD_TOTP_SECRET=XXXXXXXXXXXXXXXX   # from Robinhood > Security > Authenticator app
                                              # click "Can't scan? Enter code manually" to get it

First login: authenticates via TOTP and saves a device token to
~/.tokens/robinhood_client.pickle — subsequent server restarts skip MFA entirely.

Note: robin_stocks uses Robinhood's unofficial internal API. This may break
if Robinhood changes their endpoints. Use at your own risk and review
Robinhood's ToS before deploying in production.
"""

import asyncio
import logging
import os
from typing import Optional

from .base_client import BaseExchangeClient
from .yahoo_client import YahooFinanceClient

log = logging.getLogger(__name__)


# ── Singleton Yahoo client for data delegation ────────────────────────────────

_yahoo: Optional[YahooFinanceClient] = None

def _get_yahoo() -> YahooFinanceClient:
    global _yahoo
    if _yahoo is None:
        _yahoo = YahooFinanceClient()
    return _yahoo


# ── robin_stocks auth ─────────────────────────────────────────────────────────

_rh_logged_in = False


def _ensure_robin_stocks():
    """Import robin_stocks or raise a clear, actionable error."""
    try:
        import robin_stocks.robinhood as r
        return r
    except ImportError:
        raise RuntimeError(
            "robin_stocks is not installed. "
            "Run: pip install robin_stocks pyotp"
        )


def _login_sync() -> None:
    """
    Authenticate with Robinhood. Idempotent — only logs in once per process.
    Session token is persisted to ~/.tokens/robinhood_client.pickle so
    subsequent server restarts skip MFA automatically.
    """
    global _rh_logged_in
    if _rh_logged_in:
        return

    r = _ensure_robin_stocks()

    username     = os.getenv("ROBINHOOD_USERNAME",    "").strip()
    password     = os.getenv("ROBINHOOD_PASSWORD",    "").strip()
    totp_secret  = os.getenv("ROBINHOOD_TOTP_SECRET", "").strip()

    if not username or not password:
        raise RuntimeError(
            "Robinhood credentials not configured. "
            "Add ROBINHOOD_USERNAME and ROBINHOOD_PASSWORD to backend/.env"
        )

    mfa_code = None
    if totp_secret:
        try:
            import pyotp
            mfa_code = pyotp.TOTP(totp_secret).now()
            log.debug("Robinhood: TOTP code generated")
        except ImportError:
            log.warning(
                "pyotp not installed — TOTP unavailable. "
                "Run: pip install pyotp"
            )

    r.login(
        username,
        password,
        mfa_code=mfa_code,
        store_session=True,
        by_sms=False,       # server-side: never prompt for SMS
    )
    _rh_logged_in = True
    log.info("Robinhood: authenticated as %s", username)


# ── Client ────────────────────────────────────────────────────────────────────

class RobinhoodClient(BaseExchangeClient):
    """
    Robinhood exchange client.

    All market-data methods (search, history, price) are handled by
    YahooFinanceClient — Robinhood and Yahoo surface the same US equity universe
    and Yahoo data is free without authentication.

    normalize_market() stamps exchange='robinhood' so that signals generated
    from this client route to Robinhood for execution rather than being
    treated as read-only Yahoo data.

    Order placement calls robin_stocks and runs in a thread executor because
    all robin_stocks functions are synchronous.
    """

    def __init__(self):
        self._yahoo = _get_yahoo()

    # ── Market listing (Yahoo data) ───────────────────────────────────────────

    async def search_markets(self, limit: int = 50, offset: int = 0, **kwargs) -> list[dict]:
        return await self._yahoo.search_markets(limit=limit, offset=offset, **kwargs)

    def normalize_market(self, raw: dict) -> dict:
        m = self._yahoo.normalize_market(raw)
        m["exchange"] = "robinhood"   # tag so signals route to this client
        return m

    # ── Price data (Yahoo data) ───────────────────────────────────────────────

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
        """Live quote from Robinhood; falls back to Yahoo if auth fails."""
        ticker = (token_id or market_id).upper()
        loop = asyncio.get_event_loop()

        def _quote():
            r = _ensure_robin_stocks()
            _login_sync()
            q = r.get_stock_quote_by_symbol(ticker) or {}
            price = q.get("last_trade_price") or q.get("last_extended_hours_trade_price")
            return float(price) if price else None

        try:
            return await loop.run_in_executor(None, _quote)
        except Exception as exc:
            log.debug("Robinhood live quote failed %s: %s — using Yahoo", ticker, exc)
            return await self._yahoo.get_last_price(market_id, token_id)

    # ── Order execution (Robinhood) ───────────────────────────────────────────

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
        Place a fractional stock order via Robinhood.

        product_id : ticker symbol — "NVDA", "AAPL", or "NVDA-USD" style (base is extracted)
        side       : "BUY" or "SELL"
        size       : number of shares (fractional supported)
        limit_price: optional — omit for market order
        """
        # Strip any "-USD" suffix produced by Yahoo/Coinbase style IDs
        ticker = product_id.upper().split("-")[0]
        loop   = asyncio.get_event_loop()

        def _place():
            r = _ensure_robin_stocks()
            _login_sync()

            if side.upper() == "BUY":
                result = (
                    r.order_buy_limit(ticker, size, limit_price)
                    if limit_price
                    else r.order_buy_fractional_by_quantity(ticker, size)
                )
            else:
                result = (
                    r.order_sell_limit(ticker, size, limit_price)
                    if limit_price
                    else r.order_sell_fractional_by_quantity(ticker, size)
                )

            if not result:
                return {"order_id": None, "status": "error", "note": "Robinhood returned empty response"}

            order_id = result.get("id") or result.get("client_id") or "unknown"
            state    = result.get("state", "confirmed")
            log.info(
                "Robinhood %s %s %.4f shares  id=%s  state=%s",
                side, ticker, size, order_id, state,
            )
            return {
                "order_id": order_id,
                "status":   "submitted" if state in ("confirmed", "queued", "unconfirmed") else state,
                "note":     f"Robinhood {side} {size} shares {ticker} — state={state}",
            }

        try:
            return await loop.run_in_executor(None, _place)
        except Exception as exc:
            log.error("Robinhood place_order failed: %s %s — %s", side, ticker, exc)
            return {"order_id": None, "status": "error", "note": str(exc)}

    async def get_account_info(self) -> dict:
        """Return buying power, equity, and cash balance from Robinhood account."""
        loop = asyncio.get_event_loop()

        def _fetch():
            r = _ensure_robin_stocks()
            _login_sync()
            portfolio = r.load_portfolio_profile() or {}
            account   = r.load_account_profile()   or {}
            return {
                "buying_power":    float(portfolio.get("withdrawable_amount", 0) or 0),
                "portfolio_value": float(portfolio.get("market_value", 0) or 0),
                "equity":          float(portfolio.get("equity", 0) or 0),
                "cash":            float(account.get("cash", 0) or 0),
            }

        try:
            return await loop.run_in_executor(None, _fetch)
        except Exception as exc:
            log.warning("Robinhood account info failed: %s", exc)
            return {"buying_power": 0.0, "portfolio_value": 0.0, "equity": 0.0, "cash": 0.0}


# ── Singleton factory ─────────────────────────────────────────────────────────

_client: Optional[RobinhoodClient] = None


def get_robinhood_client() -> RobinhoodClient:
    global _client
    if _client is None:
        _client = RobinhoodClient()
    return _client
