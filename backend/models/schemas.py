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
    prev_prob: Optional[float] = None   # previous period close — used for delta display
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

    # Momentum Chaser
    window:        int   = Field(14,  ge=3,   le=60,
                        description="Lookback window (candles) for breakout/rolling-max detection")
    momentum_min:  float = Field(5.0, ge=0.5, le=50.0,
                        description="Min % move above rolling high to confirm breakout entry")
    trail_pct:     float = Field(10.0, ge=1.0, le=40.0,
                        description="Trailing stop distance % from peak before exit fires")

    # Z-Score Reversion
    zscore_window: int   = Field(20,  ge=5,   le=100)
    zscore_entry:  float = Field(1.5, ge=0.5, le=4.0)
    zscore_exit:   float = Field(0.0, ge=-2.0, le=2.0)
    zscore_stop:   float = Field(3.0, ge=1.0, le=6.0)

    # Kelly Criterion
    kelly_fraction:       float          = Field(0.5,  ge=0.1, le=1.0)
    # Override dip threshold specifically for Kelly on stocks/crypto.
    # entry_threshold (default 0.30) means a 30% dip was never triggered on 5yr BTC.
    # Set to 0.10 to capture the June-2022 and early-2023 corrections.
    kelly_dip_threshold:  Optional[float] = Field(None, ge=0.01, le=0.50,
                          description="Kelly stock/crypto dip % override (None = use entry_threshold)")
    # Minimum expected ROI before Kelly will open a position.
    # Prevents entries on tiny moves when threshold is tight.
    kelly_min_roi:        float          = Field(0.0,  ge=0.0,  le=0.50,
                          description="Min expected ROI (exit/entry - 1) before Kelly fires")

    # Market Making
    mm_spread: float = Field(0.04, ge=0.0001, le=0.20)  # 0.01% min to allow tight-MM testing

    # XGBoost
    xgb_n_estimators:  int   = Field(330,  ge=10,  le=1000)
    xgb_learning_rate: float = Field(0.1,  ge=0.01, le=0.5)
    xgb_max_depth:     int   = Field(3,    ge=1,   le=8)
    xgb_train_frac:    float = Field(0.30, ge=0.10, le=0.70)
    xgb_retrain_every: int   = Field(20,   ge=5,   le=100)
    xgb_confidence:    float = Field(0.55, ge=0.50, le=0.90)

    # Trade cooldown — minimum candles between successive buys.
    # Set to 1 (no restriction) for prediction markets; auto-set to 3 for stocks.
    min_hold_days: int = Field(1, ge=1, le=30,
                        description="Minimum candles between a buy and the next re-entry")

    # Calendar window — restrict backtest to a specific date range (YYYY-MM-DD).
    # None means use the full history returned by the exchange.
    date_from: Optional[str] = Field(None, description="Start date inclusive (YYYY-MM-DD)")
    date_to:   Optional[str] = Field(None, description="End date inclusive (YYYY-MM-DD)")

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
    exit_threshold:  float = 0.70
    stop_loss:       Optional[float] = None
    initial_capital: float = 1000.0
    interval: str = "max"
    execution_mode: ExecutionMode = ExecutionMode.confirm
    date_from: Optional[str] = None
    date_to:   Optional[str] = None
    # Z-Score / Mean Reversion
    zscore_window: int   = 20
    zscore_entry:  float = 1.5
    zscore_exit:   float = 0.0
    zscore_stop:   float = 3.0
    # Kelly
    kelly_fraction:      float          = 0.5
    kelly_dip_threshold: Optional[float] = None
    kelly_min_roi:       float          = 0.0
    # Market Making
    mm_spread: float = 0.04
    # Momentum
    window:       int   = 14
    momentum_min: float = 5.0
    trail_pct:    float = 10.0
    # XGBoost
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
    # Wizard meta — populated only when strategy == "wizard"
    wizard_rankings: Optional[List[Dict[str, Any]]] = None


class BatchBacktestResult(BaseModel):
    total: int
    succeeded: int
    failed: int
    fetch_duration_ms: float
    results: List[BacktestResult]
