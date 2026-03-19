"""
SQLite persistence layer.

Single file database stored at the project root.
All tables are created on first import — safe to call repeatedly.
"""

import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent.parent / "polyback.db"


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript("""
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
                realized_pnl REAL
            );

            CREATE TABLE IF NOT EXISTS fred_cache (
                series_id     TEXT NOT NULL,
                obs_date      TEXT NOT NULL,   -- YYYY-MM-DD of the data point
                value         REAL NOT NULL,
                pulled_at     TEXT NOT NULL,   -- ISO timestamp of the API pull
                release_name  TEXT,            -- human label e.g. "CPI Urban Consumers"
                units         TEXT,            -- e.g. "Percent", "Thousands"
                PRIMARY KEY (series_id, obs_date)
            );

            CREATE TABLE IF NOT EXISTS fred_pull_log (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                series_id     TEXT NOT NULL,
                pulled_at     TEXT NOT NULL,
                obs_count     INTEGER,
                api_calls     INTEGER DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS signals (
                id              TEXT PRIMARY KEY,
                status          TEXT,
                market_id       TEXT,
                market_title    TEXT,
                strategy        TEXT,
                side            TEXT,
                entry_price     REAL,
                target_price    REAL,
                stop_loss       REAL,
                suggested_size  REAL,
                suggested_shares REAL,
                execution_mode  TEXT,
                created_at      TEXT,
                resolved_at     TEXT,
                payload         TEXT
            );
        """)


# ── Helpers ───────────────────────────────────────────────────────────────────

def row_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


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


# Run on import
init_db()
