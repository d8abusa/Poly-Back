"""
Batch Optimize-then-Wizard with walk-forward validation.

For each market in the request:
  1. Split history: train = everything before the last `validation_days` calendar days
                   val   = the last `validation_days` calendar days
  2. For each strategy: run Optuna optimizer on train, evaluate best params on val
  3. Rank strategies by OOS (out-of-sample) Sharpe ratio
  4. Return per-market rankings + overfit score (train_sharpe - oos_sharpe)

Walk-forward split is performed on unix timestamps so it is consistent across
all exchanges regardless of candle interval.
"""

import logging
import time

from ..models.schemas import (
    BacktestRequest,
    BatchWizardRequest,
    BatchWizardResult,
    MarketWizardResult,
    StrategyOOSResult,
)
from .backtest_engine import PredictionMarketBacktester
from .optimizer import OptimizeConfig, OptimizeResult, SEARCH_SPACES, run_optimization

log = logging.getLogger(__name__)

_SENTINEL_SHARPE = -999.0


def _split_history(history: list, validation_days: int) -> tuple[list, list]:
    """
    Split a price-history list into (train, validation) windows by calendar time.
    Returns (train_h, val_h). Either may be empty — callers must check length.
    """
    if not history:
        return [], []
    cutoff_ts = int(history[-1]["t"]) - validation_days * 86400
    train_h = [p for p in history if int(p["t"]) <= cutoff_ts]
    val_h   = [p for p in history if int(p["t"]) >  cutoff_ts]
    return train_h, val_h


def _span_days(history: list) -> int:
    if len(history) < 2:
        return 0
    return max(0, (int(history[-1]["t"]) - int(history[0]["t"])) // 86400)


def _eval_on_val(
    strategy: str,
    best_params: dict,
    val_h: list,
    req: BatchWizardRequest,
    market,
) -> tuple[float, float, float, int]:
    """Run one backtest on the validation window; returns (sharpe, return, win_rate, trades)."""
    try:
        bt_req = BacktestRequest(
            condition_id    = market.condition_id,
            token_id        = market.token_id or market.condition_id,
            strategy        = strategy,
            initial_capital = req.initial_capital,
            slippage_bps    = req.slippage_bps,
            exchange        = req.exchange,
            **best_params,
        )
        result = PredictionMarketBacktester(bt_req, val_h).run()
        if result.success:
            return result.sharpe_ratio, result.total_return, result.win_rate, result.total_trades
    except Exception as exc:
        log.debug("val eval failed strategy=%s market=%s: %s", strategy, market.condition_id, exc)
    return 0.0, 0.0, 0.0, 0


def run_batch_wizard(req: BatchWizardRequest, histories: dict) -> BatchWizardResult:
    """
    Synchronous — must be called from a ThreadPoolExecutor (not the async event loop).

    histories: dict keyed by token_id (or condition_id as fallback) -> list of history dicts.
    """
    strategies = req.strategies if req.strategies else list(SEARCH_SPACES.keys())
    t0 = time.time()
    results: list[MarketWizardResult] = []

    for market in req.markets:
        history = histories.get(market.token_id) or histories.get(market.condition_id, [])

        # ── Guard: need enough total history ──────────────────────────────────
        if len(history) < 20:
            results.append(MarketWizardResult(
                condition_id    = market.condition_id,
                market_title    = market.title or market.condition_id,
                train_points=0, val_points=0, train_days=0,
                validation_days = req.validation_days,
                strategy_results=[],
                best_strategy   = "none",
                best_oos_sharpe = 0.0,
                best_oos_return = 0.0,
                error           = "Insufficient price history (need >= 20 points)",
            ))
            continue

        train_h, val_h = _split_history(history, req.validation_days)

        if len(train_h) < 10:
            results.append(MarketWizardResult(
                condition_id    = market.condition_id,
                market_title    = market.title or market.condition_id,
                train_points    = len(train_h), val_points=len(val_h),
                train_days      = _span_days(train_h),
                validation_days = req.validation_days,
                strategy_results=[],
                best_strategy   = "none",
                best_oos_sharpe = 0.0,
                best_oos_return = 0.0,
                error           = f"Not enough training data after {req.validation_days}-day validation split ({len(train_h)} points)",
            ))
            continue

        if len(val_h) < 2:
            results.append(MarketWizardResult(
                condition_id    = market.condition_id,
                market_title    = market.title or market.condition_id,
                train_points    = len(train_h), val_points=len(val_h),
                train_days      = _span_days(train_h),
                validation_days = req.validation_days,
                strategy_results=[],
                best_strategy   = "none",
                best_oos_sharpe = 0.0,
                best_oos_return = 0.0,
                error           = "Validation window contains fewer than 2 price points — extend history or reduce validation_days",
            ))
            continue

        log.info(
            "batch_wizard: market=%s train=%d val=%d strategies=%s",
            market.condition_id, len(train_h), len(val_h), strategies,
        )

        # ── Per-strategy: optimise on train, evaluate on val ──────────────────
        strategy_results: list[StrategyOOSResult] = []
        for strategy in strategies:
            if strategy not in SEARCH_SPACES:
                log.debug("batch_wizard: skipping unknown strategy %s", strategy)
                continue
            try:
                config = OptimizeConfig(
                    condition_id    = market.condition_id,
                    token_id        = market.token_id or market.condition_id,
                    strategy        = strategy,
                    n_trials        = req.n_trials,
                    n_jobs          = req.n_jobs,
                    initial_capital = req.initial_capital,
                    slippage_bps    = req.slippage_bps,
                    exchange        = req.exchange,
                )
                opt: OptimizeResult = run_optimization(config, train_h)

                oos_sharpe, oos_return, oos_win_rate, oos_trades = _eval_on_val(
                    strategy, opt.best_params, val_h, req, market
                )
                overfit_score = round(opt.best_sharpe - oos_sharpe, 4)

                strategy_results.append(StrategyOOSResult(
                    strategy      = strategy,
                    best_params   = opt.best_params,
                    train_sharpe  = round(opt.best_sharpe,  4),
                    train_return  = round(opt.best_return,  4),
                    oos_sharpe    = round(oos_sharpe,   4),
                    oos_return    = round(oos_return,   4),
                    oos_win_rate  = round(oos_win_rate, 4),
                    oos_trades    = oos_trades,
                    overfit_score = overfit_score,
                ))
            except Exception as exc:
                log.warning(
                    "batch_wizard: strategy=%s market=%s failed: %s",
                    strategy, market.condition_id, exc,
                )

        strategy_results.sort(key=lambda s: s.oos_sharpe, reverse=True)
        best = strategy_results[0] if strategy_results else None

        results.append(MarketWizardResult(
            condition_id     = market.condition_id,
            market_title     = market.title or market.condition_id,
            train_points     = len(train_h),
            val_points       = len(val_h),
            train_days       = _span_days(train_h),
            validation_days  = req.validation_days,
            strategy_results = strategy_results,
            best_strategy    = best.strategy    if best else "none",
            best_oos_sharpe  = best.oos_sharpe  if best else 0.0,
            best_oos_return  = best.oos_return  if best else 0.0,
        ))

    elapsed = round(time.time() - t0, 2)
    succeeded = sum(1 for r in results if not r.error)
    log.info(
        "batch_wizard complete: %d/%d succeeded in %.1fs",
        succeeded, len(results), elapsed,
    )
    return BatchWizardResult(
        total           = len(results),
        succeeded       = succeeded,
        failed          = len(results) - succeeded,
        elapsed_sec     = elapsed,
        validation_days = req.validation_days,
        results         = results,
    )
