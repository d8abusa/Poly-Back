import logging
from pydantic import BaseModel, Field
from typing import Optional
from fastapi import APIRouter, HTTPException

from ..services.live_scanner import get_scanner

log    = logging.getLogger(__name__)
router = APIRouter(prefix="/api/scanner", tags=["scanner"])


class ScannerStartRequest(BaseModel):
    markets:          list[dict]
    strategy:         str   = "zscore_reversion"
    params:           dict  = {}
    interval_seconds: float = Field(60.0, ge=1.0, le=3600.0)
    execution_mode:   str   = "confirm"
    exchange:         str   = "kalshi"


class IntervalRequest(BaseModel):
    seconds: float = Field(..., ge=1.0, le=3600.0)


@router.post("/start")
async def start_scanner(req: ScannerStartRequest):
    if not req.markets:
        raise HTTPException(status_code=400, detail="markets list is empty")
    scanner = get_scanner()
    scanner.start(
        markets          = req.markets,
        strategy         = req.strategy,
        params           = req.params,
        interval_seconds = req.interval_seconds,
        execution_mode   = req.execution_mode,
        exchange         = req.exchange,
    )
    return {"status": "started", **scanner.status()}


@router.post("/stop")
async def stop_scanner():
    get_scanner().stop()
    return {"status": "stopped"}


@router.patch("/interval")
async def update_interval(req: IntervalRequest):
    scanner = get_scanner()
    if not scanner.is_running:
        raise HTTPException(status_code=400, detail="Scanner is not running")
    scanner.update_interval(req.seconds)
    return {"interval_seconds": scanner.interval_seconds}


@router.get("/status")
async def scanner_status():
    return get_scanner().status()
