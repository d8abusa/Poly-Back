"""
PostgreSQL persistence layer.

Connection string read from DATABASE_URL env var.
All tables are created on first import — safe to call repeatedly.
"""

import json
import os
import uuid
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from typing import Iterator

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://polyback:Willowcr3st@localhost:5432/polyback_db")


@contextmanager
def get_conn():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS positions (
                    id           TEXT PRIMARY KEY,
                    signal_id    TEXT,
                    market_id    TEXT,
                    market_title TEXT,
                    category     TEXT,
                    strategy     TEXT,
                    side         TEXT,
                    entry_price  REAL,
                    current_prob REAL,
                    exit_target  REAL,
                    stop_loss    REAL,
                    shares       REAL,
                    capital      REAL,
                    status       TEXT DEFAULT 'open',
                    entry_date   TEXT,
                    closed_at    TEXT,
                    exit_prob    REAL,
                    close_reason TEXT,
                    realized_pnl REAL,
                    exchange     TEXT DEFAULT 'coinbase'
                );

                CREATE TABLE IF NOT EXISTS signals (
                    id               TEXT PRIMARY KEY,
                    status           TEXT,
                    market_id        TEXT,
                    market_title     TEXT,
                    strategy         TEXT,
                    side             TEXT,
                    entry_price      REAL,
                    target_price     REAL,
                    stop_loss        REAL,
                    suggested_size   REAL,
                    suggested_shares REAL,
                    execution_mode   TEXT,
                    created_at       TEXT,
                    resolved_at      TEXT,
                    payload          TEXT
                );

                CREATE TABLE IF NOT EXISTS fred_cache (
                    series_id    TEXT NOT NULL,
                    obs_date     TEXT NOT NULL,
                    value        REAL NOT NULL,
                    pulled_at    TEXT NOT NULL,
                    release_name TEXT,
                    units        TEXT,
                    PRIMARY KEY (series_id, obs_date)
                );

                CREATE TABLE IF NOT EXISTS fred_pull_log (
                    id        SERIAL PRIMARY KEY,
                    series_id TEXT NOT NULL,
                    pulled_at TEXT NOT NULL,
                    obs_count INTEGER,
                    api_calls INTEGER DEFAULT 1
                );

                CREATE TABLE IF NOT EXISTS risk_state (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS backtest_runs (
                    id           TEXT PRIMARY KEY,
                    run_at       TEXT NOT NULL,
                    strategy     TEXT NOT NULL,
                    exchange     TEXT NOT NULL DEFAULT 'kalshi',
                    market_count INTEGER NOT NULL DEFAULT 0,
                    succeeded    INTEGER NOT NULL DEFAULT 0,
                    failed       INTEGER NOT NULL DEFAULT 0,
                    avg_return   REAL,
                    avg_sharpe   REAL,
                    avg_win_rate REAL,
                    market_titles TEXT,
                    payload      TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_backtest_runs_run_at
                    ON backtest_runs (run_at DESC);
            """)


# ── Cursor helper (returns RealDict rows — no row_to_dict needed) ─────────────

@contextmanager
def get_cursor() -> Iterator[psycopg2.extras.RealDictCursor]:
    """Context manager yielding a RealDictCursor. Auto-commits on exit."""
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ── Helpers ───────────────────────────────────────────────────────────────────

def row_to_dict(row) -> dict:
    return dict(row)


def row_to_list(rows) -> list[dict]:
    return [dict(r) for r in rows]


def signal_to_row(sig) -> dict:
    """Convert a SignalSchema to a flat dict for DB storage."""
    data = sig.model_dump() if hasattr(sig, "model_dump") else sig.__dict__
    return {
        "id":               data.get("id"),
        "status":           data.get("status"),
        "market_id":        data.get("market_id"),
        "market_title":     data.get("market_title"),
        "strategy":         data.get("strategy"),
        "side":             data.get("side"),
        "entry_price":      data.get("entry_price"),
        "target_price":     data.get("target_price"),
        "stop_loss":        data.get("stop_loss"),
        "suggested_size":   data.get("suggested_size"),
        "suggested_shares": data.get("suggested_shares"),
        "execution_mode":   data.get("execution_mode"),
        "created_at":       data.get("created_at"),
        "resolved_at":      data.get("resolved_at"),
        "payload":          json.dumps(data),
    }


# ── Backtest run persistence ──────────────────────────────────────────────────

def save_backtest_run(batch_result, strategy: str, exchange: str = "kalshi") -> str:
    """Persist a BatchBacktestResult to the database. Returns the run ID."""
    run_id  = str(uuid.uuid4())
    run_at  = datetime.now(timezone.utc).isoformat()
    results = batch_result.results if hasattr(batch_result, "results") else []
    ok      = [r for r in results if getattr(r, "success", False)]

    avg_return   = sum(r.total_return  for r in ok) / len(ok) if ok else None
    avg_sharpe   = sum(r.sharpe_ratio  for r in ok) / len(ok) if ok else None
    avg_win_rate = sum(r.win_rate      for r in ok) / len(ok) if ok else None

    titles = json.dumps([getattr(r, "market_title", None) or getattr(r, "condition_id", "") for r in results])
    payload = json.dumps(
        batch_result.model_dump() if hasattr(batch_result, "model_dump") else {}
    )

    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO backtest_runs
                (id, run_at, strategy, exchange, market_count, succeeded, failed,
                 avg_return, avg_sharpe, avg_win_rate, market_titles, payload)
            VALUES
                (%(id)s, %(run_at)s, %(strategy)s, %(exchange)s, %(market_count)s,
                 %(succeeded)s, %(failed)s, %(avg_return)s, %(avg_sharpe)s,
                 %(avg_win_rate)s, %(market_titles)s, %(payload)s)
        """, {
            "id":            run_id,
            "run_at":        run_at,
            "strategy":      strategy,
            "exchange":      exchange,
            "market_count":  len(results),
            "succeeded":     getattr(batch_result, "succeeded", len(ok)),
            "failed":        getattr(batch_result, "failed",    len(results) - len(ok)),
            "avg_return":    round(avg_return,   4) if avg_return   is not None else None,
            "avg_sharpe":    round(avg_sharpe,   4) if avg_sharpe   is not None else None,
            "avg_win_rate":  round(avg_win_rate, 4) if avg_win_rate is not None else None,
            "market_titles": titles,
            "payload":       payload,
        })
    return run_id


def get_backtest_runs(limit: int = 50, offset: int = 0) -> list[dict]:
    """Return saved backtest runs, newest first."""
    with get_cursor() as cur:
        cur.execute(
            "SELECT * FROM backtest_runs ORDER BY run_at DESC LIMIT %s OFFSET %s",
            (limit, offset),
        )
        rows = cur.fetchall()
    runs = []
    for row in rows:
        d = dict(row)
        d["market_titles"] = json.loads(d.get("market_titles") or "[]")
        d["payload"]       = json.loads(d.get("payload")       or "{}")
        runs.append(d)
    return runs


def get_backtest_run(run_id: str) -> dict | None:
    """Return a single saved run by ID, with full payload."""
    with get_cursor() as cur:
        cur.execute("SELECT * FROM backtest_runs WHERE id = %s", (run_id,))
        row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    d["market_titles"] = json.loads(d.get("market_titles") or "[]")
    d["payload"]       = json.loads(d.get("payload")       or "{}")
    return d


# ── 90-day retention policy ───────────────────────────────────────────────────

def purge_old_records(retention_days: int = 90) -> dict[str, int]:
    """
    Delete records older than retention_days from time-series tables.
    Returns counts of deleted rows per table.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat()
    deleted: dict[str, int] = {}

    with get_cursor() as cur:
        # Closed positions older than cutoff
        cur.execute(
            "DELETE FROM positions WHERE status='closed' AND closed_at < %s",
            (cutoff,),
        )
        deleted["positions"] = cur.rowcount

        # Resolved/rejected signals older than cutoff
        cur.execute(
            "DELETE FROM signals WHERE status IN ('approved','auto_executed','rejected') AND resolved_at < %s",
            (cutoff,),
        )
        deleted["signals"] = cur.rowcount

        # Old backtest runs
        cur.execute(
            "DELETE FROM backtest_runs WHERE run_at < %s",
            (cutoff,),
        )
        deleted["backtest_runs"] = cur.rowcount

        # FRED pull log (keep last 90 days of pull history)
        cur.execute(
            "DELETE FROM fred_pull_log WHERE pulled_at < %s",
            (cutoff,),
        )
        deleted["fred_pull_log"] = cur.rowcount

    return deleted


# Run on import
init_db()
