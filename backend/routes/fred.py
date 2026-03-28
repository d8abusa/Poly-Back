"""
FRED API routes — economic data with pull-count budget enforcement.

GET  /api/fred/dashboard          — cached snapshot of all series, no API call
GET  /api/fred/{series_id}        — get series data (cache-first)
POST /api/fred/{series_id}/refresh — force a fresh pull (burns one budget unit)
GET  /api/fred/budget             — how many pulls remain
"""

from fastapi import APIRouter, HTTPException, Query

from ..services.fred_service import get_series, get_dashboard, get_pull_count, SERIES_META, _get_cached
from ..services.macro_context import get_macro_context, macro_context_as_dict
from ..services.fred_prior import calibrate_from_title

router = APIRouter(prefix="/api/fred", tags=["fred"])


@router.get("/macro-context")
async def fred_macro_context():
    """
    Current macro regime derived from cached FRED data.
    Pure cache reads — never burns a pull.
    Includes strategy modifiers (zscore_multiplier, kelly_caution) and
    normalised XGBoost feature vector.
    """
    ctx = get_macro_context()
    return macro_context_as_dict(ctx)


@router.post("/prior")
async def fred_prior(body: dict):
    """
    Estimate a FRED-calibrated probability for a market title.
    Body: {"title": "Will CPI exceed 3.5% in May?"}
    Returns p_true, confidence, series matched, and extrapolation details.
    """
    title = body.get("title", "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    return calibrate_from_title(title)


@router.get("/budget")
async def fred_budget():
    """FRED API pull log — unlimited free tier, 120 req/min rate limit only."""
    used = get_pull_count()
    return {
        "used":      used,
        "budget":    None,
        "remaining": None,
        "warning":   False,
        "note":      "FRED API is free and unlimited; 120 req/min rate limit applies",
    }


@router.get("/dashboard")
async def fred_dashboard():
    """
    Snapshot of all tracked series from cache — never makes an API call.
    Safe to call as often as needed.
    """
    return await get_dashboard()


@router.get("/radar")
async def fred_radar():
    """
    Radar chart data — five FRED indicators normalised to 0–100 using
    long-run historical ranges so the chart is meaningful even with only
    24 cached observations.

    Returns current values and a historical-average baseline (mean of
    all cached observations) for the dashed-outline comparison polygon.
    """
    # Long-run ranges: (min, max) used for 0–100 normalisation.
    # CPI is expressed as YoY % change (converted below).
    RANGES = {
        "T10Y2Y":       (-3.0,  3.5),   # yield spread %
        "T10Y3M":       (-3.0,  3.5),   # 10Y-3M spread (stronger recession signal)
        "DFEDTARU":     ( 0.0, 10.0),   # Fed target rate %
        "CPIAUCSL":     ( 0.0,  8.0),   # YoY % change
        "UNRATE":       ( 3.0, 12.0),   # unemployment %
        "DTWEXBGS":     (90.0,140.0),   # dollar index
        "VIXCLS":       ( 8.0, 50.0),   # VIX: calm=8, crisis=50
        "BAMLH0A0HYM2": ( 1.5,  9.0),  # HY OAS %: tight=1.5, distress=9
        "USEPUINDXD":   ( 50.0, 300.0), # Policy Uncertainty: low=50, extreme=300
    }

    LABELS = {
        "T10Y2Y":       "Yield Spread",
        "T10Y3M":       "10Y-3M Spread",
        "DFEDTARU":     "Fed Rate",
        "CPIAUCSL":     "CPI YoY",
        "UNRATE":       "Unemployment",
        "DTWEXBGS":     "Dollar Index",
        "VIXCLS":       "VIX",
        "BAMLH0A0HYM2": "HY Spread",
        "USEPUINDXD":   "Policy Uncertainty",
    }

    # Invert these so that "higher score = more stress / tighter conditions"
    INVERT = {"T10Y2Y", "T10Y3M", "DTWEXBGS"}  # high spread = low recession risk → invert; strong dollar = tighter

    def _normalise(sid: str, value: float) -> float:
        lo, hi = RANGES[sid]
        pct = (value - lo) / (hi - lo) * 100.0
        pct = max(0.0, min(100.0, pct))
        return round(100.0 - pct if sid in INVERT else pct, 1)

    result = []
    for sid in RANGES:
        rows = _get_cached(sid)
        if not rows:
            result.append({
                "indicator": LABELS[sid],
                "series_id": sid,
                "current":   None,
                "avg":       None,
                "raw":       None,
            })
            continue

        # CPI: convert index to YoY % change
        if sid == "CPIAUCSL" and len(rows) >= 13 and float(rows[0]["value"]) > 50:
            values = [
                (float(rows[i]["value"]) - float(rows[i + 12]["value"]))
                / float(rows[i + 12]["value"]) * 100.0
                for i in range(len(rows) - 12)
            ]
        else:
            values = [float(r["value"]) for r in rows]

        latest = values[0]
        avg    = sum(values) / len(values)

        result.append({
            "indicator": LABELS[sid],
            "series_id": sid,
            "current":   _normalise(sid, latest),
            "avg":       _normalise(sid, avg),
            "raw":       round(latest, 3),
        })

    return {"spokes": result}


@router.get("/radar-history")
async def fred_radar_history():
    """
    Historical radar spoke values — one frame per cached month.

    Uses the same normalization as /radar so the animated fingerprint is
    directly comparable to the current snapshot.  Returns oldest→newest.
    """
    RANGES = {
        "T10Y2Y":       (-3.0,  3.5),
        "T10Y3M":       (-3.0,  3.5),
        "DFEDTARU":     ( 0.0, 10.0),
        "CPIAUCSL":     ( 0.0,  8.0),
        "UNRATE":       ( 3.0, 12.0),
        "DTWEXBGS":     (90.0,140.0),
        "VIXCLS":       ( 8.0, 50.0),
        "BAMLH0A0HYM2": ( 1.5,  9.0),
        "USEPUINDXD":   (50.0, 300.0),
    }
    LABELS = {
        "T10Y2Y":       "Yield Spread",
        "T10Y3M":       "10Y-3M Spread",
        "DFEDTARU":     "Fed Rate",
        "CPIAUCSL":     "CPI YoY",
        "UNRATE":       "Unemployment",
        "DTWEXBGS":     "Dollar Index",
        "VIXCLS":       "VIX",
        "BAMLH0A0HYM2": "HY Spread",
        "USEPUINDXD":   "Policy Uncertainty",
    }
    INVERT = {"T10Y2Y", "T10Y3M", "DTWEXBGS"}

    def _norm(sid: str, value: float) -> float:
        lo, hi = RANGES[sid]
        pct = (value - lo) / (hi - lo) * 100.0
        pct = max(0.0, min(100.0, pct))
        return round(100.0 - pct if sid in INVERT else pct, 1)

    def _to_monthly(rows: list) -> dict[str, float]:
        m: dict = {}
        for r in reversed(rows):
            m[str(r["obs_date"])[:7]] = float(r["value"])
        return m

    series_monthly: dict[str, dict[str, float]] = {}
    for sid in RANGES:
        rows = _get_cached(sid)
        if not rows:
            continue
        raw = _to_monthly(rows)
        if sid == "CPIAUCSL" and len(rows) >= 13 and float(rows[0]["value"]) > 50:
            months = sorted(raw.keys())
            yoy: dict[str, float] = {}
            for i in range(12, len(months)):
                curr, prev = raw[months[i]], raw[months[i - 12]]
                yoy[months[i]] = (curr - prev) / prev * 100.0
            series_monthly[sid] = yoy
        else:
            series_monthly[sid] = raw

    if not series_monthly:
        return {"frames": [], "spokes": list(LABELS.values()), "n_obs": 0}

    # Union of all months that appear in ANY series with >= 2 months of data.
    # We don't require every series to cover every month — missing spokes are
    # simply omitted from that frame rather than collapsing the whole history.
    rich_series = {sid: d for sid, d in series_monthly.items() if len(d) >= 2}
    if not rich_series:
        return {"frames": [], "spokes": list(LABELS.values()), "n_obs": 0}

    all_months = sorted(set().union(*[set(d.keys()) for d in rich_series.values()]))

    frames = []
    for month in all_months:
        spokes = []
        for sid in RANGES:
            if sid not in rich_series:
                continue
            raw_val = rich_series[sid].get(month)
            if raw_val is None:
                continue
            spokes.append({
                "indicator": LABELS[sid],
                "series_id": sid,
                "current":   _norm(sid, raw_val),
                "raw":       round(raw_val, 3),
            })
        if len(spokes) >= 2:          # need at least 2 spokes to draw a shape
            frames.append({"month": month, "spokes": spokes})

    return {
        "frames":  frames,
        "spokes":  list(LABELS.values()),
        "n_obs":   len(frames),
    }


@router.get("/parallel")
async def fred_parallel():
    """
    Parallel coordinates data — FRED indicators normalised to 0–100.

    Each element in `observations` is one calendar month; each entry
    contains the normalised value for every available indicator.
    Lines are sorted oldest→newest so the frontend can colour by index
    (dark = old, bright = recent) to reveal regime transitions.
    """
    SERIES_CONFIG = [
        ("T10Y2Y",       "Yield Spread",  -3.0,   3.5),
        ("DFEDTARU",     "Fed Rate",       0.0,  10.0),
        ("CPIAUCSL",     "CPI YoY %",      0.0,   8.0),
        ("UNRATE",       "Unemployment",   3.0,  12.0),
        ("DTWEXBGS",     "Dollar Index",  90.0, 140.0),
        ("VIXCLS",       "VIX",            8.0,  50.0),
        ("BAMLH0A0HYM2", "HY Spread",      1.5,   9.0),
    ]

    def _norm(value: float, lo: float, hi: float) -> float:
        return round(max(0.0, min(100.0, (value - lo) / (hi - lo) * 100.0)), 1)

    def _to_monthly(rows: list) -> dict:
        m: dict = {}
        for r in reversed(rows):
            m[str(r["obs_date"])[:7]] = float(r["value"])
        return m

    series_monthly: dict[str, dict[str, float]] = {}
    for sid, _label, lo, hi in SERIES_CONFIG:
        rows = _get_cached(sid)
        if not rows:
            continue
        raw = _to_monthly(rows)

        if sid == "CPIAUCSL" and len(rows) >= 13 and float(rows[0]["value"]) > 50:
            months = sorted(raw.keys())
            yoy: dict[str, float] = {}
            for i in range(12, len(months)):
                curr, prev = raw[months[i]], raw[months[i - 12]]
                yoy[months[i]] = (curr - prev) / prev * 100.0
            series_monthly[sid] = {m: _norm(v, lo, hi) for m, v in yoy.items()}
        else:
            series_monthly[sid] = {m: _norm(v, lo, hi) for m, v in raw.items()}

    if len(series_monthly) < 2:
        return {"dimensions": [], "months": [], "n_obs": 0}

    # Common months across all available series
    common_months = sorted(
        set.intersection(*[set(d.keys()) for d in series_monthly.values()])
    )  # oldest → newest

    dimensions = []
    for sid, label, _lo, _hi in SERIES_CONFIG:
        if sid not in series_monthly:
            continue
        dimensions.append({
            "label":     label,
            "series_id": sid,
            "values":    [series_monthly[sid][m] for m in common_months],
            "range":     [0, 100],
        })

    return {
        "dimensions": dimensions,
        "months":     common_months,
        "n_obs":      len(common_months),
    }


@router.get("/correlation")
async def fred_correlation():
    """
    Pearson correlation matrix between FRED indicator time series.

    Uses month-over-month changes (first differences) for stationarity.
    Aligns all series by date before computing pairwise correlations so
    mismatched release schedules don't introduce phantom correlations.

    Returns a matrix suitable for Plotly heatmap rendering:
      { x: [col labels], y: [row labels], z: [[values]], n_obs: int }
    """
    import math

    SERIES = ["T10Y2Y", "DFEDTARU", "CPIAUCSL", "UNRATE", "DTWEXBGS", "GDP", "VIXCLS", "BAMLH0A0HYM2"]
    LABELS = {
        "T10Y2Y":       "Yield Spread",
        "DFEDTARU":     "Fed Rate",
        "CPIAUCSL":     "CPI Index",
        "UNRATE":       "Unemployment",
        "DTWEXBGS":     "Dollar Index",
        "GDP":          "Real GDP",
        "VIXCLS":       "VIX",
        "BAMLH0A0HYM2": "HY Spread",
    }

    def _pearson(xs: list[float], ys: list[float]) -> float | None:
        n = len(xs)
        if n < 3:
            return None
        mx = sum(xs) / n
        my = sum(ys) / n
        num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        dx  = math.sqrt(sum((x - mx) ** 2 for x in xs))
        dy  = math.sqrt(sum((y - my) ** 2 for y in ys))
        if dx < 1e-9 or dy < 1e-9:
            return None
        return round(num / (dx * dy), 3)

    def _to_monthly(rows: list) -> dict[str, float]:
        """Collapse rows to monthly buckets using YYYY-MM as key (last obs per month)."""
        monthly: dict[str, float] = {}
        for r in reversed(rows):           # oldest-first so last write wins
            month = str(r["obs_date"])[:7]  # "2026-03" from "2026-03-26"
            monthly[month] = float(r["value"])
        return monthly

    # Build month-keyed level dicts for each series
    series_monthly: dict[str, dict[str, float]] = {}
    for sid in SERIES:
        rows = _get_cached(sid)
        series_monthly[sid] = _to_monthly(rows) if rows else {}

    # First-differences on monthly levels (month-over-month change)
    series_diffs: dict[str, dict[str, float]] = {}
    for sid in SERIES:
        monthly = series_monthly[sid]
        months  = sorted(monthly.keys())      # oldest→newest
        diffs: dict[str, float] = {}
        for i in range(1, len(months)):
            diffs[months[i]] = monthly[months[i]] - monthly[months[i - 1]]
        series_diffs[sid] = diffs

    # Only keep series that have diff data
    active = [sid for sid in SERIES if series_diffs[sid]]
    if len(active) < 2:
        return {"x": [], "y": [], "z": [], "n_obs": 0, "note": "insufficient data"}

    # Build correlation matrix using pairwise common dates (not global intersection).
    # This handles mismatched frequencies: daily series cover recent months while
    # monthly series cover longer history — requiring all-series overlap yields zero.
    labels = [LABELS[sid] for sid in active]
    z = []
    max_pair_obs = 0
    for row_sid in active:
        row = []
        row_dates = set(series_diffs[row_sid].keys())
        for col_sid in active:
            if row_sid == col_sid:
                row.append(1.0)
                continue
            col_dates  = set(series_diffs[col_sid].keys())
            pair_dates = sorted(row_dates & col_dates, reverse=True)
            if len(pair_dates) > max_pair_obs:
                max_pair_obs = len(pair_dates)
            xs = [series_diffs[row_sid][d] for d in pair_dates]
            ys = [series_diffs[col_sid][d] for d in pair_dates]
            r  = _pearson(xs, ys)
            row.append(r if r is not None else 0.0)
        z.append(row)

    return {
        "x":     labels,
        "y":     labels,
        "z":     z,
        "n_obs": max_pair_obs,
        "note":  f"Pearson r on pairwise first-differences · up to {max_pair_obs} common observations per pair",
    }


@router.get("/cube")
async def fred_cube():
    """
    3D cube heatmap — three FRED indicators as binned spatial axes,
    yield spread as the colour dimension.

    Each voxel represents a macro-regime cell:
      X = CPI YoY %      (inflation pressure)   — 3 bins: Low / Mid / High
      Y = Fed Rate       (policy stance)         — 3 bins: Low / Mid / High
      Z = Unemployment   (labour market)         — 3 bins: Low / Mid / High
    Colour = T10Y2Y Yield Spread (recession signal)

    Returns populated cells (avg colour + observation count) and a ghost
    grid of all 27 possible cell centres so the cube outline is always visible.
    """
    import statistics

    # ── Normalization ranges (same as radar chart) ──────────────────────
    RANGES = {
        "CPIAUCSL":  (0.0,   8.0),    # YoY %
        "DFEDTARU":  (0.0,  10.0),    # Fed target rate
        "UNRATE":    (3.0,  12.0),    # unemployment
        "T10Y2Y":    (-3.0,  3.5),    # yield spread (colour axis)
    }

    BINS   = 3                        # Low / Mid / High
    LABELS = ["Low", "Mid", "High"]
    BIN_CENTERS = [16.7, 50.0, 83.3]  # centres of the three equal-width bins

    def _norm(value: float, lo: float, hi: float) -> float:
        return max(0.0, min(100.0, (value - lo) / (hi - lo) * 100.0))

    def _bin(normalised: float) -> int:
        return min(BINS - 1, int(normalised / (100.0 / BINS)))

    def _to_monthly(rows: list) -> dict[str, float]:
        m: dict = {}
        for r in reversed(rows):
            m[str(r["obs_date"])[:7]] = float(r["value"])
        return m

    # ── Fetch & resample all four series ────────────────────────────────
    series_monthly: dict[str, dict[str, float]] = {}
    for sid, (lo, hi) in RANGES.items():
        rows = _get_cached(sid)
        if not rows:
            series_monthly[sid] = {}
            continue
        raw = _to_monthly(rows)
        if sid == "CPIAUCSL" and len(rows) >= 13 and float(rows[0]["value"]) > 50:
            months = sorted(raw.keys())
            yoy: dict[str, float] = {}
            for i in range(12, len(months)):
                curr, prev = raw[months[i]], raw[months[i - 12]]
                yoy[months[i]] = (curr - prev) / prev * 100.0
            series_monthly[sid] = {m: _norm(v, lo, hi) for m, v in yoy.items()}
        else:
            series_monthly[sid] = {m: _norm(v, lo, hi) for m, v in raw.items()}

    # Common months across all four series
    all_months = [set(series_monthly[s].keys()) for s in RANGES if series_monthly[s]]
    if len(all_months) < 4:
        return {"cells": [], "ghost": [], "n_obs": 0, "bin_labels": LABELS}
    common = sorted(set.intersection(*all_months))

    if len(common) < 3:
        return {"cells": [], "ghost": [], "n_obs": 0, "bin_labels": LABELS}

    # ── Bin each month into the (xi, yi, zi) cell ────────────────────────
    from collections import defaultdict
    cell_values: dict[tuple, list] = defaultdict(list)
    cell_months: dict[tuple, list] = defaultdict(list)

    for month in common:
        xi = _bin(series_monthly["CPIAUCSL"][month])
        yi = _bin(series_monthly["DFEDTARU"][month])
        zi = _bin(series_monthly["UNRATE"][month])
        color_val = series_monthly["T10Y2Y"][month]          # normalised 0–100
        cell_values[(xi, yi, zi)].append(color_val)
        cell_months[(xi, yi, zi)].append(month)

    # ── Populated cells ──────────────────────────────────────────────────
    cells = []
    for (xi, yi, zi), vals in cell_values.items():
        cells.append({
            "x":        BIN_CENTERS[xi],
            "y":        BIN_CENTERS[yi],
            "z":        BIN_CENTERS[zi],
            "color":    round(statistics.mean(vals), 1),
            "n_obs":    len(vals),
            "x_label":  LABELS[xi],
            "y_label":  LABELS[yi],
            "z_label":  LABELS[zi],
            "months":   cell_months[(xi, yi, zi)],
        })

    # ── Ghost grid: all 27 possible cell centres ─────────────────────────
    ghost = [
        {"x": BIN_CENTERS[xi], "y": BIN_CENTERS[yi], "z": BIN_CENTERS[zi]}
        for xi in range(BINS)
        for yi in range(BINS)
        for zi in range(BINS)
    ]

    # ── Rolling-window frames for animation (window = 3 months) ─────────
    WINDOW = 3
    frames = []
    for i in range(WINDOW - 1, len(common)):
        win = common[max(0, i - WINDOW + 1): i + 1]
        win_cells: dict[tuple, list]  = defaultdict(list)
        win_months: dict[tuple, list] = defaultdict(list)
        for m in win:
            xi = _bin(series_monthly["CPIAUCSL"][m])
            yi = _bin(series_monthly["DFEDTARU"][m])
            zi = _bin(series_monthly["UNRATE"][m])
            win_cells[(xi, yi, zi)].append(series_monthly["T10Y2Y"][m])
            win_months[(xi, yi, zi)].append(m)
        frame_cells = [
            {
                "x":       BIN_CENTERS[xi],
                "y":       BIN_CENTERS[yi],
                "z":       BIN_CENTERS[zi],
                "color":   round(statistics.mean(vals), 1),
                "n_obs":   len(vals),
                "x_label": LABELS[xi],
                "y_label": LABELS[yi],
                "z_label": LABELS[zi],
                "months":  win_months[(xi, yi, zi)],
            }
            for (xi, yi, zi), vals in win_cells.items()
        ]
        frames.append({"month": common[i], "cells": frame_cells})

    return {
        "cells":       cells,
        "ghost":       ghost,
        "n_obs":       len(common),
        "bin_labels":  LABELS,
        "frames":      frames,
        "window_size": WINDOW,
        "axes": {
            "x":     "CPI YoY %",
            "y":     "Fed Rate",
            "z":     "Unemployment",
            "color": "Yield Spread",
        },
    }


@router.get("/sunburst")
async def fred_sunburst():
    """
    Hierarchical sunburst of macro stress indicators.

    Indicators are grouped into four categories:
      Growth       — Yield Spread (T10Y2Y), Real GDP
      Price        — CPI YoY (CPIAUCSL), Fed Rate (DFEDTARU)
      Labour       — Unemployment (UNRATE), Nonfarm Payrolls (PAYEMS)
      Conditions   — Dollar Index (DTWEXBGS), VIX (VIXCLS), HY Spread (BAMLH0A0HYM2)

    Stress score (0–100):
      100 = maximum historical stress for that indicator
        0 = minimum / most benign reading
    Cell area AND colour both encode stress so the most alarming
    indicators dominate visually. Minimum cell size = 8 so nothing
    disappears entirely.

    Stress direction per indicator:
      T10Y2Y        — inverted (low spread = high recession risk)
      GDP           — inverted (low growth = stress)
      CPIAUCSL      — direct  (high inflation = stress)
      DFEDTARU      — direct  (high rate = tightening stress)
      UNRATE        — direct  (high unemployment = stress)
      PAYEMS        — MoM change direction (negative change = stress)
      DTWEXBGS      — direct  (strong dollar = tighter conditions)
      VIXCLS        — direct  (high VIX = high fear)
      BAMLH0A0HYM2  — direct  (wide credit spread = distress)
    """
    RANGES = {
        "T10Y2Y":        (-3.0,  3.5),
        "GDP":           ( 0.0,  5.0),   # annualised % growth proxy
        "CPIAUCSL":      ( 0.0,  8.0),   # YoY %
        "DFEDTARU":      ( 0.0, 10.0),
        "UNRATE":        ( 3.0, 12.0),
        "PAYEMS":        ( 0.0,  1.0),   # placeholder — MoM direction used instead
        "DTWEXBGS":      (90.0,140.0),
        "VIXCLS":        ( 8.0, 50.0),   # VIX: 8 = calm, 50 = crisis
        "BAMLH0A0HYM2":  ( 1.5,  9.0),  # HY OAS %: 1.5 = tight, 9 = distress
    }

    HIERARCHY = [
        ("Growth",     ["T10Y2Y",   "GDP"                        ]),
        ("Price",      ["CPIAUCSL", "DFEDTARU"                   ]),
        ("Labour",     ["UNRATE",   "PAYEMS"                     ]),
        ("Conditions", ["DTWEXBGS", "VIXCLS", "BAMLH0A0HYM2"    ]),
    ]

    LABELS = {
        "T10Y2Y":       "Yield Spread",
        "GDP":          "Real GDP",
        "CPIAUCSL":     "CPI YoY",
        "DFEDTARU":     "Fed Rate",
        "UNRATE":       "Unemployment",
        "PAYEMS":       "Payrolls MoM",
        "DTWEXBGS":     "Dollar Index",
        "VIXCLS":       "VIX",
        "BAMLH0A0HYM2": "HY Spread",
    }

    INVERT = {"T10Y2Y", "GDP"}   # low reading = high stress for these

    def _norm(value: float, lo: float, hi: float) -> float:
        return max(0.0, min(100.0, (value - lo) / (hi - lo) * 100.0))

    def _to_monthly(rows: list) -> dict[str, float]:
        m: dict = {}
        for r in reversed(rows):
            m[str(r["obs_date"])[:7]] = float(r["value"])
        return m

    # ── Compute per-indicator stress scores ─────────────────────────────
    indicator_data: dict[str, dict] = {}

    for sid, (lo, hi) in RANGES.items():
        rows = _get_cached(sid)
        if not rows:
            indicator_data[sid] = {"stress": 50.0, "raw": None, "norm": None, "note": "no cache"}
            continue

        raw = _to_monthly(rows)
        months = sorted(raw.keys())

        if sid == "CPIAUCSL" and len(rows) >= 13 and float(rows[0]["value"]) > 50:
            # Convert to YoY %
            if len(months) >= 13:
                latest_yoy = (raw[months[-1]] - raw[months[-13]]) / raw[months[-13]] * 100.0
            else:
                latest_yoy = 0.0
            norm  = _norm(latest_yoy, lo, hi)
            stress = norm
            raw_val = round(latest_yoy, 2)

        elif sid == "GDP":
            # Use QoQ annualised growth approximation from level
            if len(months) >= 2:
                curr, prev = raw[months[-1]], raw[months[-2]]
                qoq_ann = ((curr / prev) ** 4 - 1) * 100.0
                norm   = _norm(qoq_ann, lo, hi)
                stress = 100.0 - norm   # invert: low growth = high stress
                raw_val = round(qoq_ann, 2)
            else:
                norm, stress, raw_val = 50.0, 50.0, None

        elif sid == "PAYEMS":
            # Stress = direction of MoM change, not level
            if len(months) >= 2:
                change = raw[months[-1]] - raw[months[-2]]
                if change < 0:
                    stress = 80.0
                elif change == 0:
                    stress = 50.0
                else:
                    stress = max(5.0, 50.0 - min(change / 100.0, 1.0) * 45.0)
                raw_val = round(change, 1)
            else:
                stress, raw_val = 50.0, None
            norm = stress

        else:
            norm = _norm(float(rows[0]["value"]), lo, hi)
            stress = (100.0 - norm) if sid in INVERT else norm
            raw_val = round(float(rows[0]["value"]), 3)

        indicator_data[sid] = {
            "stress": round(max(8.0, stress), 1),   # minimum size = 8
            "raw":    raw_val,
            "norm":   round(norm, 1),
            "note":   "inverted" if sid in INVERT else "direct",
        }

    # ── Build Plotly sunburst arrays ─────────────────────────────────────
    # Using branchvalues="remainder" (Plotly default): parent value is the
    # ADDITIONAL area beyond children. Setting parents to 0 means each
    # category ring is exactly the sum of its children — no wasted space.
    ids, labels, parents, values, colors, customdata = [], [], [], [], [], []

    # Root node — value 0 = no extra arc, ring = sum of all children
    ids.append("root")
    labels.append("Macro")
    parents.append("")
    values.append(0)
    colors.append(50.0)
    customdata.append({})

    for category, series_list in HIERARCHY:
        cat_stresses = [indicator_data[s]["stress"] for s in series_list if s in indicator_data]
        cat_stress   = round(sum(cat_stresses) / len(cat_stresses), 1) if cat_stresses else 50.0
        # Category value = 0: no extra arc, its ring equals the sum of its leaf children
        ids.append(category)
        labels.append(category)
        parents.append("root")
        values.append(0)
        colors.append(cat_stress)
        customdata.append({"category": True})

        for sid in series_list:
            d = indicator_data.get(sid, {"stress": 50.0, "raw": None, "norm": None, "note": ""})
            label = LABELS.get(sid, sid)
            raw_display = f"{d['raw']}" if d["raw"] is not None else "no data"
            ids.append(sid)
            labels.append(label)
            parents.append(category)
            values.append(d["stress"])   # leaf value drives sector area
            colors.append(d["stress"])
            customdata.append({
                "raw":    raw_display,
                "norm":   d["norm"],
                "stress": d["stress"],
                "note":   d["note"],
            })

    # Overall stress summary
    leaf_stresses = [indicator_data[sid]["stress"] for _, sids in HIERARCHY for sid in sids]
    overall = round(sum(leaf_stresses) / len(leaf_stresses), 1) if leaf_stresses else 50.0

    return {
        "ids":        ids,
        "labels":     labels,
        "parents":    parents,
        "values":     values,
        "colors":     colors,
        "customdata": customdata,
        "overall_stress": overall,
        "interpretation": (
            "elevated" if overall > 65 else
            "moderate" if overall > 40 else
            "benign"
        ),
    }


@router.get("/umap")
async def fred_umap():
    """
    UMAP 2D embedding of the FRED macro feature space.

    Each point = one calendar month, described by 5 normalised indicators
    (Yield Spread, Fed Rate, CPI YoY, Unemployment, Dollar Index).
    UMAP reduces the 5-D space to 2-D while preserving local structure
    so that similar macro environments cluster together.

    Returns:
      points[]:  { month, x, y, yield_spread, fed_rate, cpi_yoy,
                   unemployment, dollar_index, recession_label }
      n_obs:     number of months embedded
      features:  list of feature names in the same order used for embedding
    """
    import numpy as np

    SERIES_CONFIG = [
        ("T10Y2Y",       "Yield Spread",  -3.0,   3.5),
        ("DFEDTARU",     "Fed Rate",       0.0,  10.0),
        ("CPIAUCSL",     "CPI YoY %",      0.0,   8.0),
        ("UNRATE",       "Unemployment",   3.0,  12.0),
        ("DTWEXBGS",     "Dollar Index",  90.0, 140.0),
        ("VIXCLS",       "VIX",            8.0,  50.0),
        ("BAMLH0A0HYM2", "HY Spread",      1.5,   9.0),
    ]

    def _norm(value: float, lo: float, hi: float) -> float:
        return max(0.0, min(100.0, (value - lo) / (hi - lo) * 100.0))

    def _to_monthly(rows: list) -> dict[str, float]:
        m: dict = {}
        for r in reversed(rows):
            m[str(r["obs_date"])[:7]] = float(r["value"])
        return m

    # Build normalised monthly series
    series_monthly: dict[str, dict[str, float]] = {}
    for sid, _label, lo, hi in SERIES_CONFIG:
        rows = _get_cached(sid)
        if not rows:
            continue
        raw = _to_monthly(rows)
        if sid == "CPIAUCSL" and len(rows) >= 13 and float(rows[0]["value"]) > 50:
            months = sorted(raw.keys())
            yoy: dict[str, float] = {}
            for i in range(12, len(months)):
                curr, prev = raw[months[i]], raw[months[i - 12]]
                yoy[months[i]] = (curr - prev) / prev * 100.0
            series_monthly[sid] = {m: _norm(v, lo, hi) for m, v in yoy.items()}
        else:
            series_monthly[sid] = {m: _norm(v, lo, hi) for m, v in raw.items()}

    if len(series_monthly) < 3:
        return {"points": [], "n_obs": 0, "features": [], "note": "insufficient cache"}

    # Common months across all available series
    common = sorted(
        set.intersection(*[set(d.keys()) for d in series_monthly.values()])
    )
    n = len(common)
    if n < 4:
        return {"points": [], "n_obs": n, "features": [], "note": "need ≥4 months"}

    feature_ids    = [sid for sid, *_ in SERIES_CONFIG if sid in series_monthly]
    feature_labels = {sid: lbl for sid, lbl, *_ in SERIES_CONFIG}
    X = np.array([
        [series_monthly[sid][m] for sid in feature_ids]
        for m in common
    ], dtype=np.float32)

    # UMAP — n_neighbors must be < n_samples; clamp generously
    n_neighbors = max(2, min(5, n - 1))
    import umap as umap_lib
    reducer = umap_lib.UMAP(
        n_components=2,
        n_neighbors=n_neighbors,
        min_dist=0.25,
        random_state=42,
        verbose=False,
    )
    embedding = reducer.fit_transform(X)   # shape (n, 2)

    # Derive simple recession label from yield spread (T10Y2Y normalised)
    # < 40 → elevated risk, 40–60 → moderate, > 60 → low
    def _recession_label(ys_norm: float) -> str:
        if ys_norm < 40:   return "elevated"
        if ys_norm < 60:   return "moderate"
        return "low"

    t10y2y_sid = "T10Y2Y"
    points = []
    for i, month in enumerate(common):
        ys  = series_monthly[t10y2y_sid].get(month, 50.0) if t10y2y_sid in series_monthly else 50.0
        pts = {
            "month":        month,
            "x":            round(float(embedding[i, 0]), 4),
            "y":            round(float(embedding[i, 1]), 4),
            "recession_label": _recession_label(ys),
        }
        for sid in feature_ids:
            pts[feature_labels[sid].lower().replace(" ", "_").replace("%", "pct")] = round(
                series_monthly[sid][month], 1
            )
        points.append(pts)

    return {
        "points":   points,
        "n_obs":    n,
        "features": [feature_labels[sid] for sid in feature_ids],
        "note":     f"UMAP(n_neighbors={n_neighbors}, min_dist=0.25) · {n} months · 5 indicators",
    }


@router.get("/network")
async def fred_network():
    """
    Correlation network for force-directed graph rendering.

    Nodes = FRED indicators.  Edges = pairwise Pearson r on first-differences
    where |r| >= threshold.  Only edges above the threshold are returned so the
    graph stays readable.

    Returns nodes[], edges[], and the threshold used.
    """
    import math

    SERIES = ["T10Y2Y", "DFEDTARU", "CPIAUCSL", "UNRATE", "DTWEXBGS", "GDP", "VIXCLS", "BAMLH0A0HYM2"]
    LABELS = {
        "T10Y2Y":       "Yield Spread",
        "DFEDTARU":     "Fed Rate",
        "CPIAUCSL":     "CPI Index",
        "UNRATE":       "Unemployment",
        "DTWEXBGS":     "Dollar Index",
        "GDP":          "Real GDP",
        "VIXCLS":       "VIX",
        "BAMLH0A0HYM2": "HY Spread",
    }
    THRESHOLD = 0.15   # minimum |r| to draw an edge

    def _pearson(xs: list[float], ys: list[float]) -> float | None:
        n = len(xs)
        if n < 3:
            return None
        mx = sum(xs) / n
        my = sum(ys) / n
        num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        dx  = math.sqrt(sum((x - mx) ** 2 for x in xs))
        dy  = math.sqrt(sum((y - my) ** 2 for y in ys))
        if dx < 1e-9 or dy < 1e-9:
            return None
        return round(num / (dx * dy), 3)

    def _to_monthly(rows: list) -> dict[str, float]:
        m: dict = {}
        for r in reversed(rows):
            m[str(r["obs_date"])[:7]] = float(r["value"])
        return m

    # First-differences per series
    series_diffs: dict[str, dict[str, float]] = {}
    for sid in SERIES:
        rows = _get_cached(sid)
        if not rows:
            series_diffs[sid] = {}
            continue
        monthly = _to_monthly(rows)
        months  = sorted(monthly.keys())
        series_diffs[sid] = {
            months[i]: monthly[months[i]] - monthly[months[i - 1]]
            for i in range(1, len(months))
        }

    active = [sid for sid in SERIES if series_diffs[sid]]

    # Pairwise correlations → edges
    edges: list[dict] = []
    connection_count: dict[str, int] = {sid: 0 for sid in active}

    for i in range(len(active)):
        for j in range(i + 1, len(active)):
            a, b    = active[i], active[j]
            a_dates = set(series_diffs[a].keys())
            b_dates = set(series_diffs[b].keys())
            common  = sorted(a_dates & b_dates, reverse=True)
            if len(common) < 3:
                continue
            xs = [series_diffs[a][d] for d in common]
            ys = [series_diffs[b][d] for d in common]
            r  = _pearson(xs, ys)
            if r is None or abs(r) < THRESHOLD:
                continue
            edges.append({
                "source":  a,
                "target":  b,
                "r":       r,
                "abs_r":   abs(r),
                "n_obs":   len(common),
            })
            connection_count[a] += 1
            connection_count[b] += 1

    nodes = [
        {
            "id":           sid,
            "label":        LABELS[sid],
            "n_connections": connection_count.get(sid, 0),
        }
        for sid in active
    ]

    return {
        "nodes":     nodes,
        "edges":     edges,
        "threshold": THRESHOLD,
        "n_active":  len(active),
    }


@router.get("/series")
async def list_series():
    """List all tracked FRED series and their metadata."""
    return {"series": SERIES_META}


@router.get("/{series_id}")
async def get_fred_series(
    series_id: str,
    limit: int = Query(24, ge=1, le=100, description="Number of observations to return"),
):
    """
    Get FRED series data. Serves from cache if fresh; pulls from API only if stale.
    Stale = not pulled within the series refresh window (monthly/weekly depending on series).
    """
    try:
        return await get_series(series_id.upper(), force_refresh=False, limit=limit)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"FRED error: {exc}")


@router.post("/{series_id}/refresh")
async def refresh_fred_series(
    series_id: str,
    limit: int = Query(24, ge=1, le=500),
):
    """
    Force a fresh pull from FRED API regardless of cache freshness.
    WARNING: burns one pull from your 100-pull free budget.
    Use limit=500 for daily series to get ~2 years of history for visualizations.
    Returns 503 if budget is exhausted.
    """
    try:
        return await get_series(series_id.upper(), force_refresh=True, limit=limit)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"FRED error: {exc}")
