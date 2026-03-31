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

# Simple thread-safe connection pool (min=1, max=10).
# Reuses idle connections and enforces a max lifetime so stale
# connections are recycled before Postgres server-side timeout kills them.
try:
    from psycopg2 import pool as _pg_pool
    _pool = _pg_pool.ThreadedConnectionPool(
        minconn=1, maxconn=10,
        dsn=DATABASE_URL,
    )
except Exception:
    _pool = None   # fallback: open a fresh connection each time


def close_pool() -> None:
    """Call on application shutdown to release all pooled connections."""
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None


@contextmanager
def get_conn():
    if _pool is not None:
        conn = _pool.getconn()
        conn.autocommit = False
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            if _pool is not None:
                _pool.putconn(conn)
    else:
        # Fallback: plain connection (no pool)
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


def asset_type_from_exchange(exchange: str) -> str:
    """
    Derive explicit asset class from exchange name.
    Used when recording positions and signals so trading rules
    (PDT, margin cooldowns) can be applied without re-inferring from exchange.

      stock            — equities (Yahoo Finance)
      crypto           — digital assets (Coinbase)
      prediction_market — binary outcome contracts (Kalshi, Polymarket, Manifold)
    """
    if exchange == "yahoo":
        return "stock"
    if exchange in ("coinbase", "coinbase_advanced"):
        return "crypto"
    return "prediction_market"


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
                    exchange     TEXT DEFAULT 'coinbase',
                    asset_type   TEXT DEFAULT 'prediction_market'
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
                    asset_type       TEXT DEFAULT 'prediction_market',
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

                CREATE TABLE IF NOT EXISTS watchlist (
                    id           TEXT PRIMARY KEY,
                    market_id    TEXT UNIQUE NOT NULL,
                    market_title TEXT NOT NULL,
                    category     TEXT NOT NULL DEFAULT 'Other',
                    added_at     TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS alerts (
                    id                TEXT PRIMARY KEY,
                    watchlist_item_id TEXT REFERENCES watchlist(id) ON DELETE CASCADE,
                    market_id         TEXT NOT NULL,
                    market_title      TEXT NOT NULL,
                    trigger           TEXT NOT NULL,
                    triggered_at      TEXT,
                    dismissed_at      TEXT,
                    read              BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at        TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS strategy_equity (
                    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                    strategy            TEXT NOT NULL,
                    market_id           TEXT NOT NULL,
                    exchange            TEXT NOT NULL DEFAULT 'coinbase',
                    initial_capital     REAL NOT NULL DEFAULT 0,
                    current_equity      REAL NOT NULL DEFAULT 0,
                    total_realized_pnl  REAL NOT NULL DEFAULT 0,
                    trade_count         INTEGER NOT NULL DEFAULT 0,
                    win_count           INTEGER NOT NULL DEFAULT 0,
                    last_trade_at       TIMESTAMPTZ,
                    created_at          TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE (strategy, market_id)
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS fraser_documents (
                    id            TEXT PRIMARY KEY,
                    document_type TEXT NOT NULL,
                    doc_date      DATE NOT NULL,
                    title         TEXT NOT NULL,
                    source_url    TEXT,
                    text_content  TEXT,
                    word_count    INTEGER DEFAULT 0,
                    fetched_at    TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_fraser_docs_date ON fraser_documents (doc_date DESC);

                CREATE TABLE IF NOT EXISTS fraser_analysis (
                    id                    TEXT PRIMARY KEY,
                    document_id           TEXT NOT NULL REFERENCES fraser_documents(id) ON DELETE CASCADE,
                    tone_score            REAL NOT NULL,
                    tone_label            TEXT NOT NULL,
                    rate_direction        TEXT NOT NULL,
                    rate_signal_strength  TEXT NOT NULL,
                    bs_direction          TEXT NOT NULL,
                    guidance_strength     TEXT NOT NULL,
                    inflation_concern     REAL DEFAULT 0,
                    employment_concern    REAL DEFAULT 0,
                    growth_concern        REAL DEFAULT 0,
                    key_phrases           TEXT,
                    policy_intent         TEXT,
                    target_metric         TEXT,
                    summary               TEXT,
                    model_used            TEXT NOT NULL,
                    analyzed_at           TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_fraser_analysis_doc ON fraser_analysis (document_id);

                CREATE TABLE IF NOT EXISTS policy_decisions (
                    id                    TEXT PRIMARY KEY,
                    decision_date         DATE NOT NULL,
                    document_id           TEXT REFERENCES fraser_documents(id),
                    decision_type         TEXT NOT NULL,
                    rate_change_bps       INTEGER DEFAULT 0,
                    fed_funds_target      REAL,
                    stated_goal           TEXT,
                    target_metric         TEXT,
                    target_value          REAL,
                    target_date           DATE,
                    created_at            TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_policy_decisions_date ON policy_decisions (decision_date DESC);

                CREATE TABLE IF NOT EXISTS policy_outcomes (
                    id                TEXT PRIMARY KEY,
                    decision_id       TEXT NOT NULL REFERENCES policy_decisions(id) ON DELETE CASCADE,
                    measurement_date  DATE NOT NULL,
                    lag_months        INTEGER NOT NULL,
                    fred_series       TEXT NOT NULL,
                    target_value      REAL NOT NULL,
                    actual_value      REAL NOT NULL,
                    deviation         REAL NOT NULL,
                    score             TEXT NOT NULL,
                    score_numeric     REAL NOT NULL,
                    measured_at       TIMESTAMPTZ DEFAULT NOW()
                );

            """)

            # ── Migrations ────────────────────────────────────────────────────
            # Add asset_type to positions if not present (backfill from exchange)
            cur.execute("""
                ALTER TABLE positions ADD COLUMN IF NOT EXISTS
                    asset_type TEXT DEFAULT 'prediction_market';
            """)
            cur.execute("""
                UPDATE positions SET asset_type = CASE
                    WHEN exchange = 'yahoo'                            THEN 'stock'
                    WHEN exchange IN ('coinbase', 'coinbase_advanced') THEN 'crypto'
                    ELSE 'prediction_market'
                END
                WHERE asset_type IS NULL OR asset_type = 'prediction_market';
            """)

            # Add asset_type to signals if not present (backfill from payload exchange field)
            cur.execute("""
                ALTER TABLE signals ADD COLUMN IF NOT EXISTS
                    asset_type TEXT DEFAULT 'prediction_market';
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
    exchange   = data.get("exchange", "polymarket")
    asset_type = data.get("asset_type") or asset_type_from_exchange(exchange)
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
        "asset_type":       asset_type,
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


def record_trade_equity(pos: dict) -> None:
    """
    Upsert strategy_equity after a position closes.
    Tracks running equity per (strategy, market_id) pair.
    Does NOT influence position sizing yet — controlled by EQUITY_COMPOUNDING_ENABLED.
    """
    pnl      = float(pos.get("realized_pnl") or 0.0)
    capital  = float(pos.get("capital") or 0.0)
    strategy = pos.get("strategy", "unknown")
    market_id= pos.get("market_id", "unknown")
    exchange = pos.get("exchange", "unknown")
    win      = 1 if pnl > 0 else 0
    now      = datetime.now(timezone.utc)

    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO strategy_equity
                (id, strategy, market_id, exchange, initial_capital, current_equity,
                 total_realized_pnl, trade_count, win_count, last_trade_at)
            VALUES
                (gen_random_uuid()::text, %(strategy)s, %(market_id)s, %(exchange)s,
                 %(capital)s, %(capital)s + %(pnl)s, %(pnl)s, 1, %(win)s, %(now)s)
            ON CONFLICT (strategy, market_id) DO UPDATE SET
                current_equity     = strategy_equity.current_equity + %(pnl)s,
                total_realized_pnl = strategy_equity.total_realized_pnl + %(pnl)s,
                trade_count        = strategy_equity.trade_count + 1,
                win_count          = strategy_equity.win_count + %(win)s,
                last_trade_at      = %(now)s
        """, {
            "strategy": strategy, "market_id": market_id, "exchange": exchange,
            "capital": capital, "pnl": pnl, "win": win, "now": now,
        })


def get_strategy_equity() -> list[dict]:
    """Return all strategy equity rows, ordered by total PnL descending."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT strategy, market_id, exchange, initial_capital, current_equity,
                   total_realized_pnl, trade_count, win_count, last_trade_at
            FROM strategy_equity
            ORDER BY total_realized_pnl DESC
        """)
        rows = cur.fetchall()
    return [dict(r) for r in rows]


# Run on import
init_db()
