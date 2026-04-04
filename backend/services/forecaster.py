"""
Price Forecaster — log-linear trend + volatility model.

Advisory only: surfaces a 7-day forward price estimate with 90% confidence
bands. Does not influence signal confidence (Phase 2).

Model:
  1. Fit linear regression on log(price) over the last 90 days.
  2. Project the trend forward `horizon_days`.
  3. CI = trend ± 1.645 × σ_daily × √h  (random-walk uncertainty around trend).
  4. Bull probability = Φ(slope × √h / σ_daily)  — normal CDF of the trend Sharpe.
  5. RSI(14) for overbought/oversold context.

No external ML dependencies beyond scipy/numpy/pandas.
"""

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats

log = logging.getLogger(__name__)

# ── In-memory cache ────────────────────────────────────────────────────────────
# key: (market_id, exchange, horizon_days) → (ForecastResult, expires_at)
_cache: dict[tuple, tuple] = {}
_CACHE_TTL = 3600  # 1 hour


# ── Data types ─────────────────────────────────────────────────────────────────

@dataclass
class ForecastPoint:
    date:        str    # ISO date "YYYY-MM-DD"
    yhat:        float  # predicted price (trend)
    yhat_lower:  float  # 90% CI lower
    yhat_upper:  float  # 90% CI upper


@dataclass
class ForecastResult:
    market_id:       str
    exchange:        str
    current_price:   float
    target_price:    float          # yhat at horizon end
    target_lower:    float
    target_upper:    float
    bull_probability: float         # 0–1
    trend:           str            # "bullish" | "bearish" | "neutral"
    rsi:             float          # RSI(14) at last data point
    r_squared:       float          # linear fit quality 0–1
    daily_vol_pct:   float          # daily volatility %
    horizon_days:    int
    history:         list[dict]     # last 30 days [{date, price}] for chart
    forecast:        list[ForecastPoint]  # horizon_days points
    generated_at:    str
    model:           str = "log_linear"
    error:           Optional[str] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _rsi(prices: np.ndarray, period: int = 14) -> float:
    if len(prices) < period + 1:
        return 50.0
    deltas = np.diff(prices)
    gains  = np.maximum(deltas, 0)
    losses = np.maximum(-deltas, 0)
    ag = np.mean(gains[-period:])
    al = np.mean(losses[-period:])
    if al == 0:
        return 100.0
    return float(100 - 100 / (1 + ag / al))


def _to_daily_df(history: list[dict]) -> pd.DataFrame:
    """
    Convert raw [{t: unix_ts, p: price}] history to a daily close DataFrame.
    Groups by calendar date, takes the last price of each day.
    """
    if not history:
        return pd.DataFrame(columns=["price"])
    df = pd.DataFrame(history)
    df["date"] = pd.to_datetime(df["t"], unit="s", utc=True).dt.normalize()
    df = (
        df.groupby("date")["p"]
        .last()
        .rename("price")
        .to_frame()
        .sort_index()
    )
    return df


# ── Core forecast ──────────────────────────────────────────────────────────────

def _run_forecast(
    market_id: str,
    exchange:  str,
    history:   list[dict],
    horizon_days: int = 7,
) -> ForecastResult:
    now_iso = datetime.now(timezone.utc).isoformat()

    df = _to_daily_df(history)
    if len(df) < 30:
        return ForecastResult(
            market_id=market_id, exchange=exchange,
            current_price=0, target_price=0,
            target_lower=0, target_upper=0,
            bull_probability=0.5, trend="neutral",
            rsi=50, r_squared=0, daily_vol_pct=0,
            horizon_days=horizon_days,
            history=[], forecast=[],
            generated_at=now_iso,
            error=f"Insufficient history: {len(df)} days (need 30+)",
        )

    # Use at most 90 days for regression (older data drags on recent trend)
    df = df.tail(90)
    prices = df["price"].values.astype(float)

    # Guard against zeros/negatives
    prices = np.maximum(prices, 1e-10)
    log_prices = np.log(prices)
    n = len(prices)
    x = np.arange(n, dtype=float)

    # ── Linear regression on log prices ───────────────────────────────────────
    slope, intercept, r_value, _, _ = stats.linregress(x, log_prices)

    # Residual volatility (daily, in log space)
    fitted    = intercept + slope * x
    residuals = log_prices - fitted
    daily_vol = float(residuals.std()) or 1e-6

    current_price = float(prices[-1])

    # ── Forecast forward horizon_days days ────────────────────────────────────
    future_x   = np.arange(n, n + horizon_days, dtype=float)
    log_yhat   = intercept + slope * future_x
    yhat       = np.exp(log_yhat)

    # 90% CI (±1.645σ), uncertainty grows with √h
    h          = np.arange(1, horizon_days + 1, dtype=float)
    sigma_h    = daily_vol * np.sqrt(h)
    upper      = np.exp(log_yhat + 1.645 * sigma_h)
    lower      = np.exp(log_yhat - 1.645 * sigma_h)

    # ── Bull probability ───────────────────────────────────────────────────────
    # P(log_price_T+h > log_price_now) = Φ(slope × h / (σ × √h)) = Φ(slope × √h / σ)
    if daily_vol > 0:
        z_score   = float(slope * np.sqrt(horizon_days) / daily_vol)
        bull_prob = float(stats.norm.cdf(z_score))
    else:
        bull_prob = 0.5

    # ── Labels ────────────────────────────────────────────────────────────────
    if bull_prob > 0.62:
        trend = "bullish"
    elif bull_prob < 0.38:
        trend = "bearish"
    else:
        trend = "neutral"

    # ── RSI ───────────────────────────────────────────────────────────────────
    rsi_val = _rsi(prices)

    # ── Build future dates ────────────────────────────────────────────────────
    last_date = df.index[-1]
    forecast_points = []
    for i in range(horizon_days):
        fdate = (last_date + pd.Timedelta(days=i + 1)).strftime("%Y-%m-%d")
        forecast_points.append(ForecastPoint(
            date=fdate,
            yhat=round(float(yhat[i]), 6),
            yhat_lower=round(float(lower[i]), 6),
            yhat_upper=round(float(upper[i]), 6),
        ))

    # ── Last 30 days of history for the chart ────────────────────────────────
    hist_tail = df.tail(30)
    history_out = [
        {"date": d.strftime("%Y-%m-%d"), "price": round(float(p), 6)}
        for d, p in zip(hist_tail.index, hist_tail["price"])
    ]

    target = forecast_points[-1]

    return ForecastResult(
        market_id=market_id,
        exchange=exchange,
        current_price=round(current_price, 6),
        target_price=target.yhat,
        target_lower=target.yhat_lower,
        target_upper=target.yhat_upper,
        bull_probability=round(bull_prob, 3),
        trend=trend,
        rsi=round(rsi_val, 1),
        r_squared=round(float(r_value ** 2), 3),
        daily_vol_pct=round(float(daily_vol * 100), 2),
        horizon_days=horizon_days,
        history=history_out,
        forecast=forecast_points,
        generated_at=now_iso,
    )


# ── Public API ─────────────────────────────────────────────────────────────────

def get_cached_forecast(
    market_id: str, exchange: str, horizon_days: int = 7
) -> Optional[ForecastResult]:
    key = (market_id, exchange, horizon_days)
    entry = _cache.get(key)
    if entry and time.time() < entry[1]:
        return entry[0]
    return None


def run_forecast(
    market_id:    str,
    exchange:     str,
    history:      list[dict],
    horizon_days: int = 7,
    force:        bool = False,
) -> ForecastResult:
    """Run (or return cached) price forecast. Thread-safe — no async needed."""
    key = (market_id, exchange, horizon_days)

    if not force:
        cached = get_cached_forecast(market_id, exchange, horizon_days)
        if cached:
            return cached

    log.info("Forecaster: running %s/%s horizon=%d days", exchange, market_id, horizon_days)
    try:
        result = _run_forecast(market_id, exchange, history, horizon_days)
    except Exception as exc:
        log.error("Forecaster error %s: %s", market_id, exc)
        now_iso = datetime.now(timezone.utc).isoformat()
        result = ForecastResult(
            market_id=market_id, exchange=exchange,
            current_price=0, target_price=0,
            target_lower=0, target_upper=0,
            bull_probability=0.5, trend="neutral",
            rsi=50, r_squared=0, daily_vol_pct=0,
            horizon_days=horizon_days,
            history=[], forecast=[],
            generated_at=now_iso,
            error=str(exc),
        )

    _cache[key] = (result, time.time() + _CACHE_TTL)
    return result


# ── Forecast grading ───────────────────────────────────────────────────────────

@dataclass
class ForecastGrade:
    market_id:         str
    exchange:          str
    as_of_date:        str
    horizon_days:      int
    forecast_7d:       float   # predicted price at horizon
    actual_7d:         float   # actual price at horizon
    as_of_price:       float   # price at the split point
    direction_correct: bool
    within_ci:         bool
    mape_pct:          float   # Mean Absolute % Error vs as_of_price
    score:             int     # 0–100
    color:             str     # hex — cold (blue) → warm (yellow) → hot (red)
    label:             str     # "cold" | "warm" | "hot" | "very hot"
    generated_at:      str
    note:              Optional[str] = None


def grade_forecast(
    market_id:    str,
    exchange:     str,
    history:      list[dict],
    as_of_date:   str,          # "YYYY-MM-DD" — split point
    horizon_days: int = 7,
) -> ForecastGrade:
    """
    Walk-forward forecast validation:
      1. Split history at as_of_date.
      2. Run the forecaster on pre-split data only.
      3. Score the prediction against actual post-split prices.

    Score (0–100):
      +40  direction correct (bull/bear)
      +40  actual price fell inside the 90% CI
      +20  MAPE < 3%
      +10  MAPE < 7%  (instead of 20)
      + 5  MAPE < 15% (instead of 10)

    Colors (cold → hot):
      0–24   #3b82f6  cold (blue)
      25–49  #eab308  warm (yellow)
      50–74  #f97316  hot (orange)
      75–100 #ef4444  very hot (red)
    """
    now_iso = datetime.now(timezone.utc).isoformat()

    def _fail(note: str) -> ForecastGrade:
        return ForecastGrade(
            market_id=market_id, exchange=exchange,
            as_of_date=as_of_date, horizon_days=horizon_days,
            forecast_7d=0, actual_7d=0, as_of_price=0,
            direction_correct=False, within_ci=False, mape_pct=0,
            score=0, color="#6b7280", label="n/a",
            generated_at=now_iso, note=note,
        )

    df = _to_daily_df(history)
    as_of_ts = pd.Timestamp(as_of_date, tz="UTC")
    train_df  = df[df.index <= as_of_ts]
    actual_df = df[df.index >  as_of_ts].head(horizon_days)

    if len(train_df) < 30:
        return _fail(f"Only {len(train_df)} training days (need 30+)")
    if len(actual_df) == 0:
        return _fail("No actual prices available after as_of_date")

    # Rebuild history list from training slice
    train_history = [
        {"t": int(idx.timestamp()), "p": float(price)}
        for idx, price in zip(train_df.index, train_df["price"])
    ]

    fc = _run_forecast(market_id, exchange, train_history, horizon_days)
    if fc.error or not fc.forecast:
        return _fail(fc.error or "Forecast returned no points")

    as_of_price = float(train_df["price"].iloc[-1])
    actual_days = len(actual_df)
    # Match forecast point to available actual days
    fp = fc.forecast[actual_days - 1]
    actual_7d  = float(actual_df["price"].iloc[-1])
    forecast_7d = fp.yhat

    # ── Score components ──────────────────────────────────────────────────────
    actual_up   = actual_7d > as_of_price
    forecast_up = fc.bull_probability > 0.5
    direction_correct = actual_up == forecast_up
    within_ci         = fp.yhat_lower <= actual_7d <= fp.yhat_upper
    mape_pct = abs(actual_7d - forecast_7d) / as_of_price * 100 if as_of_price else 100.0

    score = 0
    if direction_correct: score += 40
    if within_ci:         score += 40
    if mape_pct < 3:      score += 20
    elif mape_pct < 7:    score += 10
    elif mape_pct < 15:   score += 5

    # ── Color ─────────────────────────────────────────────────────────────────
    if score >= 75:
        color, label = "#ef4444", "very hot"
    elif score >= 50:
        color, label = "#f97316", "hot"
    elif score >= 25:
        color, label = "#eab308", "warm"
    else:
        color, label = "#3b82f6", "cold"

    return ForecastGrade(
        market_id=market_id, exchange=exchange,
        as_of_date=as_of_date, horizon_days=horizon_days,
        forecast_7d=round(forecast_7d, 6),
        actual_7d=round(actual_7d, 6),
        as_of_price=round(as_of_price, 6),
        direction_correct=direction_correct,
        within_ci=within_ci,
        mape_pct=round(mape_pct, 2),
        score=score, color=color, label=label,
        generated_at=now_iso,
    )
