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
from ..services.macro_context import get_macro_context
from ..services.fred_prior import calibrate_from_title

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/backtest", tags=["backtest"])


def _inject_macro(req: BacktestRequest, market_title: str = "") -> BacktestRequest:
    """
    Enrich a BacktestRequest with current macro context and FRED prior.
    Pure reads from local cache — adds no latency in the common case.
    Returns a mutated copy of req with macro fields populated.
    """
    try:
        ctx = get_macro_context()
        req = req.model_copy(update={
            "macro_zscore_mult":   ctx.zscore_multiplier,
            "macro_kelly_caution": ctx.kelly_caution,
            "macro_features":      ctx.features,
        })
        log.debug(
            "macro context: recession=%s fed=%s inflation=%s zscore_mult=%.2f kelly_caution=%.2f",
            ctx.recession_risk, ctx.fed_stance, ctx.inflation_level,
            ctx.zscore_multiplier, ctx.kelly_caution,
        )
    except Exception as exc:
        log.warning("macro context unavailable: %s", exc)

    if market_title and req.strategy == "kelly":
        try:
            prior = calibrate_from_title(market_title)
            if prior["p_true"] is not None and prior["confidence"] >= 0.4:
                req = req.model_copy(update={
                    "fred_p_true":    prior["p_true"],
                    "fred_confidence": prior["confidence"],
                })
                log.info(
                    "FRED prior applied: series=%s p_true=%.3f conf=%.2f",
                    prior["series_id"], prior["p_true"], prior["confidence"],
                )
        except Exception as exc:
            log.warning("FRED prior calibration failed: %s", exc)

    return req


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

    # Enrich with macro context before running
    market_title = ""
    if history:
        market_title = history[0].get("title", "") if isinstance(history[0], dict) else ""
    req = _inject_macro(req, market_title)

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
