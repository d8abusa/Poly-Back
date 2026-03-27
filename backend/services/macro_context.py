"""
Macro context service — derives market regime signals from cached FRED data.

All reads come from the local PostgreSQL cache; no FRED API calls are made.
Consumed by strategies to gate entries and modulate position sizing.

Regime signals
--------------
  recession_risk   low | medium | high          (T10Y2Y)
  fed_stance       tightening | easing | neutral (DFEDTARU trend)
  inflation_level  above_target | at_target | below_target (CPI YoY vs 2.5%)
  inflation_trend  rising | falling | stable    (CPI 3-month momentum)
  labor_market     strong | weakening | weak    (UNRATE level)
  dollar_trend     strengthening | weakening | neutral (DTWEXBGS YoY)
  market_fear      low | normal | elevated | high (VIXCLS level)
  credit_stress    tight | moderate | elevated | distress (BAMLH0A0HYM2 level)

Strategy modifiers (applied automatically by the backtest engine)
------------------------------------------------------------------
  zscore_multiplier  multiply user's z_entry threshold (widen in uncertain regimes)
  kelly_caution      multiply user's kelly_fraction (reduce in risky regimes)
"""

from dataclasses import dataclass, field
from typing import Optional

from .fred_service import _get_cached


# ── Data class ────────────────────────────────────────────────────────────────

@dataclass
class MacroContext:
    # Regime labels
    recession_risk:   str    # "low" | "medium" | "high" | "unknown"
    fed_stance:       str    # "tightening" | "easing" | "neutral" | "unknown"
    inflation_level:  str    # "above_target" | "at_target" | "below_target" | "unknown"
    inflation_trend:  str    # "rising" | "falling" | "stable" | "unknown"
    labor_market:     str    # "strong" | "weakening" | "weak" | "unknown"
    dollar_trend:     str    # "strengthening" | "weakening" | "neutral"
    market_fear:      str    # "low" | "normal" | "elevated" | "high" | "unknown"
    credit_stress:    str    # "tight" | "moderate" | "elevated" | "distress" | "unknown"

    # Raw latest values
    yield_spread:  Optional[float]   # T10Y2Y (pct)
    fed_rate:      Optional[float]   # DFEDTARU (pct)
    cpi_yoy:       Optional[float]   # YoY CPI change (pct)
    unemployment:  Optional[float]   # UNRATE (pct)
    vix:           Optional[float]   # VIXCLS
    credit_spread: Optional[float]   # BAMLH0A0HYM2 (pct)

    # Strategy modifiers
    zscore_multiplier: float   # >= 1.0 — widen z_entry in uncertain regimes
    kelly_caution:     float   # 0 < x <= 1.0 — reduce kelly_fraction in risky regimes

    # Normalised feature vector for XGBoost (7 values, scaled to ~[-1, +1])
    features: list = field(default_factory=list)

    # Meta
    has_data:     bool = True
    data_quality: str  = "full"   # "full" | "partial" | "none"


# ── Cache helpers ─────────────────────────────────────────────────────────────

def _latest(rows: list) -> Optional[float]:
    return float(rows[0]["value"]) if rows else None


def _n_ago(rows: list, n: int) -> Optional[float]:
    return float(rows[n]["value"]) if len(rows) > n else None


# ── Public interface ──────────────────────────────────────────────────────────

def get_macro_context() -> MacroContext:
    """
    Derive macro regime from cached FRED data.
    Pure cache reads — never touches the FRED API.
    Returns a MacroContext with has_data=False if the cache is empty.
    """
    t10y2y   = _get_cached("T10Y2Y")
    dfedtaru = _get_cached("DFEDTARU")
    fedfunds = _get_cached("FEDFUNDS")
    cpi      = _get_cached("CPIAUCSL")
    unrate   = _get_cached("UNRATE")
    dtwexbgs = _get_cached("DTWEXBGS")
    vixcls   = _get_cached("VIXCLS")
    baml     = _get_cached("BAMLH0A0HYM2")

    has_data = bool(t10y2y or dfedtaru or cpi or unrate)
    if not has_data:
        return MacroContext(
            recession_risk="unknown", fed_stance="unknown",
            inflation_level="unknown", inflation_trend="unknown",
            labor_market="unknown", dollar_trend="neutral",
            market_fear="unknown", credit_stress="unknown",
            yield_spread=None, fed_rate=None, cpi_yoy=None, unemployment=None,
            vix=None, credit_spread=None,
            zscore_multiplier=1.0, kelly_caution=1.0,
            features=[0.0] * 7,
            has_data=False, data_quality="none",
        )

    # ── Recession risk ────────────────────────────────────────────────────────
    spread = _latest(t10y2y)
    if spread is None:
        recession_risk = "unknown"
    elif spread < -0.5:
        recession_risk = "high"
    elif spread < 0.0:
        recession_risk = "medium"
    else:
        recession_risk = "low"

    # ── Fed stance ────────────────────────────────────────────────────────────
    # Prefer daily DFEDTARU resampled to monthly; fall back to monthly FEDFUNDS.
    # Resampling to monthly before the 12-period lookback gives a true 12-month
    # comparison regardless of whether the source series is daily or monthly.
    fed_rate = None
    fed_rate_prior = None

    if dfedtaru:
        # Collapse daily rows to monthly buckets (last observation per month)
        monthly_rates: dict[str, float] = {}
        for r in reversed(dfedtaru):          # oldest-first so last write wins
            month = str(r["obs_date"])[:7]
            monthly_rates[month] = float(r["value"])
        monthly_sorted = sorted(monthly_rates.keys(), reverse=True)  # newest-first
        if monthly_sorted:
            fed_rate = monthly_rates[monthly_sorted[0]]
            if len(monthly_sorted) > 12:
                fed_rate_prior = monthly_rates[monthly_sorted[12]]
    elif fedfunds:
        # FEDFUNDS is already monthly — direct index lookup is correct
        fed_rate       = _latest(fedfunds)
        fed_rate_prior = _n_ago(fedfunds, 12)

    if fed_rate is None or fed_rate_prior is None:
        fed_stance = "neutral"
    elif fed_rate > fed_rate_prior + 0.1:
        fed_stance = "tightening"
    elif fed_rate < fed_rate_prior - 0.1:
        fed_stance = "easing"
    else:
        fed_stance = "neutral"

    # ── Inflation ─────────────────────────────────────────────────────────────
    cpi_latest = _latest(cpi)
    cpi_12ago  = _n_ago(cpi, 12)   # 12 months back for YoY
    cpi_3ago   = _n_ago(cpi, 3)    # 3 months back for trend

    if cpi_latest is None or cpi_12ago is None or cpi_12ago == 0:
        cpi_yoy         = None
        inflation_level = "unknown"
        inflation_trend = "unknown"
    else:
        cpi_yoy = round((cpi_latest - cpi_12ago) / cpi_12ago * 100, 2)

        if cpi_yoy > 3.0:
            inflation_level = "above_target"
        elif cpi_yoy >= 1.5:
            inflation_level = "at_target"
        else:
            inflation_level = "below_target"

        if cpi_3ago is not None and cpi_3ago > 0:
            mom_3 = (cpi_latest - cpi_3ago) / cpi_3ago * 100
            if mom_3 > 0.3:
                inflation_trend = "rising"
            elif mom_3 < -0.1:
                inflation_trend = "falling"
            else:
                inflation_trend = "stable"
        else:
            inflation_trend = "stable"

    # ── Labor market ──────────────────────────────────────────────────────────
    ur = _latest(unrate)
    if ur is None:
        labor_market = "unknown"
        unemployment = None
    else:
        unemployment = ur
        if ur < 4.0:
            labor_market = "strong"
        elif ur <= 5.0:
            labor_market = "weakening"
        else:
            labor_market = "weak"

    # ── Dollar trend ──────────────────────────────────────────────────────────
    dollar_latest = _latest(dtwexbgs)
    # DTWEXBGS is weekly — 52 observations ≈ 1 year
    dollar_1yr = _n_ago(dtwexbgs, 52)

    if dollar_latest is None or dollar_1yr is None or dollar_1yr == 0:
        dollar_trend = "neutral"
    else:
        d_chg = (dollar_latest - dollar_1yr) / dollar_1yr * 100
        if d_chg > 3.0:
            dollar_trend = "strengthening"
        elif d_chg < -3.0:
            dollar_trend = "weakening"
        else:
            dollar_trend = "neutral"

    # ── Market fear (VIX) ─────────────────────────────────────────────────────
    vix = _latest(vixcls)
    if vix is None:
        market_fear = "unknown"
    elif vix < 15:
        market_fear = "low"
    elif vix < 25:
        market_fear = "normal"
    elif vix < 35:
        market_fear = "elevated"
    else:
        market_fear = "high"

    # ── Credit stress (HY OAS) ────────────────────────────────────────────────
    credit_spread = _latest(baml)
    if credit_spread is None:
        credit_stress = "unknown"
    elif credit_spread < 3.0:
        credit_stress = "tight"
    elif credit_spread < 5.0:
        credit_stress = "moderate"
    elif credit_spread < 7.0:
        credit_stress = "elevated"
    else:
        credit_stress = "distress"

    # ── Strategy modifiers ────────────────────────────────────────────────────

    # Z-score: widen entry threshold in uncertain macro environments so we
    # don't mistake regime shifts for reversion opportunities.
    # VIX "high" adds further widening — market dislocation can break mean-reversion.
    if recession_risk == "high" or market_fear == "high":
        zscore_multiplier = 1.40
    elif recession_risk == "medium" or market_fear == "elevated":
        zscore_multiplier = 1.20
    elif credit_stress in ("elevated", "distress"):
        zscore_multiplier = 1.15
    else:
        zscore_multiplier = 1.0

    # Kelly caution: reduce sizing when macro is unsettled.
    # Worst-case: recession risk + credit distress → floor at 0.55.
    kelly_caution = 1.0
    if recession_risk == "high" and credit_stress in ("elevated", "distress"):
        kelly_caution = 0.55
    elif recession_risk == "high" or market_fear == "high":
        kelly_caution = 0.65
    elif credit_stress == "distress":
        kelly_caution = 0.65
    elif inflation_level == "above_target" and fed_stance == "tightening":
        kelly_caution = 0.75
    elif market_fear == "elevated" or credit_stress == "elevated":
        kelly_caution = 0.80
    elif fed_stance == "easing" and recession_risk == "low" and market_fear in ("low", "normal"):
        kelly_caution = 1.0   # benign environment — no caution

    # ── Normalised XGBoost features ───────────────────────────────────────────
    # 7 features, each scaled to roughly [-1, +1] so they blend with probability features
    f_spread  = (spread / 2.0)               if spread        is not None else 0.0
    f_rate    = ((fed_rate - 3.0) / 4.0)     if fed_rate      is not None else 0.0
    f_cpi     = ((cpi_yoy - 2.5) / 3.0)      if cpi_yoy       is not None else 0.0
    f_ur      = ((ur - 4.0) / 2.0)           if ur            is not None else 0.0
    f_dollar  = 0.0
    if dollar_latest is not None and dollar_1yr is not None and dollar_1yr > 0:
        f_dollar = ((dollar_latest - dollar_1yr) / dollar_1yr * 100) / 5.0
    # VIX centred on 20 (historical median), scaled by 15
    f_vix     = ((vix - 20.0) / 15.0)        if vix           is not None else 0.0
    # HY spread centred on 4% (historical avg), scaled by 3
    f_credit  = ((credit_spread - 4.0) / 3.0) if credit_spread is not None else 0.0
    features = [f_spread, f_rate, f_cpi, f_ur, f_dollar, f_vix, f_credit]

    partial = sum(
        1 for v in [spread, fed_rate, cpi_yoy, ur, dollar_latest, vix, credit_spread]
        if v is not None
    )
    data_quality = "full" if partial == 7 else ("partial" if partial > 0 else "none")

    return MacroContext(
        recession_risk=recession_risk,
        fed_stance=fed_stance,
        inflation_level=inflation_level,
        inflation_trend=inflation_trend,
        labor_market=labor_market,
        dollar_trend=dollar_trend,
        market_fear=market_fear,
        credit_stress=credit_stress,
        yield_spread=spread,
        fed_rate=fed_rate,
        cpi_yoy=cpi_yoy,
        unemployment=unemployment,
        vix=vix,
        credit_spread=credit_spread,
        zscore_multiplier=zscore_multiplier,
        kelly_caution=kelly_caution,
        features=features,
        has_data=has_data,
        data_quality=data_quality,
    )


def macro_context_as_dict(ctx: MacroContext) -> dict:
    """Serialise MacroContext for JSON API responses."""
    return {
        "regime": {
            "recession_risk":  ctx.recession_risk,
            "fed_stance":      ctx.fed_stance,
            "inflation_level": ctx.inflation_level,
            "inflation_trend": ctx.inflation_trend,
            "labor_market":    ctx.labor_market,
            "dollar_trend":    ctx.dollar_trend,
            "market_fear":     ctx.market_fear,
            "credit_stress":   ctx.credit_stress,
        },
        "values": {
            "yield_spread":  ctx.yield_spread,
            "fed_rate":      ctx.fed_rate,
            "cpi_yoy":       ctx.cpi_yoy,
            "unemployment":  ctx.unemployment,
            "vix":           ctx.vix,
            "credit_spread": ctx.credit_spread,
        },
        "strategy_modifiers": {
            "zscore_multiplier": ctx.zscore_multiplier,
            "kelly_caution":     ctx.kelly_caution,
        },
        "xgb_features": ctx.features,
        "meta": {
            "has_data":     ctx.has_data,
            "data_quality": ctx.data_quality,
        },
    }
