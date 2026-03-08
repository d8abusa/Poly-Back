import logging

from fastapi import APIRouter, Depends, HTTPException

from ..models.schemas import (
    BacktestRequest, BacktestResult,
    BatchBacktestRequest, BatchBacktestResult,
)
from ..services.polymarket_client import PolymarketClient, get_client
from ..services.backtest_engine import PredictionMarketBacktester, run_batch

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/backtest", tags=["backtest"])


@router.post("", response_model=BacktestResult)
async def run_backtest(
    req: BacktestRequest,
    client: PolymarketClient = Depends(get_client),
):
    """
    Run a backtest on a single Polymarket market using its historical price curve.
    Strategies: threshold, momentum.
    """
    try:
        history = await client.get_price_history(req.token_id, interval=req.interval)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch price history: {e}")

    engine = PredictionMarketBacktester(req, history)
    result = engine.run()

    if not result.success:
        raise HTTPException(status_code=422, detail=result.error)

    return result


@router.post("/batch", response_model=BatchBacktestResult)
async def run_backtest_batch(
    req: BatchBacktestRequest,
    client: PolymarketClient = Depends(get_client),
):
    """
    Run backtests on multiple markets concurrently.

    Price histories are fetched in parallel via asyncio.gather.
    Per-market fetch failures are logged and recorded as failed results
    without aborting the rest of the batch.
    """
    if not req.markets:
        raise HTTPException(status_code=400, detail="markets list is empty")

    token_ids = [m.token_id for m in req.markets]
    log.info("batch backtest: %d market(s), strategy=%s", len(token_ids), req.strategy)

    histories, fetch_ms = await client.fetch_market_histories_batch(
        token_ids, interval=req.interval
    )

    # Build (BacktestRequest, history) pairs — one per queued market
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
        pairs.append((bt_req, histories.get(market.token_id, [])))

    return run_batch(pairs, fetch_duration_ms=fetch_ms)
