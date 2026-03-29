"""
Strategy parameter optimizer using Optuna.

Wraps PredictionMarketBacktester with a TPE study to find the best params
for a given strategy + price history. Objective: Sharpe ratio.

Parallelism: Optuna's ThreadPoolExecutor (n_jobs). NumPy releases the GIL
for most operations, so threading gives real concurrency on multi-core systems
without the pickling overhead of multiprocessing.

Usage:
    result = run_optimization(OptimizeConfig(...), history)
    # result.best_params -> plug directly into BacktestRequest
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

try:
    import optuna
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    _OPTUNA_AVAILABLE = True
except ImportError:
    _OPTUNA_AVAILABLE = False

from ..models.schemas import BacktestRequest
from .backtest_engine import PredictionMarketBacktester

log = logging.getLogger(__name__)


# ── Search spaces ─────────────────────────────────────────────────────────────
# Each entry: param_name -> (type, low, high)
# "int" uses trial.suggest_int; "float" uses trial.suggest_float

SEARCH_SPACES: dict[str, dict[str, tuple]] = {
    "zscore_reversion": {
        "zscore_window": ("int",   5,    60),
        "zscore_entry":  ("float", 0.5,  3.5),
        "zscore_exit":   ("float", -1.0, 1.0),
        "zscore_stop":   ("float", 1.5,  5.0),
    },
    "mean_reversion": {
        "lookback_window":     ("int",   5,   60),
        "reversion_threshold": ("float", 0.5, 4.0),
    },
    "kelly": {
        "kelly_fraction":      ("float", 0.1,  1.0),
        "kelly_dip_threshold": ("float", 0.03, 0.30),
        "kelly_min_roi":       ("float", 0.0,  0.20),
    },
    "momentum": {
        "window":       ("int",   5,   40),
        "momentum_min": ("float", 1.0, 20.0),
        "trail_pct":    ("float", 3.0, 30.0),
    },
    "threshold": {
        "entry_threshold": ("float", 0.05, 0.45),
        "exit_threshold":  ("float", 0.55, 0.95),
    },
    "swing_reversion": {
        "zscore_window": ("int",   5,  40),
        "zscore_entry":  ("float", 0.5, 3.0),
        "zscore_exit":   ("float", -1.0, 1.0),
        "window":        ("int",   3,  20),
    },
}


# ── Config / Result dataclasses ───────────────────────────────────────────────

@dataclass
class OptimizeConfig:
    condition_id:    str
    token_id:        str
    strategy:        str
    n_trials:        int   = 200
    n_jobs:          int   = 8      # parallel threads; use -1 for all cores
    initial_capital: float = 1000.0
    slippage_bps:    float = 5.0
    exchange:        str   = "polymarket"
    interval:        str   = "max"
    date_from:       Optional[str] = None
    date_to:         Optional[str] = None
    # Pre-injected macro context fields (passed through to each trial)
    macro_fields:    dict  = field(default_factory=dict)


@dataclass
class TrialSummary:
    trial_number: int
    sharpe:       float
    total_return: float
    win_rate:     float
    total_trades: int
    params:       dict


@dataclass
class OptimizeResult:
    strategy:           str
    best_params:        dict
    best_sharpe:        float
    best_return:        float
    best_win_rate:      float
    best_total_trades:  int
    n_trials_completed: int
    n_trials_pruned:    int
    elapsed_sec:        float
    top_trials:         list[TrialSummary]   # top 10 by Sharpe
    optuna_available:   bool = True


# ── Core optimizer ────────────────────────────────────────────────────────────

def _suggest_params(trial, space: dict) -> dict:
    """Sample one set of params from the search space using the trial."""
    params = {}
    for name, (kind, low, high) in space.items():
        if kind == "int":
            params[name] = trial.suggest_int(name, low, high)
        else:
            params[name] = trial.suggest_float(name, low, high)
    return params


def _make_objective(config: OptimizeConfig, history: list, space: dict):
    """
    Return a closure that Optuna calls for each trial.
    Builds a BacktestRequest from trial params, runs the engine, returns Sharpe.
    Thread-safe: PredictionMarketBacktester has no shared mutable state.
    """
    base_fields = {
        "condition_id":    config.condition_id,
        "token_id":        config.token_id,
        "strategy":        config.strategy,
        "initial_capital": config.initial_capital,
        "slippage_bps":    config.slippage_bps,
        "exchange":        config.exchange,
        "interval":        config.interval,
        **config.macro_fields,
    }
    if config.date_from:
        base_fields["date_from"] = config.date_from
    if config.date_to:
        base_fields["date_to"] = config.date_to

    def objective(trial) -> float:
        trial_params = _suggest_params(trial, space)
        try:
            req    = BacktestRequest(**{**base_fields, **trial_params})
            result = PredictionMarketBacktester(req, history).run()
        except Exception as exc:
            log.debug("trial %d failed: %s", trial.number, exc)
            return -999.0

        if not result.success or result.total_trades == 0:
            return -999.0

        # Store extra metrics as user attributes for the top-trials report
        trial.set_user_attr("total_return",  result.total_return)
        trial.set_user_attr("win_rate",      result.win_rate)
        trial.set_user_attr("total_trades",  result.total_trades)

        return result.sharpe_ratio

    return objective


def run_optimization(config: OptimizeConfig, history: list) -> OptimizeResult:
    """
    Synchronous — run this in a thread executor from async FastAPI routes.
    Returns an OptimizeResult with best params and top 10 trials.
    """
    if not _OPTUNA_AVAILABLE:
        return OptimizeResult(
            strategy=config.strategy,
            best_params={}, best_sharpe=0.0, best_return=0.0,
            best_win_rate=0.0, best_total_trades=0,
            n_trials_completed=0, n_trials_pruned=0, elapsed_sec=0.0,
            top_trials=[], optuna_available=False,
        )

    space = SEARCH_SPACES.get(config.strategy)
    if not space:
        raise ValueError(
            f"No search space defined for strategy '{config.strategy}'. "
            f"Supported: {list(SEARCH_SPACES.keys())}"
        )

    if len(history) < 10:
        raise ValueError("Insufficient price history for optimization (need ≥ 10 points)")

    log.info(
        "optimization start: strategy=%s n_trials=%d n_jobs=%d history=%d points",
        config.strategy, config.n_trials, config.n_jobs, len(history),
    )

    sampler = optuna.samplers.TPESampler(seed=42, multivariate=True)
    pruner  = optuna.pruners.MedianPruner(n_startup_trials=20, n_warmup_steps=0)
    study   = optuna.create_study(
        direction="maximize",
        sampler=sampler,
        pruner=pruner,
    )

    objective = _make_objective(config, history, space)

    t0 = time.time()
    study.optimize(
        objective,
        n_trials=config.n_trials,
        n_jobs=config.n_jobs,
        show_progress_bar=False,
    )
    elapsed = time.time() - t0

    best    = study.best_trial
    pruned  = sum(1 for t in study.trials if t.state == optuna.trial.TrialState.PRUNED)

    # Collect top 10 completed trials by Sharpe
    completed = [
        t for t in study.trials
        if t.state == optuna.trial.TrialState.COMPLETE and t.value is not None and t.value > -999.0
    ]
    completed.sort(key=lambda t: t.value, reverse=True)
    top_trials = [
        TrialSummary(
            trial_number = t.number,
            sharpe       = round(t.value, 4),
            total_return = round(t.user_attrs.get("total_return", 0.0), 4),
            win_rate     = round(t.user_attrs.get("win_rate",     0.0), 2),
            total_trades = int(t.user_attrs.get("total_trades",   0)),
            params       = {k: round(v, 4) if isinstance(v, float) else v
                            for k, v in t.params.items()},
        )
        for t in completed[:10]
    ]

    log.info(
        "optimization complete: strategy=%s best_sharpe=%.4f elapsed=%.1fs "
        "(%d completed, %d pruned)",
        config.strategy, best.value, elapsed,
        len(completed), pruned,
    )

    return OptimizeResult(
        strategy           = config.strategy,
        best_params        = {k: round(v, 4) if isinstance(v, float) else v
                              for k, v in best.params.items()},
        best_sharpe        = round(best.value, 4),
        best_return        = round(best.user_attrs.get("total_return", 0.0), 4),
        best_win_rate      = round(best.user_attrs.get("win_rate",     0.0), 2),
        best_total_trades  = int(best.user_attrs.get("total_trades",   0)),
        n_trials_completed = len(completed),
        n_trials_pruned    = pruned,
        elapsed_sec        = round(elapsed, 2),
        top_trials         = top_trials,
        optuna_available   = True,
    )
