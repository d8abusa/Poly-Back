from fastapi import APIRouter, HTTPException

from ..strategies import ALL_STRATEGIES, STRATEGY_MAP

router = APIRouter(prefix="/api/strategies", tags=["strategies"])

_HIDDEN: set[str] = set()


@router.get("")
async def list_strategies():
    return {
        "strategies": [
            s for s in ALL_STRATEGIES
            if s["id"] not in _HIDDEN
        ]
    }


@router.get("/{strategy_id}")
async def get_strategy(strategy_id: str):
    s = STRATEGY_MAP.get(strategy_id)
    if not s:
        raise HTTPException(status_code=404, detail=f"Strategy '{strategy_id}' not found")
    return s
