from fastapi import APIRouter
from ..services.strategies.registry import STRATEGIES

router = APIRouter(prefix="/api/strategies", tags=["strategies"])

_HIDDEN = {"threshold"}  # legacy alias — not shown in UI


def _to_label(key: str) -> str:
    return key.replace("_", " ").title()


@router.get("")
def list_strategies():
    return {
        "strategies": [
            {"id": k, "label": _to_label(k)}
            for k in STRATEGIES
            if k not in _HIDDEN
        ]
    }
