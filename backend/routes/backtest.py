from fastapi import APIRouter, Depends, HTTPException

from ..models.schemas import BacktestRequest, BacktestResult
from ..services.polymarket_client import PolymarketClient, get_client
from ..services.backtest_engine import PredictionMarketBacktester

router = APIRouter(prefix="/api/backtest", tags=["backtest"])


@router.post("", response_model=BacktestResult)
async def run_backtest(
    req: BacktestRequest,
    client: PolymarketClient = Depends(get_client),
):
    """
    Run a backtest on a Polymarket market using its historical price curve.
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
