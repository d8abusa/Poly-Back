"""
Yahoo Finance client — stock market data via yfinance.

search_markets uses yf.Search for live ticker lookup (any valid symbol works).
Prices AND 1-year daily history are fetched in a single yf.download() batch call,
so history is embedded in the market response — no separate history fetch needed.
"""

import asyncio
import logging
import time
from typing import Optional

import yfinance as yf

from .base_client import BaseExchangeClient

log = logging.getLogger(__name__)

# Shown when the search box is empty — a curated starter set
_DEFAULT_UNIVERSE = [
    ("AAPL",  "Apple Inc."),
    ("MSFT",  "Microsoft Corporation"),
    ("NVDA",  "NVIDIA Corporation"),
    ("GOOGL", "Alphabet Inc."),
    ("AMZN",  "Amazon.com Inc."),
    ("META",  "Meta Platforms Inc."),
    ("TSLA",  "Tesla Inc."),
    ("AVGO",  "Broadcom Inc."),
    ("JPM",   "JPMorgan Chase & Co."),
    ("V",     "Visa Inc."),
    ("UNH",   "UnitedHealth Group Inc."),
    ("LLY",   "Eli Lilly and Company"),
    ("WMT",   "Walmart Inc."),
    ("XOM",   "Exxon Mobil Corporation"),
    ("SPY",   "SPDR S&P 500 ETF"),
    ("QQQ",   "Invesco QQQ Trust"),
    ("NKE",   "Nike Inc."),
    ("NFLX",  "Netflix Inc."),
    ("GS",    "Goldman Sachs Group Inc."),
    ("BA",    "Boeing Company"),
]

_INTERVAL_MAP = {
    "1m":  ("1m",  "5d"),
    "5m":  ("5m",  "60d"),
    "15m": ("15m", "60d"),
    "30m": ("30m", "60d"),
    "1h":  ("1h",  "730d"),
    "6h":  ("1h",  "730d"),
    # "max" history returns decades of 3-day aggregated candles from yfinance,
    # which (a) breaks _is_stock detection via pre-split sub-$1 prices and
    # (b) makes Sharpe/trade-count metrics meaningless. 5y daily is the right
    # default for strategy backtesting.
    "1d":  ("1d",  "5y"),
    "max": ("1d",  "5y"),
}


def _build_history(close_series) -> list[dict]:
    """Convert a pandas Close series → [{t, p}, ...] sorted ascending."""
    pts = []
    for ts, price in close_series.items():
        try:
            p = float(price)
            if p > 0:
                pts.append({"t": int(ts.timestamp()), "p": round(p, 4)})
        except Exception:
            pass
    return sorted(pts, key=lambda x: x["t"])


class YahooFinanceClient(BaseExchangeClient):
    """
    Wraps yfinance to provide stock market data in the common exchange format.

    search_markets:
      - Empty query  → returns _DEFAULT_UNIVERSE with live prices + 1Y history
      - Non-empty query → live yf.Search() lookup then same batch download
    get_price_history: still available for on-demand fetches (e.g. different interval)
    """

    async def search_markets(
        self,
        limit: int = 50,
        offset: int = 0,
        q: str = "",
        **kwargs,
    ) -> list[dict]:

        loop = asyncio.get_event_loop()

        # ── 1. Resolve ticker list ────────────────────────────────────────────
        if q:
            def _search():
                try:
                    res = yf.Search(q.strip(), max_results=min(limit + 5, 25))
                    return [
                        (
                            r["symbol"],
                            r.get("longname") or r.get("shortname") or r["symbol"],
                        )
                        for r in res.quotes
                        if r.get("quoteType") == "EQUITY" and r.get("isYahooFinance")
                    ][:limit]
                except Exception as exc:
                    log.warning("yf.Search failed for %r: %s", q, exc)
                    return []

            pairs = await loop.run_in_executor(None, _search)
        else:
            pairs = _DEFAULT_UNIVERSE[offset : offset + limit]

        if not pairs:
            return []

        tickers = [t for t, _ in pairs]
        names   = {t: n for t, n in pairs}

        # ── 2. Single batch download — 1Y daily gives price + full history ───
        def _fetch():
            return yf.download(
                tickers,
                period="1y",
                interval="1d",
                group_by="ticker",
                auto_adjust=True,
                progress=False,
                threads=True,
            )

        try:
            data = await loop.run_in_executor(None, _fetch)
        except Exception as exc:
            log.warning("Yahoo batch download failed: %s", exc)
            return [
                {"ticker": t, "name": names[t], "price": 0.0,
                 "volume_24h": 0.0, "history": []}
                for t in tickers
            ]

        # ── 3. Extract price + history per ticker ────────────────────────────
        result = []
        for ticker in tickers:
            try:
                col = data[ticker]
                close  = col["Close"].dropna()
                volume = col["Volume"].dropna()

                price   = float(close.iloc[-1])  if not close.empty  else 0.0
                vol     = float(volume.iloc[-1]) if not volume.empty else 0.0
                history = _build_history(close)
            except Exception:
                price, vol, history = 0.0, 0.0, []

            result.append({
                "ticker":     ticker,
                "name":       names.get(ticker, ticker),
                "price":      price,
                "volume_24h": vol,
                "history":    history,
            })

        return result

    def normalize_market(self, raw: dict) -> dict:
        ticker  = raw.get("ticker", "")
        price   = raw.get("price", 0.0)
        history = raw.get("history", [])
        prev_prob = round(history[-2]["p"], 2) if len(history) >= 2 else None
        return {
            "id":           ticker,
            "condition_id": ticker,
            "token_id":     ticker,
            "title":        f"{ticker} — {raw.get('name', ticker)}",
            "category":     "Stocks",
            "prob":         round(price, 2),
            "prev_prob":    prev_prob,
            "volume":       raw.get("volume_24h", 0.0),
            "liquidity":    0.0,
            "resolved":     False,
            "outcome":      None,
            "end_date":     "",
            "tags":         ["Stocks"],
            "exchange":     "yahoo",
            "history":      history,
        }

    async def get_market_snapshot(self, market_id: str, token_id=None) -> dict:
        ticker = token_id or market_id

        def _fetch():
            info = yf.Ticker(ticker).fast_info
            return (
                getattr(info, "last_price", None)
                or getattr(info, "previous_close", None)
            )

        try:
            price = await asyncio.get_event_loop().run_in_executor(None, _fetch)
        except Exception:
            price = None

        return {
            "token_id":      ticker,
            "condition_id":  ticker,
            "last_price":    price,
            "midpoint":      price,
            "best_bid":      None,
            "best_ask":      None,
            "spread":        None,
            "bids":          [],
            "asks":          [],
            "recent_trades": [],
            "market": {
                "title":    ticker,
                "active":   True,
                "closed":   False,
                "end_date": "",
                "outcome":  None,
            },
        }

    async def get_price_history(
        self,
        market_id: str,
        token_id: Optional[str] = None,
        interval: str = "max",
        fidelity: int = 60,
    ) -> list[dict]:
        """On-demand history fetch — used when a different interval is requested."""
        ticker = token_id or market_id
        yf_interval, period = _INTERVAL_MAP.get(interval, ("1d", "max"))

        try:
            def _fetch():
                return yf.Ticker(ticker).history(
                    period=period, interval=yf_interval, auto_adjust=True
                )

            df = await asyncio.get_event_loop().run_in_executor(None, _fetch)
            if df is None or df.empty:
                return []

            return _build_history(df["Close"].dropna())

        except Exception as exc:
            log.warning("Yahoo price history failed %s: %s", ticker, exc)
            return []


# ── Singleton ──────────────────────────────────────────────────────────────────

_yahoo_client: Optional[YahooFinanceClient] = None


def get_yahoo_client() -> YahooFinanceClient:
    global _yahoo_client
    if _yahoo_client is None:
        _yahoo_client = YahooFinanceClient()
    return _yahoo_client
