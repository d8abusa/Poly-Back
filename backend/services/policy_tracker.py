"""
Policy outcome tracker — measures whether Fed decisions achieved their stated goals.

For each policy_decision that has a target_metric and target_value:
  - At 6-month and 12-month lags, pull actual FRED data
  - Score: hit (score=1.0) / partial (0.5) / miss (0.0)
  - Aggregate into a rolling credibility score

Credibility score = exponentially weighted average of the last 8 decisions,
most recent weighted higher. Score 0 (no credibility) → 1 (perfect track record).
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, timedelta
from typing import Optional

from .db import get_cursor

log = logging.getLogger(__name__)

# FRED series used to measure each target metric
_METRIC_SERIES: dict[str, str] = {
    "cpi":         "CPIAUCSL",
    "inflation":   "CPIAUCSL",
    "pce":         "PCEPI",
    "unemployment":"UNRATE",
    "gdp":         "GDP",
    "financial_stability": "T10Y3M",
    "growth":      "GDP",
}

# Threshold for "hit" — how close actual must be to target (absolute)
_HIT_THRESHOLD: dict[str, float] = {
    "CPIAUCSL":  0.5,   # within 0.5% of CPI target
    "PCEPI":     0.5,
    "UNRATE":    0.3,   # within 0.3 pp of unemployment target
    "GDP":       1.0,   # within 1.0% of GDP target
    "T10Y3M":    0.2,
}
_DEFAULT_HIT_THRESHOLD = 0.5

# Lags at which we measure
_LAGS_MONTHS = [6, 12]


def score_pending_outcomes() -> list[dict]:
    """
    Check all decisions that are due for outcome measurement.
    Returns list of newly scored outcome records.
    """
    new_scores: list[dict] = []
    today = date.today()

    with get_cursor() as cur:
        cur.execute("""
            SELECT pd.id, pd.decision_date::text, pd.target_metric, pd.target_value,
                   pd.target_date::text
            FROM policy_decisions pd
            WHERE pd.target_metric IS NOT NULL
              AND pd.target_value  IS NOT NULL
              AND pd.decision_type != 'none'
        """)
        decisions = [dict(r) for r in cur.fetchall()]

    for dec in decisions:
        dec_date = date.fromisoformat(dec["decision_date"])
        series   = _METRIC_SERIES.get(dec["target_metric"] or "", "")
        if not series:
            continue
        threshold = _HIT_THRESHOLD.get(series, _DEFAULT_HIT_THRESHOLD)

        for lag in _LAGS_MONTHS:
            measurement_date = _add_months(dec_date, lag)
            if measurement_date > today:
                continue  # not due yet

            # Check if already measured
            with get_cursor() as cur:
                cur.execute("""
                    SELECT id FROM policy_outcomes
                    WHERE decision_id = %s AND lag_months = %s
                """, (dec["id"], lag))
                if cur.fetchone():
                    continue  # already done

            # Pull FRED value near measurement_date
            actual = _lookup_fred(series, measurement_date)
            if actual is None:
                continue

            target    = float(dec["target_value"])
            deviation = actual - target
            abs_dev   = abs(deviation)

            if abs_dev <= threshold:
                score, score_num = "hit", 1.0
            elif abs_dev <= threshold * 2.5:
                score, score_num = "partial", 0.5
            else:
                score, score_num = "miss", 0.0

            outcome = {
                "id":               str(uuid.uuid4()),
                "decision_id":      dec["id"],
                "measurement_date": measurement_date.isoformat(),
                "lag_months":       lag,
                "fred_series":      series,
                "target_value":     target,
                "actual_value":     actual,
                "deviation":        round(deviation, 4),
                "score":            score,
                "score_numeric":    score_num,
            }
            with get_cursor() as cur:
                cur.execute("""
                    INSERT INTO policy_outcomes
                        (id, decision_id, measurement_date, lag_months, fred_series,
                         target_value, actual_value, deviation, score, score_numeric)
                    VALUES
                        (%(id)s, %(decision_id)s, %(measurement_date)s, %(lag_months)s,
                         %(fred_series)s, %(target_value)s, %(actual_value)s,
                         %(deviation)s, %(score)s, %(score_numeric)s)
                    ON CONFLICT DO NOTHING
                """, outcome)
            new_scores.append(outcome)
            log.info(
                "Policy outcome: decision=%s lag=%dm actual=%.2f target=%.2f → %s",
                dec["id"][:8], lag, actual, target, score,
            )

    return new_scores


def credibility_score() -> float:
    """
    Exponentially weighted credibility score (0–1) from last 8 scored decisions.
    More recent outcomes weighted heavier. Returns 0.5 if no data.
    """
    with get_cursor() as cur:
        cur.execute("""
            SELECT po.score_numeric, pd.decision_date::text
            FROM policy_outcomes po
            JOIN policy_decisions pd ON pd.id = po.decision_id
            ORDER BY pd.decision_date DESC, po.lag_months ASC
            LIMIT 16
        """)
        rows = cur.fetchall()

    if not rows:
        return 0.5

    # Group by decision (take the 12-month lag outcome if available, else 6-month)
    seen_decisions: dict[str, float] = {}
    for r in rows:
        key = r["decision_date"]
        if key not in seen_decisions:
            seen_decisions[key] = r["score_numeric"]

    scores = list(seen_decisions.values())[:8]
    if not scores:
        return 0.5

    # Exponential weights: most recent = highest weight
    weights = [0.5 ** i for i in range(len(scores))]
    total_w = sum(weights)
    cred    = sum(s * w for s, w in zip(scores, weights)) / total_w
    return round(cred, 3)


def get_outcomes(limit: int = 20) -> list[dict]:
    with get_cursor() as cur:
        cur.execute("""
            SELECT po.*, pd.decision_date::text, pd.decision_type,
                   pd.rate_change_bps, pd.stated_goal, pd.target_metric,
                   fd.title as document_title
            FROM policy_outcomes po
            JOIN policy_decisions pd ON pd.id = po.decision_id
            LEFT JOIN fraser_documents fd ON fd.id = pd.document_id
            ORDER BY pd.decision_date DESC, po.lag_months ASC
            LIMIT %s
        """, (limit,))
        return [dict(r) for r in cur.fetchall()]


def get_decisions(limit: int = 20) -> list[dict]:
    with get_cursor() as cur:
        cur.execute("""
            SELECT pd.*, fd.title as document_title,
                   COUNT(po.id) as outcome_count,
                   AVG(po.score_numeric) as avg_score
            FROM policy_decisions pd
            LEFT JOIN fraser_documents fd ON fd.id = pd.document_id
            LEFT JOIN policy_outcomes po ON po.decision_id = pd.id
            WHERE pd.decision_type != 'none'
            GROUP BY pd.id, fd.title
            ORDER BY pd.decision_date DESC
            LIMIT %s
        """, (limit,))
        return [dict(r) for r in cur.fetchall()]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _add_months(d: date, months: int) -> date:
    month = d.month + months
    year  = d.year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    day   = min(d.day, _days_in_month(year, month))
    return date(year, month, day)


def _days_in_month(year: int, month: int) -> int:
    import calendar
    return calendar.monthrange(year, month)[1]


def _lookup_fred(series_id: str, target_date: date) -> Optional[float]:
    """
    Return the FRED value closest to target_date from the fred_cache table.
    Searches within ±90 days.
    """
    window_lo = (target_date - timedelta(days=90)).isoformat()
    window_hi = (target_date + timedelta(days=30)).isoformat()
    with get_cursor() as cur:
        cur.execute("""
            SELECT value
            FROM fred_cache
            WHERE series_id = %s AND obs_date BETWEEN %s AND %s
            ORDER BY ABS(EXTRACT(EPOCH FROM (obs_date::date - %s::date)))
            LIMIT 1
        """, (series_id, window_lo, window_hi, target_date.isoformat()))
        row = cur.fetchone()
        return float(row["value"]) if row else None
