"""CSV validation / cleaning and derived columns shared by analytics and the model."""

from __future__ import annotations

import io
import re

import numpy as np
import pandas as pd

from .data_generator import DAY_NAMES

REQUIRED_COLUMNS = [
    "date", "time", "road_name", "vehicle_count", "average_speed",
    "weather", "is_holiday", "congestion_level",
]
OPTIONAL_COLUMNS = ["day_of_week"]  # recomputed from `date` so it can never disagree
WEATHERS = ["sunny", "cloudy", "rainy"]
CONGESTION_LEVELS = ["Low", "Medium", "High"]
MIN_ROWS = 100

WEATHER_ALIASES = {
    "sunny": "sunny", "sun": "sunny", "clear": "sunny", "fair": "sunny",
    "cloudy": "cloudy", "cloud": "cloudy", "clouds": "cloudy", "overcast": "cloudy", "partly cloudy": "cloudy",
    "rainy": "rainy", "rain": "rainy", "raining": "rainy", "showers": "rainy", "drizzle": "rainy", "storm": "rainy",
}
CONGESTION_ALIASES = {
    "low": "Low", "light": "Low", "free": "Low", "free flow": "Low",
    "medium": "Medium", "med": "Medium", "moderate": "Medium", "mid": "Medium",
    "high": "High", "heavy": "High", "severe": "High", "jam": "High",
}
BOOL_ALIASES = {
    "1": 1, "0": 0, "1.0": 1, "0.0": 0, "true": 1, "false": 0, "yes": 1, "no": 0,
    "y": 1, "n": 0, "t": 1, "f": 0, "holiday": 1, "": 0,
}
TIME_RE = re.compile(r"^\s*(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap]\.?m\.?)?\s*$", re.IGNORECASE)


class DatasetError(ValueError):
    """Raised when an uploaded file cannot be used at all."""


def parse_hour(value: object) -> float:
    """'08:00' / '8' / '8:30 AM' / '20:00:00' -> 8 / 8 / 8 / 20. NaN when invalid."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return np.nan
    match = TIME_RE.match(str(value))
    if not match:
        return np.nan
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    meridiem = (match.group(3) or "").lower().replace(".", "")
    if meridiem:
        if not 1 <= hour <= 12:
            return np.nan
        hour = hour % 12 + (12 if meridiem == "pm" else 0)
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return np.nan
    return float(hour)


def read_csv_bytes(content: bytes) -> pd.DataFrame:
    if not content.strip():
        raise DatasetError("The uploaded file is empty.")
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            return pd.read_csv(io.BytesIO(content), encoding=encoding, dtype=str, keep_default_na=False)
        except UnicodeDecodeError:
            continue
        except (pd.errors.ParserError, pd.errors.EmptyDataError) as exc:
            raise DatasetError(f"Could not parse the CSV: {exc}") from exc
    raise DatasetError("Could not decode the file. Please upload a UTF-8 CSV.")


def clean_traffic_frame(raw: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Validate and normalise a traffic table. Returns (clean_df, report)."""
    frame = raw.copy()
    frame.columns = [re.sub(r"[\s\-]+", "_", str(c).strip().lower()) for c in frame.columns]
    missing = [c for c in REQUIRED_COLUMNS if c not in frame.columns]
    if missing:
        raise DatasetError(
            "Missing required column(s): " + ", ".join(missing)
            + ". Expected: " + ", ".join(["date", "time", "day_of_week", *REQUIRED_COLUMNS[2:]]) + "."
        )

    received = len(frame)
    reasons: dict[str, int] = {}
    valid = pd.Series(True, index=frame.index)

    def reject(mask: pd.Series, reason: str) -> None:
        nonlocal valid
        newly = mask & valid
        if int(newly.sum()):
            reasons[reason] = int(newly.sum())
        valid &= ~mask

    as_text = lambda col: frame[col].astype(str).str.strip()  # noqa: E731

    dates = pd.to_datetime(as_text("date"), errors="coerce", format="mixed")
    reject(dates.isna(), "invalid date")
    hours = as_text("time").map(parse_hour)
    reject(hours.isna(), "invalid time")
    roads = as_text("road_name")
    reject(roads.eq("") | roads.str.lower().eq("nan"), "missing road_name")
    counts = pd.to_numeric(as_text("vehicle_count"), errors="coerce")
    reject(counts.isna() | (counts < 0), "invalid vehicle_count")
    speeds = pd.to_numeric(as_text("average_speed"), errors="coerce")
    reject(speeds.isna() | (speeds < 0), "invalid average_speed")
    weather = as_text("weather").str.lower().map(WEATHER_ALIASES)
    reject(weather.isna(), "weather must be sunny/cloudy/rainy")
    holiday = as_text("is_holiday").str.lower().map(BOOL_ALIASES)
    reject(holiday.isna(), "invalid is_holiday")
    congestion = as_text("congestion_level").str.lower().map(CONGESTION_ALIASES)
    reject(congestion.isna(), "congestion_level must be Low/Medium/High")

    clean = pd.DataFrame({
        "date": dates.dt.strftime("%Y-%m-%d"),
        "time": hours.map(lambda h: f"{int(h):02d}:00" if pd.notna(h) else None),
        "day_of_week": dates.dt.dayofweek.map(lambda d: DAY_NAMES[int(d)] if pd.notna(d) else None),
        "road_name": roads,
        "vehicle_count": counts.round(),
        "average_speed": speeds.round(1),
        "weather": weather,
        "is_holiday": holiday,
        "congestion_level": congestion,
    })[valid]

    corrected_days = 0
    if "day_of_week" in frame.columns:
        given = as_text("day_of_week")[valid].str.lower()
        corrected_days = int((given.ne("") & given.ne(clean["day_of_week"].str.lower())).sum())

    before = len(clean)
    clean = clean.drop_duplicates(subset=["date", "time", "road_name"], keep="last")
    duplicates = before - len(clean)
    clean = clean.astype({"vehicle_count": int, "is_holiday": int})
    clean = clean.sort_values(["date", "time", "road_name"]).reset_index(drop=True)

    if len(clean) < MIN_ROWS:
        detail = "; ".join(f"{k}: {v}" for k, v in reasons.items()) or "no rows"
        raise DatasetError(f"Only {len(clean)} valid rows found (minimum {MIN_ROWS}). Rejected rows -> {detail}.")

    report = {
        "rows_received": received,
        "rows_loaded": len(clean),
        "rows_rejected": received - before,
        "rejection_reasons": reasons,
        "duplicates_removed": duplicates,
        "day_of_week_corrected": corrected_days,
    }
    return clean, report


def add_derived_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Columns used everywhere downstream: hour, day_index (Mon=0), is_weekend, day_type, timestamp."""
    out = df.copy()
    out["date_ts"] = pd.to_datetime(out["date"])
    out["hour"] = out["time"].str.slice(0, 2).astype(int)
    out["day_index"] = out["date_ts"].dt.dayofweek.astype(int)
    out["is_weekend"] = (out["day_index"] >= 5).astype(int)
    out["is_holiday"] = out["is_holiday"].astype(int)
    out["day_type"] = np.where(out["is_holiday"] == 1, "holiday", np.where(out["is_weekend"] == 1, "weekend", "weekday"))
    out["timestamp"] = out["date_ts"] + pd.to_timedelta(out["hour"], unit="h")
    return out
