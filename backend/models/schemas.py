import uuid
from datetime import datetime, timezone
from typing import Optional, List, Any, Dict, Literal
from enum import Enum

from pydantic import BaseModel, Field


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
    exchange: str = "polymarket"


class BacktestRequest(BaseModel):
    condition_id: str
    token_id: str
    strategy: str = "threshold"
    entry_threshold: float = Field(0.30, ge=0.01, le=0.99)
    exit_threshold:  float = Field(0.70, ge=0.01, le=0.99)
    stop_loss:       Optional[float] = Field(None, ge=0.01, le=0.99)
    initial_capital: float = Field(1000.0, gt=0)
    interval: str = "max"

    # Z-Score Reversion
    zscore_window: int   = Field(20,  ge=5,   le=100)
    zscore_entry:  float = Field(1.5, ge=0.5, le=4.0)
    zscore_exit:   float = Field(0.0, ge=-2.0, le=2.0)
    zscore_stop:   float = Field(3.0, ge=1.0, le=6.0)

    # Kelly Criterion
    kelly_fraction: float = Field(0.5, ge=0.1, le=1.0)

    # Market Making
    mm_spread: float = Field(0.04, ge=0.01, le=0.20)

    # XGBoost
    xgb_n_estimators:  int   = Field(330,  ge=10,  le=1000)
    xgb_learning_rate: float = Field(0.1,  ge=0.01, le=0.5)
    xgb_max_depth:     int   = Field(3,    ge=1,   le=8)
    xgb_train_frac:    float = Field(0.30, ge=0.10, le=0.70)
    xgb_retrain_every: int   = Field(20,   ge=5,   le=100)
    xgb_confidence:    float = Field(0.55, ge=0.50, le=0.90)

    # FRED macro context — injected server-side, not sent from the frontend.
    # Strategies read these to modulate thresholds and sizing.
    fred_p_true:        Optional[float] = Field(None, ge=0.05, le=0.95,
                            description="FRED-calibrated true probability for Kelly (overrides internal estimate)")
    fred_confidence:    Optional[float] = Field(None, ge=0.0, le=1.0,
                            description="Confidence in fred_p_true (0–1); used only when >= 0.4")
    macro_zscore_mult:  float = Field(1.0, ge=1.0, le=2.0,
                            description="Widen zscore_entry by this factor (from MacroContext)")
    macro_kelly_caution: float = Field(1.0, ge=0.0, le=1.0,
                            description="Scale down kelly_fraction by this factor (from MacroContext)")
    macro_features:     List[float] = Field(default_factory=list,
                            description="Normalised FRED feature vector appended to XGBoost features")


class BatchMarketInput(BaseModel):
    condition_id: str
    token_id: str


class ExecutionMode(str, Enum):
    auto        = "auto"
    confirm     = "confirm"
    alert_only  = "alert_only"


class SignalStatus(str, Enum):
    pending       = "pending"
    approved      = "approved"
    rejected      = "rejected"
    auto_executed = "auto_executed"


class SignalSchema(BaseModel):
    id:              str   = Field(default_factory=lambda: str(uuid.uuid4()))
    market_id:       str
    strategy:        str
    side:            Literal["BUY", "SELL"]
    entry_price:     float
    target_price:    float
    stop_loss:       Optional[float] = None
    suggested_size:  int
    suggested_shares: float
    expected_edge:   float
    maker_edge:      float
    delta_taker:     float
    confidence:      float
    reasoning:       str
    execution_mode:  ExecutionMode = ExecutionMode.confirm
    status:          SignalStatus  = SignalStatus.pending
    created_at:      str  = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    resolved_at:     Optional[str] = None


class SignalApproveRequest(BaseModel):
    modified_size: Optional[int] = None


class SignalModifyRequest(BaseModel):
    size:  int
    price: Optional[float] = None


class BatchBacktestRequest(BaseModel):
    markets: List[BatchMarketInput]
    strategy: str = "threshold"
    entry_threshold: float = 0.30
    exit_threshold: float = 0.70
    stop_loss: Optional[float] = None
    initial_capital: float = 1000.0
    interval: str = "max"
    execution_mode: ExecutionMode = ExecutionMode.confirm
    # XGBoost params
    xgb_n_estimators:  int   = 330
    xgb_learning_rate: float = 0.1
    xgb_max_depth:     int   = 3
    xgb_train_frac:    float = 0.30
    xgb_retrain_every: int   = 20
    xgb_confidence:    float = 0.55


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
