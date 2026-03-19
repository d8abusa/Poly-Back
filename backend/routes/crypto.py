"""
Crypto trading routes.

POST /api/crypto/backtest         — run intraday backtest on a Coinbase product
GET  /api/crypto/scanner/status   — scanner health and last scan results
GET  /api/crypto/scanner/assets   — list watched assets with latest z-scores
POST /api/crypto/scanner/scan     — trigger an immediate manual scan
"""

import logging
from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.crypto_backtest import CryptoBacktestRequest, run_crypto_backtest
from ..services.crypto_scanner  import get_scanner_status, _run_scan
from ..services.exchange_router  import get_exchange_client

log    = logging.getLogger(__name__)
router = APIRouter(prefix="/api/crypto", tags=["crypto"])


# ── Request schemas ────────────────────────────────────────────────────────────

class CryptoBacktestPayload(BaseModel):
    product_id:      str   = "BTC-USD"
    strategy:        str   = "zscore_reversion"
    interval:        str   = "1h"
    initial_capital: float = Field(1000.0, gt=0)
    position_pct:    float = Field(0.50, ge=0.05, le=1.0)

    zscore_window:   int   = Field(20,  ge=5,   le=200)
    zscore_entry:    float = Field(1.5, ge=0.5, le=4.0)
    zscore_exit:     float = Field(0.5, ge=0.0, le=3.0)
    zscore_stop:     float = Field(3.5, ge=1.0, le=6.0)

    entry_pct:       float = Field(0.03, ge=0.005, le=0.20)
    exit_pct:        float = Field(0.02, ge=0.005, le=0.20)
    stop_pct:        float = Field(0.04, ge=0.005, le=0.20)


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/backtest")
async def crypto_backtest(payload: CryptoBacktestPayload):
    """
    Run an intraday strategy backtest on a Coinbase product.

    Uses real candle data from Coinbase Advanced Trade API.
    Z-score is computed on log returns — scale-invariant across assets.
    """
    client = get_exchange_client("coinbase")
    if client is None:
        raise HTTPException(status_code=503, detail="Coinbase client not configured")

    try:
        history = await client.get_price_history(
            payload.product_id.upper(),
            interval=payload.interval,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Coinbase data fetch failed: {exc}")

    if not history:
        raise HTTPException(status_code=404, detail=f"No candle data for {payload.product_id}")

    # Sort ascending (oldest first)
    history.sort(key=lambda x: x["t"])

    req = CryptoBacktestRequest(
        product_id      = payload.product_id.upper(),
        strategy        = payload.strategy,
        interval        = payload.interval,
        initial_capital = payload.initial_capital,
        position_pct    = payload.position_pct,
        zscore_window   = payload.zscore_window,
        zscore_entry    = payload.zscore_entry,
        zscore_exit     = payload.zscore_exit,
        zscore_stop     = payload.zscore_stop,
        entry_pct       = payload.entry_pct,
        exit_pct        = payload.exit_pct,
        stop_pct        = payload.stop_pct,
    )

    result = run_crypto_backtest(req, history)

    if not result.success:
        raise HTTPException(status_code=422, detail=result.error)

    return asdict(result)


@router.get("/scanner/status")
async def scanner_status():
    """Current scanner state, configuration, and last scan summary."""
    return get_scanner_status()


@router.get("/scanner/assets")
async def scanner_assets():
    """Latest z-score and price data for all watched assets."""
    status = get_scanner_status()
    return {
        "assets": list(status.get("last_signals", {}).values()),
        "last_scan": status.get("last_scan"),
    }


@router.post("/scanner/scan")
async def manual_scan():
    """Trigger an immediate scan of all watched assets."""
    try:
        await _run_scan()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Scan failed: {exc}")
    return get_scanner_status()
