import logging

from fastapi import APIRouter, HTTPException, Query

from ..services import position_tracker as pt

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/positions", tags=["positions"])


@router.get("")
async def get_positions():
    return {"positions": pt.get_open()}


@router.get("/closed")
async def get_closed_positions():
    # Serialize into the shape HistoryView expects
    def _to_history(p: dict) -> dict:
        return {
            "id":           p["id"],
            "market":       p.get("market_title", p["market_id"]),
            "category":     p.get("category", "Other"),
            "side":         p["side"],
            "entry_prob":   p["entry_price"],
            "exit_prob":    p.get("exit_prob") or p["current_prob"],
            "shares":       p["shares"],
            "strategy":     p["strategy"],
            "opened_at":    p["entry_date"],
            "closed_at":    p["closed_at"],
            "realized_pnl": p.get("realized_pnl") or 0.0,
            "close_reason": p.get("close_reason") or "manual",
        }
    return [_to_history(p) for p in pt.get_closed()]


@router.get("/summary")
async def get_summary():
    return pt.get_summary()


@router.post("/{position_id}/close")
async def close_position(
    position_id: str,
    close_reason: str = Query(default="manual"),
):
    pos = pt.close_position(position_id, close_reason=close_reason)
    if pos is None:
        raise HTTPException(status_code=404, detail="Position not found")
    log.info("Closed position %s  pnl=%.2f  reason=%s", position_id, pos["realized_pnl"], close_reason)
    return {"status": "closed", "position": pos}


@router.post("/{position_id}/prob")
async def update_prob(position_id: str, prob: float):
    """Update the live probability for a position (called by price feed)."""
    pos = pt.update_prob(position_id, prob)
    if pos is None:
        raise HTTPException(status_code=404, detail="Position not found")
    return {"status": "updated", "position": pos}
