import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import Field

from ..models.schemas import (
    BacktestRequest, BacktestResult,
    BatchBacktestRequest, BatchBacktestResult,
)
from ..services.exchange_router import get_exchange_client
from ..services.backtest_engine import PredictionMarketBacktester, run_batch

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/backtest", tags=["backtest"])


@router.post("", response_model=BacktestResult)
async def run_backtest(req: BacktestRequest, exchange: str = "polymarket"):
    """Run a backtest on a single market using its historical price curve."""
    client = get_exchange_client(exchange)
    try:
        history = await client.get_price_history(
            req.condition_id, token_id=req.token_id, interval=req.interval
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch price history: {e}")

    engine = PredictionMarketBacktester(req, history)
    result = engine.run()

    if not result.success:
        raise HTTPException(status_code=422, detail=result.error)

    return result


@router.post("/batch", response_model=BatchBacktestResult)
async def run_backtest_batch(req: BatchBacktestRequest, exchange: str = "polymarket"):
    """
    Run backtests on multiple markets concurrently.
    Price histories are fetched in parallel via asyncio.gather.
    Per-market failures are logged and recorded as failed results without aborting the batch.
    """
    if not req.markets:
        raise HTTPException(status_code=400, detail="markets list is empty")

    client = get_exchange_client(exchange)

    market_ids = [m.condition_id for m in req.markets]
    token_ids  = [m.token_id     for m in req.markets]
    log.info("batch backtest: %d market(s), strategy=%s, exchange=%s", len(market_ids), req.strategy, exchange)

    histories, fetch_ms = await client.fetch_market_histories_batch(
        market_ids, token_ids=token_ids, interval=req.interval
    )

    pairs: list[tuple[BacktestRequest, list]] = []
    for market in req.markets:
        bt_req = BacktestRequest(
            condition_id=market.condition_id,
            token_id=market.token_id,
            strategy=req.strategy,
            entry_threshold=req.entry_threshold,
            exit_threshold=req.exit_threshold,
            stop_loss=req.stop_loss,
            initial_capital=req.initial_capital,
            interval=req.interval,
        )
        # Histories keyed by token_id (Polymarket) or market_id for others
        history = histories.get(market.token_id) or histories.get(market.condition_id, [])
        pairs.append((bt_req, history))

    return run_batch(pairs, fetch_duration_ms=fetch_ms)
