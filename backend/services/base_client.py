"""
Abstract exchange client interface — all exchange clients must implement this.
"""
import asyncio
import logging
import time
from abc import ABC, abstractmethod
from typing import Optional

log = logging.getLogger(__name__)


class BaseExchangeClient(ABC):
    """Unified interface for all supported prediction market exchanges."""

    # ── Required: market listing ─────────────────────────────────────────────

    @abstractmethod
    async def search_markets(self, limit: int = 50, offset: int = 0, **kwargs) -> list[dict]:
        """Return list of raw market dicts from the exchange."""
        ...

    @abstractmethod
    def normalize_market(self, raw: dict) -> dict:
        """Normalize a raw market dict to the common MarketSummary schema dict."""
        ...

    # ── Required: price history ──────────────────────────────────────────────

    @abstractmethod
    async def get_price_history(
        self,
        market_id: str,
        token_id: Optional[str] = None,
        interval: str = "max",
        fidelity: int = 60,
    ) -> list[dict]:
        """Return [{t: unix_seconds, p: probability_0_to_1}, ...] sorted ascending."""
        ...

    # ── Optional: live feed (default stubs return empty) ────────────────────

    async def get_order_book(self, market_id: str, token_id: Optional[str] = None) -> dict:
        return {"bids": [], "asks": []}

    async def get_recent_trades(self, market_id: str, token_id: Optional[str] = None, limit: int = 20) -> list:
        return []

    async def get_last_price(self, market_id: str, token_id: Optional[str] = None) -> Optional[float]:
        return None

    async def get_midpoint(self, market_id: str, token_id: Optional[str] = None) -> Optional[float]:
        return None

    async def get_market_snapshot(self, market_id: str, token_id: Optional[str] = None) -> dict:
        book        = await self.get_order_book(market_id, token_id)
        trades      = await self.get_recent_trades(market_id, token_id)
        last_price  = await self.get_last_price(market_id, token_id)
        midpoint    = await self.get_midpoint(market_id, token_id)
        bids, asks  = book.get("bids", []), book.get("asks", [])
        best_bid    = bids[0]["price"] if bids else None
        best_ask    = asks[0]["price"] if asks else None
        spread      = round(best_ask - best_bid, 4) if best_bid and best_ask else None
        return {
            "token_id":      token_id or market_id,
            "condition_id":  market_id,
            "last_price":    last_price,
            "midpoint":      midpoint,
            "best_bid":      best_bid,
            "best_ask":      best_ask,
            "spread":        spread,
            "bids":          bids[:10],
            "asks":          asks[:10],
            "recent_trades": trades,
            "market":        {},
        }

    # ── Batch history (default: asyncio.gather over get_price_history) ───────

    async def fetch_market_histories_batch(
        self,
        market_ids: list[str],
        token_ids: Optional[list[str]] = None,
        interval: str = "max",
        fidelity: int = 60,
    ) -> tuple[dict[str, list], float]:
        t0 = time.perf_counter()
        tids = token_ids or market_ids

        async def _safe(mid: str, tid: str) -> tuple[str, list]:
            try:
                return tid, await self.get_price_history(mid, token_id=tid, interval=interval, fidelity=fidelity)
            except Exception as exc:
                log.warning("batch fetch: %s failed — %s", tid, exc)
                return tid, []

        pairs = await asyncio.gather(*(_safe(mid, tid) for mid, tid in zip(market_ids, tids)))
        elapsed_ms = (time.perf_counter() - t0) * 1000
        return dict(pairs), elapsed_ms

    async def close(self):
        pass

    @staticmethod
    async def _safe(coro, default):
        try:
            return await coro
        except Exception:
            return default
