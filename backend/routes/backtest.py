import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import Field

from ..models.schemas import (
    BacktestRequest, BacktestResult,
    BatchBacktestRequest, BatchBacktestResult,
    TIER_MIN_HOLD,
)
from ..services.exchange_router import get_exchange_client
from ..services.backtest_engine import PredictionMarketBacktester, run_batch
from ..services.macro_context import get_macro_context
from ..services.fred_prior import calibrate_from_title
from ..services.db import save_backtest_run, get_backtest_runs, get_backtest_run, purge_old_records
from ..services.risk_manager import get_config as get_risk_config

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
            "macro_zscore_mult":    ctx.zscore_multiplier,
            "macro_kelly_caution":  ctx.kelly_caution,
            "macro_features":       ctx.features,
            "macro_recession_risk": ctx.recession_risk,
            "macro_fed_stance":     ctx.fed_stance,
            "macro_inflation":      ctx.inflation_level,
            "macro_market_fear":    ctx.market_fear,
            "macro_credit_stress":  ctx.credit_stress,
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
    # req.exchange takes precedence over the query param (frontend sends it in the body)
    effective_exchange = req.exchange if req.exchange and req.exchange != "polymarket" else exchange
    client = get_exchange_client(effective_exchange)
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

    # req.exchange takes precedence over the query param
    effective_exchange = req.exchange if req.exchange and req.exchange != "polymarket" else exchange

    # ── HARBOR: stop-loss enforcement ─────────────────────────────────────────
    _rcfg = get_risk_config()
    if _rcfg.get("require_stop_loss", False) and req.execution_mode in ("auto",):
        if req.stop_loss is None:
            default_sl = (
                _rcfg.get("default_stop_loss_pm", 0.10)
                if effective_exchange != "yahoo"
                else _rcfg.get("default_stop_loss", 0.08)
            )
            raise HTTPException(
                status_code=422,
                detail=(
                    f"HARBOR: stop_loss is required for live execution mode '{req.execution_mode}'. "
                    f"Set stop_loss to a value between 0.01 and 0.99 "
                    f"(recommended minimum: {default_sl:.0%})."
                ),
            )

    client = get_exchange_client(effective_exchange)

    market_ids = [m.condition_id for m in req.markets]
    token_ids  = [m.token_id     for m in req.markets]
    log.info("batch backtest: %d market(s), strategy=%s, exchange=%s", len(market_ids), req.strategy, effective_exchange)

    try:
        histories, fetch_ms = await client.fetch_market_histories_batch(
            market_ids, token_ids=token_ids, interval=req.interval
        )
    except Exception as exc:
        log.exception("fetch_market_histories_batch failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Price history fetch failed: {exc}")

    # Stocks: enforce a per-tier minimum hold to avoid whipsaw re-entries.
    # Standard = 3d (cash account settlement), Margin = 2d, DayTrading = 1d.
    # Prediction markets have no settlement constraint so min_hold stays 1.
    if effective_exchange == "yahoo":
        min_hold = TIER_MIN_HOLD.get(req.account_tier, 3)
    else:
        min_hold = 1
    log.info("account_tier=%s min_hold=%d exchange=%s", req.account_tier, min_hold, effective_exchange)

    from datetime import date, timedelta
    if effective_exchange == "yahoo" and not req.date_from and not req.date_to:
        effective_date_from = (date.today() - timedelta(days=365)).isoformat()
        effective_date_to   = date.today().isoformat()
    else:
        effective_date_from = req.date_from
        effective_date_to   = req.date_to

    # Shared strategy params forwarded from the batch request.
    # Exclude batch-only fields so the per-market BacktestRequest gets everything else.
    shared = req.model_dump(exclude={"markets", "execution_mode", "date_from", "date_to"})

    pairs: list[tuple[BacktestRequest, list]] = []
    for market in req.markets:
        bt_req = BacktestRequest(
            **shared,
            condition_id=market.condition_id,
            token_id=market.token_id,
            min_hold_days=min_hold,
            date_from=effective_date_from,
            date_to=effective_date_to,
        )
        # Histories keyed by token_id (Polymarket) or market_id for others
        history = histories.get(market.token_id) or histories.get(market.condition_id, [])
        pairs.append((bt_req, history))

    batch = run_batch(pairs, fetch_duration_ms=fetch_ms)

    # Persist run to DB (fire-and-forget — don't fail the response if it errors)
    try:
        save_backtest_run(batch, strategy=req.strategy, exchange=effective_exchange)
    except Exception as exc:
        log.warning("Failed to persist backtest run: %s", exc)

    return batch


@router.get("/history")
async def backtest_history(limit: int = 50, offset: int = 0):
    """Return persisted backtest runs, newest first."""
    try:
        runs = get_backtest_runs(limit=limit, offset=offset)
        return {"runs": runs, "count": len(runs)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/history/{run_id}")
async def backtest_run_detail(run_id: str):
    """Return full detail for a single saved backtest run."""
    run = get_backtest_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.delete("/history/purge")
async def purge_history(retention_days: int = 90):
    """Delete records older than retention_days. Returns deleted row counts."""
    try:
        counts = purge_old_records(retention_days=retention_days)
        return {"deleted": counts, "retention_days": retention_days}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
