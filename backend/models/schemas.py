from pydantic import BaseModel
from typing import Optional, List, Any
from enum import Enum


class SortOrder(str, Enum):
    volume = "volume"
    liquidity = "liquidity"
    end_date = "endDate"


class MarketSummary(BaseModel):
    id: str
    condition_id: Optional[str]
    token_id: Optional[str]
    title: str
    category: str
    prob: float
    volume: float
    liquidity: float
    resolved: bool
    outcome: Optional[str]
    end_date: str
    tags: List[str]


class BacktestRequest(BaseModel):
    condition_id: str
    token_id: str
    strategy: str = "threshold"      # threshold | momentum
    entry_threshold: float = 0.30    # buy when prob <= this
    exit_threshold: float = 0.70     # sell when prob >= this
    stop_loss: Optional[float] = None  # exit if prob drops below this (loss cut)
    initial_capital: float = 1000.0
    interval: str = "max"            # 1m | 1h | 6h | 1d | 1w | max


class BacktestResult(BaseModel):
    success: bool
    error: Optional[str] = None
    condition_id: str
    initial_capital: float
    final_value: float
    total_return: float
    sharpe_ratio: float
    max_drawdown: float
    total_trades: int
    win_rate: float
    equity_curve: List[Any]
    trades: List[Any]
