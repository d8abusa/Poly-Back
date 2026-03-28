"""
FRED (Federal Reserve Economic Data) service — St. Louis Fed API.

Budget: 100 free pulls total before $50/mo kicks in.
Strategy: pull once per series, cache in SQLite, re-pull only when new
          data is due based on the known release schedule.

Required env var:
    FRED_API_KEY — your FRED API key

Key series tracked:
    CPIAUCSL  — CPI All Urban Consumers (monthly, ~mid-month)
    UNRATE    — Unemployment rate (monthly, first Friday)
    PAYEMS    — Nonfarm payrolls (monthly, first Friday)
    FEDFUNDS  — Effective Fed Funds rate (monthly)
    DFEDTARU  — Fed Funds target upper bound (daily)
    GDP       — Real GDP (quarterly)
    T10Y2Y    — 10Y-2Y Treasury spread (daily, recession signal)
    DTWEXBGS  — Dollar index broad (daily)
"""

import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx

from .db import get_cursor

log = logging.getLogger(__name__)

FRED_BASE = "https://api.stlouisfed.org/fred"

# Release schedule: how many days after period end before new data arrives.
# Used to decide if cached data is stale and worth re-pulling.
_RELEASE_LAG_DAYS: dict[str, int] = {
    "CPIAUCSL":      16,   # CPI — released ~mid-month for prior month
    "UNRATE":         5,   # Unemployment — first Friday of month
    "PAYEMS":         5,   # Nonfarm payrolls — first Friday of month
    "FEDFUNDS":      10,   # Monthly average, ~10 days after month end
    "DFEDTARU":       1,   # Daily, 1-day lag
    "GDP":           30,   # Quarterly, ~30 days after quarter end
    "T10Y2Y":         1,   # Daily, 1-day lag
    "T10Y3M":         1,   # Daily, 1-day lag
    "DTWEXBGS":       3,   # Dollar index, ~3 days
    "VIXCLS":         1,   # VIX — daily, 1-day lag
    "BAMLH0A0HYM2":   1,   # HY credit spread — daily, 1-day lag
    "USEPUINDXD":     1,   # Economic Policy Uncertainty — daily
}

# How often (in days) we should re-check for new data
_REFRESH_DAYS: dict[str, int] = {
    "CPIAUCSL":      32,    # monthly — check once a month
    "UNRATE":        32,
    "PAYEMS":        32,
    "FEDFUNDS":      32,
    "DFEDTARU":       7,    # weekly re-check for daily series
    "GDP":           95,    # quarterly
    "T10Y2Y":         7,
    "T10Y3M":         7,
    "DTWEXBGS":       7,
    "VIXCLS":         7,    # weekly re-check for daily series
    "BAMLH0A0HYM2":   7,
    "USEPUINDXD":     7,
}

# Human-readable labels
SERIES_META: dict[str, dict] = {
    "CPIAUCSL":      {"name": "CPI — All Urban Consumers",          "units": "Index 1982-84=100",  "freq": "Monthly"},
    "UNRATE":        {"name": "Unemployment Rate",                   "units": "Percent",             "freq": "Monthly"},
    "PAYEMS":        {"name": "Nonfarm Payrolls",                    "units": "Thousands",           "freq": "Monthly"},
    "FEDFUNDS":      {"name": "Fed Funds Rate (monthly avg)",        "units": "Percent",             "freq": "Monthly"},
    "DFEDTARU":      {"name": "Fed Funds Target Upper Bound",        "units": "Percent",             "freq": "Daily"},
    "GDP":           {"name": "Real GDP",                            "units": "Billions USD",        "freq": "Quarterly"},
    "T10Y2Y":        {"name": "10Y-2Y Treasury Spread",              "units": "Percent",             "freq": "Daily"},
    "T10Y3M":        {"name": "10Y-3M Treasury Spread",              "units": "Percent",             "freq": "Daily"},
    "DTWEXBGS":      {"name": "US Dollar Index (Broad)",             "units": "Index Jan 2006=100",  "freq": "Daily"},
    "VIXCLS":        {"name": "CBOE Volatility Index (VIX)",         "units": "Index",               "freq": "Daily"},
    "BAMLH0A0HYM2":  {"name": "US HY Option-Adjusted Spread",        "units": "Percent",             "freq": "Daily"},
    "USEPUINDXD":    {"name": "Economic Policy Uncertainty Index",   "units": "Index",               "freq": "Daily"},
}


# ── Pull counter ──────────────────────────────────────────────────────────────

def get_pull_count() -> int:
    """Return total number of FRED API calls made so far."""
    with get_cursor() as cur:
        cur.execute("SELECT COALESCE(SUM(api_calls), 0) AS total FROM fred_pull_log")
        row = cur.fetchone()
        return int(row["total"])


def _log_pull(series_id: str, obs_count: int) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with get_cursor() as cur:
        cur.execute(
            "INSERT INTO fred_pull_log (series_id, pulled_at, obs_count, api_calls) VALUES (%s,%s,%s,1)",
            (series_id, now, obs_count),
        )


# ── Cache helpers ─────────────────────────────────────────────────────────────

def _get_cached(series_id: str) -> list[dict]:
    """Return all cached observations for a series, newest first."""
    with get_cursor() as cur:
        cur.execute(
            "SELECT series_id, obs_date, value, pulled_at, release_name, units "
            "FROM fred_cache WHERE series_id=%s ORDER BY obs_date DESC",
            (series_id,),
        )
        rows = cur.fetchall()
    return [dict(r) for r in rows]


def _last_pull_date(series_id: str) -> Optional[datetime]:
    """When was this series last pulled from FRED API?"""
    with get_cursor() as cur:
        cur.execute(
            "SELECT MAX(pulled_at) AS last FROM fred_pull_log WHERE series_id=%s",
            (series_id,),
        )
        row = cur.fetchone()
    if row and row["last"]:
        return datetime.fromisoformat(row["last"])
    return None


def _is_stale(series_id: str) -> bool:
    """True if series has never been pulled or is due for a refresh."""
    last = _last_pull_date(series_id)
    if last is None:
        return True
    refresh_days = _REFRESH_DAYS.get(series_id, 32)
    return (datetime.now(timezone.utc) - last).days >= refresh_days


def _store_observations(series_id: str, observations: list[dict], meta: dict) -> int:
    """Upsert observations into fred_cache. Returns count stored."""
    now = datetime.now(timezone.utc).isoformat()
    release_name = meta.get("title", SERIES_META.get(series_id, {}).get("name", series_id))
    units = meta.get("units", SERIES_META.get(series_id, {}).get("units", ""))

    stored = 0
    with get_cursor() as cur:
        for obs in observations:
            val_str = obs.get("value", ".")
            if val_str == "." or val_str is None:
                continue  # FRED uses "." for missing values
            try:
                value = float(val_str)
            except ValueError:
                continue
            cur.execute(
                """INSERT INTO fred_cache (series_id, obs_date, value, pulled_at, release_name, units)
                   VALUES (%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (series_id, obs_date) DO UPDATE SET
                       value=EXCLUDED.value,
                       pulled_at=EXCLUDED.pulled_at""",
                (series_id, obs["date"], value, now, release_name, units),
            )
            stored += 1
    return stored


# ── FRED API call ─────────────────────────────────────────────────────────────

async def _fetch_from_fred(series_id: str, limit: int = 24) -> tuple[list[dict], dict]:
    """
    Pull the most recent `limit` observations from FRED API.
    Returns (observations, series_meta).
    Raises RuntimeError if API key missing or request fails.
    """
    api_key = os.getenv("FRED_API_KEY", "")
    if not api_key:
        raise RuntimeError("FRED_API_KEY not set in .env")

    async with httpx.AsyncClient(timeout=15.0) as client:
        # Fetch series metadata
        meta_resp = await client.get(
            f"{FRED_BASE}/series",
            params={"series_id": series_id, "api_key": api_key, "file_type": "json"},
        )
        meta_resp.raise_for_status()
        meta = meta_resp.json().get("seriess", [{}])[0]

        # Fetch observations (most recent N)
        obs_resp = await client.get(
            f"{FRED_BASE}/series/observations",
            params={
                "series_id":    series_id,
                "api_key":      api_key,
                "file_type":    "json",
                "sort_order":   "desc",
                "limit":        limit,
            },
        )
        obs_resp.raise_for_status()
        observations = obs_resp.json().get("observations", [])

    log.info("FRED pull: %s — %d observations", series_id, len(observations))
    return observations, meta


# ── Public interface ──────────────────────────────────────────────────────────

async def get_series(
    series_id: str,
    force_refresh: bool = False,
    limit: int = 24,
) -> dict:
    """
    Get FRED series data — cache-first.

    Returns:
        {
            series_id, name, units, freq,
            observations: [{date, value}, ...],   # newest first
            latest: {date, value},
            pull_count: int,                       # total API calls used
            from_cache: bool,
            last_pulled: str | None,
        }
    """
    series_id = series_id.upper()
    cached = _get_cached(series_id)
    from_cache = True

    if force_refresh or _is_stale(series_id):
        try:
            observations, meta = await _fetch_from_fred(series_id, limit=limit)
            count = _store_observations(series_id, observations, meta)
            _log_pull(series_id, count)
            cached = _get_cached(series_id)
            from_cache = False
            log.info("FRED cached %d observations for %s", count, series_id)
        except RuntimeError as exc:
            if cached:
                log.warning("FRED pull skipped (%s) — serving stale cache for %s", exc, series_id)
            else:
                raise

    meta_info = SERIES_META.get(series_id, {"name": series_id, "units": "", "freq": "Unknown"})
    obs_list = [{"date": r["obs_date"], "value": r["value"]} for r in cached]

    return {
        "series_id":   series_id,
        "name":        cached[0]["release_name"] if cached else meta_info["name"],
        "units":       cached[0]["units"] if cached else meta_info["units"],
        "freq":        meta_info["freq"],
        "observations": obs_list,
        "latest":      obs_list[0] if obs_list else None,
        "count":       len(obs_list),
        "pull_count":  get_pull_count(),
        "from_cache":  from_cache,
        "last_pulled": (_last_pull_date(series_id) or datetime.min).isoformat(),
    }


async def get_dashboard() -> dict:
    """
    Return cached snapshots of all tracked series without making any API calls.
    Used for the dashboard view — never burns a pull.
    """
    result = {}
    for sid in SERIES_META:
        cached = _get_cached(sid)
        last = _last_pull_date(sid)
        result[sid] = {
            "name":        SERIES_META[sid]["name"],
            "units":       SERIES_META[sid]["units"],
            "freq":        SERIES_META[sid]["freq"],
            "latest":      {"date": cached[0]["obs_date"], "value": cached[0]["value"]} if cached else None,
            "prev":        {"date": cached[1]["obs_date"], "value": cached[1]["value"]} if len(cached) > 1 else None,
            "change":      round(cached[0]["value"] - cached[1]["value"], 4) if len(cached) > 1 else None,
            "cached":      bool(cached),
            "stale":       _is_stale(sid),
            "last_pulled": last.isoformat() if last else None,
        }
    result["_meta"] = {"pull_count": get_pull_count(), "pull_budget": 100}
    return result
