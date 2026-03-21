"""
FRED Prior Calculator — estimates market probabilities from economic trend data.

For Polymarket/Kalshi markets whose titles reference an economic threshold
(e.g. "Will CPI exceed 3.5% in May?"), this module:

  1. Matches the title to a tracked FRED series via keyword rules.
  2. Extrapolates the series one period forward via linear regression on the
     most recent N cached observations.
  3. Estimates uncertainty via rolling period-to-period std dev.
  4. Returns P(future_value > threshold) or P(< threshold) as a calibrated
     p_true for Kelly sizing.

All reads are from the PostgreSQL cache — no FRED API calls.
Returns p_true=None when there is no match or insufficient data, so callers
can fall back to their default estimation logic.
"""

import re
import math
import logging
from typing import Optional

from .fred_service import _get_cached

log = logging.getLogger(__name__)


# ── Keyword → series mapping ──────────────────────────────────────────────────

# Each entry: ([keywords], series_id)
# Evaluated in order; first match wins.
_KEYWORD_SERIES: list[tuple[list[str], str]] = [
    (["cpi", "consumer price", "inflation rate", "inflation"],  "CPIAUCSL"),
    (["unemployment", "jobless", "unemployment rate"],          "UNRATE"),
    (["nonfarm payroll", "jobs added", "payroll"],              "PAYEMS"),
    (["fed funds", "federal funds rate"],                       "FEDFUNDS"),
    (["fed cut", "fed raise", "fed hike", "rate cut", "rate hike",
      "fed target", "target rate", "fomc", "policy rate",
      "interest rate", "fed rate"],                             "DFEDTARU"),
    (["gdp", "gross domestic product"],                         "GDP"),
    (["yield spread", "yield curve", "10y-2y", "inverted"],     "T10Y2Y"),
    (["dollar index", "dxy", "us dollar"],                      "DTWEXBGS"),
]


# ── Threshold + direction extraction ─────────────────────────────────────────

_PCT_PATTERN = re.compile(r"(\d+\.?\d*)\s*%")

_BELOW_WORDS = {
    "below", "under", "less than", "lower than", "beneath",
    "fall below", "drop below", "not exceed",
}


def _extract_threshold_and_direction(title: str) -> tuple[Optional[float], str]:
    """
    Extract a numeric threshold and direction ("above"/"below") from a market title.
    Returns (None, "above") when no threshold percentage is found.
    """
    title_lower = title.lower()
    direction = "above"
    for phrase in _BELOW_WORDS:
        if phrase in title_lower:
            direction = "below"
            break

    match = _PCT_PATTERN.search(title)
    if match:
        return float(match.group(1)), direction
    return None, direction


def _match_series(title: str) -> Optional[str]:
    """Return the best-matching FRED series ID for a market title, or None."""
    title_lower = title.lower()
    for keywords, series_id in _KEYWORD_SERIES:
        if any(kw in title_lower for kw in keywords):
            return series_id
    return None


# ── Normal CDF ────────────────────────────────────────────────────────────────

def _normal_cdf(x: float) -> float:
    """Standard normal CDF via math.erf."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


# ── Trend extrapolation ───────────────────────────────────────────────────────

def _estimate_from_trend(
    values: list[float],      # newest-first
    threshold: float,
    direction: str = "above",
    trend_window: int = 6,
) -> dict:
    """
    Extrapolate one period forward via OLS on the last `trend_window` observations,
    then compute P(next_value > threshold) using rolling period-to-period std dev
    as the uncertainty estimate.

    Args:
        values:       newest-first list of cached values
        threshold:    the numeric bar the market is asking about
        direction:    "above" or "below"
        trend_window: how many recent points to use for trend fitting

    Returns a dict with p_true, extrapolated value, sigma, confidence, method.
    """
    n = len(values)
    if n < 3:
        return {"p_true": None, "confidence": 0.0, "method": "insufficient_data"}

    # Oldest-first window for regression
    window = list(reversed(values[:min(trend_window, n)]))
    k = len(window)

    # OLS slope + intercept
    x_mean = (k - 1) / 2.0
    y_mean = sum(window) / k
    num = sum((i - x_mean) * (window[i] - y_mean) for i in range(k))
    den = sum((i - x_mean) ** 2 for i in range(k))
    slope     = num / den if den > 0 else 0.0
    intercept = y_mean - slope * x_mean

    # One period ahead
    extrapolated = intercept + slope * k

    # Uncertainty: mean absolute period-to-period change (up to 12 pairs)
    pairs = [abs(values[i] - values[i + 1]) for i in range(min(11, n - 1))]
    sigma = (sum(pairs) / len(pairs)) if pairs else 0.01
    if sigma < 1e-6:
        sigma = 0.01

    # P(value > threshold)
    z      = (extrapolated - threshold) / sigma
    p_true = _normal_cdf(z) if direction == "above" else (1.0 - _normal_cdf(z))

    # Confidence score: penalised for small sample and high relative uncertainty
    data_conf  = min(1.0, n / 12.0)
    sigma_conf = max(0.0, 1.0 - sigma / max(abs(extrapolated), 0.1))
    confidence = round((data_conf + sigma_conf) / 2.0, 2)

    # Hard-clip p_true to avoid degenerate Kelly inputs
    p_true = round(max(0.05, min(0.95, p_true)), 3)

    return {
        "p_true":       p_true,
        "extrapolated": round(extrapolated, 3),
        "threshold":    threshold,
        "direction":    direction,
        "sigma":        round(sigma, 4),
        "confidence":   confidence,
        "method":       "linear_trend_extrapolation",
        "n_obs":        n,
    }


# ── Public interface ──────────────────────────────────────────────────────────

def _normalize_values(series_id: str, values: list[float]) -> list[float]:
    """
    Convert raw cached FRED values into the units markets typically ask about.

    CPIAUCSL is an index (~314). Markets ask about YoY % change (~3.5%).
    When the threshold is small (< 20) we convert the raw index to YoY % change
    before running the trend estimate, so the comparison is apples-to-apples.

    All other series (UNRATE, DFEDTARU, FEDFUNDS, T10Y2Y) are already in percent
    and need no conversion.
    """
    if series_id != "CPIAUCSL":
        return values
    # Detect: if the first value looks like an index (> 50) and there are >= 13 obs,
    # convert to YoY % change (newest-first → index 0 is latest, index 12 is 1 year ago)
    if len(values) < 13 or values[0] <= 50:
        return values
    yoy_values = []
    for i in range(len(values) - 12):
        curr = values[i]
        prev = values[i + 12]
        if prev > 0:
            yoy_values.append(round((curr - prev) / prev * 100, 3))
    return yoy_values if yoy_values else values


def calibrate_from_title(market_title: str) -> dict:
    """
    Given a Polymarket/Kalshi market title, attempt to derive a FRED-calibrated
    p_true estimate suitable for use as Kelly's true-probability input.

    Returns:
        {
            "series_id":  str | None,
            "p_true":     float | None,   # None if no match or insufficient data
            "confidence": float,          # 0.0–1.0 — how reliable the estimate is
            "method":     str,
            "details":    dict,
        }

    A confidence < 0.4 means the estimate is too uncertain to act on.
    The caller should use p_true only when confidence >= 0.4.
    """
    series_id = _match_series(market_title)
    if series_id is None:
        return {
            "series_id": None, "p_true": None,
            "confidence": 0.0, "method": "no_series_match", "details": {},
        }

    threshold, direction = _extract_threshold_and_direction(market_title)
    if threshold is None:
        return {
            "series_id": series_id, "p_true": None,
            "confidence": 0.0, "method": "no_threshold_found", "details": {},
        }

    rows = _get_cached(series_id)
    if not rows:
        return {
            "series_id": series_id, "p_true": None,
            "confidence": 0.0, "method": "no_cache_data", "details": {},
        }

    values  = [float(r["value"]) for r in rows]   # newest-first
    values  = _normalize_values(series_id, values)
    details = _estimate_from_trend(values, threshold, direction)

    log.info(
        "FRED prior: '%s' → %s threshold=%.2f dir=%s p_true=%s conf=%.2f",
        market_title[:60], series_id, threshold, direction,
        details.get("p_true"), details.get("confidence", 0),
    )

    return {
        "series_id":  series_id,
        "p_true":     details.get("p_true"),
        "confidence": details.get("confidence", 0.0),
        "method":     details.get("method", "unknown"),
        "details":    details,
    }


def calibrate_batch(market_titles: list[str]) -> dict[str, dict]:
    """Calibrate multiple markets at once. Returns {title: calibration_result}."""
    return {title: calibrate_from_title(title) for title in market_titles}
