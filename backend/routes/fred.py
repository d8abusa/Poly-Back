"""
FRED API routes — economic data with pull-count budget enforcement.

GET  /api/fred/dashboard          — cached snapshot of all series, no API call
GET  /api/fred/{series_id}        — get series data (cache-first)
POST /api/fred/{series_id}/refresh — force a fresh pull (burns one budget unit)
GET  /api/fred/budget             — how many pulls remain
"""

from fastapi import APIRouter, HTTPException, Query

from ..services.fred_service import get_series, get_dashboard, get_pull_count, SERIES_META

router = APIRouter(prefix="/api/fred", tags=["fred"])


@router.get("/budget")
async def fred_budget():
    """How many FRED API pulls have been used vs the 100-pull free tier."""
    used = get_pull_count()
    return {
        "used":      used,
        "budget":    100,
        "remaining": max(0, 100 - used),
        "warning":   used >= 80,
    }


@router.get("/dashboard")
async def fred_dashboard():
    """
    Snapshot of all tracked series from cache — never makes an API call.
    Safe to call as often as needed.
    """
    return await get_dashboard()


@router.get("/series")
async def list_series():
    """List all tracked FRED series and their metadata."""
    return {"series": SERIES_META}


@router.get("/{series_id}")
async def get_fred_series(
    series_id: str,
    limit: int = Query(24, ge=1, le=100, description="Number of observations to return"),
):
    """
    Get FRED series data. Serves from cache if fresh; pulls from API only if stale.
    Stale = not pulled within the series refresh window (monthly/weekly depending on series).
    """
    try:
        return await get_series(series_id.upper(), force_refresh=False, limit=limit)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"FRED error: {exc}")


@router.post("/{series_id}/refresh")
async def refresh_fred_series(
    series_id: str,
    limit: int = Query(24, ge=1, le=100),
):
    """
    Force a fresh pull from FRED API regardless of cache freshness.
    WARNING: burns one pull from your 100-pull free budget.
    Returns 503 if budget is exhausted.
    """
    used = get_pull_count()
    if used >= 95:
        raise HTTPException(
            status_code=503,
            detail=f"FRED budget nearly exhausted ({used}/100). "
                   "Upgrade to paid plan at fred.stlouisfed.org.",
        )
    try:
        return await get_series(series_id.upper(), force_refresh=True, limit=limit)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"FRED error: {exc}")
