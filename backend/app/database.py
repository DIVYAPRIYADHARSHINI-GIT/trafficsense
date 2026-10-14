"""SQLite persistence for the active traffic dataset (one table + a key/value meta table)."""

from __future__ import annotations

import datetime as dt
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import pandas as pd

from . import config

COLUMNS = [
    "date", "time", "day_of_week", "road_name", "vehicle_count",
    "average_speed", "weather", "is_holiday", "congestion_level",
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS traffic (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    date             TEXT    NOT NULL,                 -- YYYY-MM-DD
    time             TEXT    NOT NULL,                 -- HH:00
    day_of_week      TEXT    NOT NULL,
    road_name        TEXT    NOT NULL,
    vehicle_count    INTEGER NOT NULL CHECK (vehicle_count >= 0),
    average_speed    REAL    NOT NULL CHECK (average_speed >= 0),
    weather          TEXT    NOT NULL CHECK (weather IN ('sunny', 'cloudy', 'rainy')),
    is_holiday       INTEGER NOT NULL CHECK (is_holiday IN (0, 1)),
    congestion_level TEXT    NOT NULL CHECK (congestion_level IN ('Low', 'Medium', 'High'))
);
CREATE INDEX IF NOT EXISTS idx_traffic_date ON traffic (date);
CREATE INDEX IF NOT EXISTS idx_traffic_road_date ON traffic (road_name, date, time);
CREATE TABLE IF NOT EXISTS dataset_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


@contextmanager
def connect(db_path: Path | None = None) -> Iterator[sqlite3.Connection]:
    path = Path(db_path or config.DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    try:
        yield conn
    finally:
        conn.close()


def init_db(db_path: Path | None = None) -> None:
    with connect(db_path) as conn:
        conn.executescript(SCHEMA)
        conn.commit()


def row_count(db_path: Path | None = None) -> int:
    with connect(db_path) as conn:
        return int(conn.execute("SELECT COUNT(*) FROM traffic").fetchone()[0])


def replace_traffic(df: pd.DataFrame, source: str, filename: str | None = None,
                    db_path: Path | None = None) -> None:
    """Atomically replace the stored dataset and record where it came from."""
    rows = df[COLUMNS].copy()
    rows["vehicle_count"] = rows["vehicle_count"].astype(int)
    rows["is_holiday"] = rows["is_holiday"].astype(int)
    with connect(db_path) as conn:
        try:
            conn.execute("BEGIN")
            conn.execute("DELETE FROM traffic")
            conn.executemany(
                f"INSERT INTO traffic ({', '.join(COLUMNS)}) VALUES ({', '.join('?' * len(COLUMNS))})",
                rows.itertuples(index=False, name=None),
            )
            meta = {
                "source": source,
                "filename": filename or "",
                "loaded_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                "rows": str(len(rows)),
            }
            conn.executemany(
                "INSERT INTO dataset_meta (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                meta.items(),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def read_traffic(db_path: Path | None = None) -> pd.DataFrame:
    with connect(db_path) as conn:
        return pd.read_sql_query(f"SELECT {', '.join(COLUMNS)} FROM traffic ORDER BY date, time, road_name", conn)


def read_meta(db_path: Path | None = None) -> dict[str, str]:
    with connect(db_path) as conn:
        return dict(conn.execute("SELECT key, value FROM dataset_meta").fetchall())
