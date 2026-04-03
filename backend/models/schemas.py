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
    exchange: str = "polymarket"   # which exchange client to use for price history + execution
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

    # Wizard regime testing — split history into N equal time windows and rank strategies
    # by cross-window consistency.  1 = full history (default / classic Wizard behaviour).
    wizard_windows: int = Field(1, ge=1, le=4,
                        description="Split history into N windows; Wizard ranks by cross-window consistency")

    # Wizard strategy selection — which strategies to include in the Wizard run.
    # Empty list = use the full default set (all long strategies).
    wizard_strategies: List[str] = Field(default_factory=list,
                        description="Strategy IDs to include in Wizard; empty = all defaults")

    # Slippage — applied to every fill to model execution cost.
    # Stocks: ~5 bps (tight spreads, zero-commission brokers).
    # Crypto: ~10–15 bps (Coinbase Advanced Trade taker fee + spread).
    # Prediction markets: ~2–5 bps.
    slippage_bps: float = Field(5.0, ge=0.0, le=100.0,
                        description="One-way slippage in basis points applied to each fill (buy costs more, sell nets less)")

    # Mean Reversion
    lookback_window:     int   = Field(15,  ge=5,   le=60,
                            description="Rolling window length for mean/std calculation")
    reversion_threshold: float = Field(2.0, ge=0.5, le=4.0,
                            description="Standard deviations from mean to trigger entry")

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

    # Resolution Momentum — activates in the final hours before resolution
    resolution_entry_threshold: float = Field(0.70, ge=0.01, le=0.99,
                                description="Min probability to consider for resolution momentum entry")
    dip_threshold: float = Field(0.05, ge=0.005, le=0.30,
                                description="Min dip from recent peak to trigger resolution entry")
    window_hours: int = Field(72, ge=1, le=240,
                                description="Hours before resolution to activate resolution momentum")

    # Probability Anchoring Reversion — fades drift away from round-number anchors
    anchor_tolerance: float = Field(0.03, ge=0.005, le=0.15,
                                description="Max distance from anchor point at open to activate")
    min_drift: float = Field(0.04, ge=0.005, le=0.20,
                                description="Minimum drift from anchor before entry")

    # Liquidity Vacuum — fades fast price moves into thin order books
    velocity_threshold: float = Field(0.03, ge=0.005, le=0.20,
                                description="Minimum price velocity (move in last 5 ticks) to trigger fade")

    # Regime Rotation — switches momentum/reversion based on FRED macro regime
    regime_momentum_threshold: float = Field(0.02, ge=0.005, le=0.15,
                                description="Minimum per-tick momentum to enter in expansion regime")

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
    macro_recession_risk: str = Field("unknown",
                            description="Regime label: low|medium|high|unknown")
    macro_fed_stance:     str = Field("unknown",
                            description="Regime label: easing|neutral|tightening|unknown")
    macro_inflation:      str = Field("unknown",
                            description="Regime label: below_target|at_target|above_target|unknown")
    macro_market_fear:    str = Field("unknown",
                            description="Regime label: low|normal|elevated|high|unknown")
    macro_credit_stress:  str = Field("unknown",
                            description="Regime label: tight|moderate|elevated|distress|unknown")


class BatchMarketInput(BaseModel):
    condition_id: str
    token_id: str


# ── Optimizer ─────────────────────────────────────────────────────────────────

class OptimizeRequest(BaseModel):
    condition_id:    str
    token_id:        str
    exchange:        str   = "polymarket"
    strategy:        str   = "zscore_reversion"
    n_trials:        int   = Field(200, ge=10,  le=1000,
                               description="Total Optuna trials to run")
    n_jobs:          int   = Field(8,   ge=1,   le=48,
                               description="Parallel threads (1 = sequential, 48 = all cores)")
    initial_capital: float = Field(1000.0, gt=0)
    slippage_bps:    float = Field(5.0, ge=0.0, le=100.0)
    interval:        str   = "max"
    date_from:       Optional[str] = None
    date_to:         Optional[str] = None


class TrialSummary(BaseModel):
    trial_number: int
    sharpe:       float
    total_return: float
    win_rate:     float
    total_trades: int
    params:       dict


class OptimizeResult(BaseModel):
    strategy:           str
    best_params:        dict
    best_sharpe:        float
    best_return:        float
    best_win_rate:      float
    best_total_trades:  int
    n_trials_completed: int
    n_trials_pruned:    int
    elapsed_sec:        float
    top_trials:         List[TrialSummary]
    optuna_available:   bool = True


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
    exchange:        str  = "polymarket"   # originating exchange
    asset_type:      str  = "prediction_market"  # stock | crypto | prediction_market


class StageFromBacktestRequest(BaseModel):
    market_id:      str
    market_title:   str
    strategy:       str
    exchange:       str                          # yahoo | coinbase | polymarket | kalshi
    capital:        float = Field(gt=0)          # USD to deploy
    execution_mode: ExecutionMode = ExecutionMode.confirm
    # Core backtest metrics
    total_return:   float
    sharpe_ratio:   float
    max_drawdown:   float
    win_rate:       float
    total_trades:   int
    # Last price from equity_curve (proxy for current price)
    last_price:     float = Field(gt=0)
    # Strategy exit / stop params (passed through from the run)
    exit_threshold: Optional[float] = None
    stop_loss:      Optional[float] = None


class SignalApproveRequest(BaseModel):
    modified_size: Optional[int] = None


class SignalModifyRequest(BaseModel):
    size:  int
    price: Optional[float] = None


class AccountTier(str, Enum):
    standard    = "standard"     # 3-day min hold  (typical cash/brokerage account)
    margin      = "margin"       # 2-day min hold  (margin account — more flexibility)
    day_trading = "day_trading"  # 1-day min hold  (PDT-flagged / day-trading account)

# Cooldown days enforced per tier for stock exchange backtests
TIER_MIN_HOLD: dict[str, int] = {
    "standard":    3,
    "margin":      2,
    "day_trading": 1,
}

class BatchBacktestRequest(BaseModel):
    markets: List[BatchMarketInput]
    exchange: str = "polymarket"
    strategy: str = "threshold"
    entry_threshold: float = 0.30
    exit_threshold:  float = 0.70
    stop_loss:       Optional[float] = None
    initial_capital: float = 1000.0
    interval: str = "max"
    execution_mode: ExecutionMode = ExecutionMode.confirm
    account_tier: AccountTier = AccountTier.standard
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
    # Wizard regime windows
    wizard_windows: int = 1
    wizard_strategies: List[str] = Field(default_factory=list)

    # Slippage
    slippage_bps: float = 5.0

    # Mean Reversion
    lookback_window:     int   = 15
    reversion_threshold: float = 2.0

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
    # Regime split results — populated when wizard_windows > 1
    # Each entry is one time window with its own per-strategy rankings.
    regime_splits:   Optional[List[Dict[str, Any]]] = None


class BatchBacktestResult(BaseModel):
    total: int
    succeeded: int
    failed: int
    fetch_duration_ms: float
    results: List[BacktestResult]


# ── Batch Optimize-then-Wizard ────────────────────────────────────────────────

class WizardMarketInput(BaseModel):
    condition_id: str
    token_id: str
    title: str = ""


class StrategyOOSResult(BaseModel):
    strategy:      str
    best_params:   dict
    train_sharpe:  float
    train_return:  float
    oos_sharpe:    float
    oos_return:    float
    oos_win_rate:  float
    oos_trades:    int
    overfit_score: float   # train_sharpe - oos_sharpe; higher means more overfit


class MarketWizardResult(BaseModel):
    condition_id:     str
    market_title:     str
    train_points:     int
    val_points:       int
    train_days:       int
    validation_days:  int
    strategy_results: List[StrategyOOSResult]   # sorted by oos_sharpe desc
    best_strategy:    str
    best_oos_sharpe:  float
    best_oos_return:  float
    error:            Optional[str] = None


class BatchWizardRequest(BaseModel):
    markets:         List[WizardMarketInput]
    exchange:        str   = "polymarket"
    strategies:      List[str] = Field(default_factory=list,
                         description="Strategies to optimise; empty = all in SEARCH_SPACES")
    n_trials:        int   = Field(50,    ge=10,  le=500,
                         description="Optuna trials per strategy per market")
    n_jobs:          int   = Field(2,     ge=1,   le=32,
                         description="Parallel threads inside each optimizer run")
    initial_capital: float = Field(1000.0, gt=0)
    slippage_bps:    float = Field(5.0,   ge=0.0, le=100.0)
    interval:        str   = "max"
    validation_days: int   = Field(90,    ge=14,  le=365,
                         description="Calendar days held out for OOS evaluation")
    date_from:       Optional[str] = None
    date_to:         Optional[str] = None


class BatchWizardResult(BaseModel):
    total:           int
    succeeded:       int
    failed:          int
    elapsed_sec:     float
    validation_days: int
    results:         List[MarketWizardResult]
