"""
Forecast routes — advisory price forecasting.

GET /api/forecast
  ?market_id=BTC-USD
  &exchange=robinhood_crypto
  &horizon=7          (days, default 7, max 30)
  &force=false        (bypass cache)

Returns a ForecastResult with 7-day price prediction + CI bands.
"""

import asyncio
import logging

from fastapi import APIRouter, HTTPException, Query

from ..services.exchange_router import get_exchange_client
from ..services.forecaster import run_forecast, get_cached_forecast, grade_forecast

log    = logging.getLogger(__name__)
router = APIRouter(prefix="/api/forecast", tags=["forecast"])


def _serialise(result) -> dict:
    return {
        "market_id":        result.market_id,
        "exchange":         result.exchange,
        "current_price":    result.current_price,
        "target_price":     result.target_price,
        "target_lower":     result.target_lower,
        "target_upper":     result.target_upper,
        "bull_probability": result.bull_probability,
        "trend":            result.trend,
        "rsi":              result.rsi,
        "r_squared":        result.r_squared,
        "daily_vol_pct":    result.daily_vol_pct,
        "horizon_days":     result.horizon_days,
        "history":          result.history,
        "forecast":  [
            {
                "date":       p.date,
                "yhat":       p.yhat,
                "yhat_lower": p.yhat_lower,
                "yhat_upper": p.yhat_upper,
            }
            for p in result.forecast
        ],
        "generated_at": result.generated_at,
        "model":        result.model,
        "error":        result.error,
    }


@router.get("")
async def get_forecast(
    market_id: str  = Query(...),
    exchange:  str  = Query("robinhood_crypto"),
    horizon:   int  = Query(7, ge=1, le=30),
    force:     bool = Query(False),
):
    # Return cache immediately if available and not forced
    if not force:
        cached = get_cached_forecast(market_id, exchange, horizon)
        if cached:
            return _serialise(cached)

    # Fetch price history from the exchange client
    try:
        client  = get_exchange_client(exchange)
        history = await client.get_price_history(market_id, interval="max")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"History fetch failed: {exc}")

    if not history:
        raise HTTPException(status_code=404, detail="No price history available for this market")

    # Run forecast in thread executor (CPU-bound)
    loop   = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None, run_forecast, market_id, exchange, history, horizon, force
    )

    if result.error and not result.forecast:
        raise HTTPException(status_code=422, detail=result.error)

    return _serialise(result)


@router.get("/grade")
async def get_forecast_grade(
    market_id: str = Query(...),
    exchange:  str = Query("robinhood_crypto"),
    as_of:     str = Query(..., description="YYYY-MM-DD split point"),
    horizon:   int = Query(7, ge=1, le=30),
):
    """
    Walk-forward forecast validation.
    Runs the forecaster at `as_of` using only pre-split history,
    then scores the prediction against actual post-split prices.
    """
    try:
        client  = get_exchange_client(exchange)
        history = await client.get_price_history(market_id, interval="max")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"History fetch failed: {exc}")

    if not history:
        raise HTTPException(status_code=404, detail="No price history available")

    loop  = asyncio.get_event_loop()
    grade = await loop.run_in_executor(
        None, grade_forecast, market_id, exchange, history, as_of, horizon
    )

    return {
        "market_id":         grade.market_id,
        "exchange":          grade.exchange,
        "as_of_date":        grade.as_of_date,
        "horizon_days":      grade.horizon_days,
        "forecast_7d":       grade.forecast_7d,
        "actual_7d":         grade.actual_7d,
        "as_of_price":       grade.as_of_price,
        "direction_correct": grade.direction_correct,
        "within_ci":         grade.within_ci,
        "mape_pct":          grade.mape_pct,
        "score":             grade.score,
        "color":             grade.color,
        "label":             grade.label,
        "generated_at":      grade.generated_at,
        "note":              grade.note,
    }
