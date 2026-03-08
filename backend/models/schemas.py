from pydantic import BaseModel
from typing import Optional, List, Any, Dict
from enum import Enum


class SortOrder(str, Enum):
    volume = "volume"
    liquidity = "liquidity"
    end_date = "endDate"


# ── Strategy library models ───────────────────────────────────────────────────

class StrategyParam(BaseModel):
    name: str
    label: str
    default: float
    min: float
    max: float
    step: float
    desc: str


class StrategyPerformance(BaseModel):
    win_rate: float
    avg_return: float
    sharpe: float
    max_dd: float
    trades: int


class BaseStrategy(BaseModel):
    id: str
    name: str
    tagline: str
    category: str
    risk: str
    complexity: str
    color: str
    description: str
    logic: Dict[str, str]   # keys: entry, exit, size
    formula: str
    params: List[StrategyParam]
    edge: str
    risks: List[str]
    performance: StrategyPerformance
    synthetic_curve: List[float]


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


class BatchMarketInput(BaseModel):
    condition_id: str
    token_id: str


class BatchBacktestRequest(BaseModel):
    markets: List[BatchMarketInput]
    strategy: str = "threshold"
    entry_threshold: float = 0.30
    exit_threshold: float = 0.70
    stop_loss: Optional[float] = None
    initial_capital: float = 1000.0
    interval: str = "max"


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


class BatchBacktestResult(BaseModel):
    total: int
    succeeded: int
    failed: int
    fetch_duration_ms: float
    results: List[BacktestResult]
