"""Application state + analytics. One `TrafficService` instance backs every API route.

State (dataset, derived frame, trained model) is swapped atomically as a single
immutable snapshot, so requests never observe a half-retrained model. Training is
serialised with a lock.
"""

from __future__ import annotations

import datetime as dt
import logging
import threading
from dataclasses import dataclass, field
from functools import wraps
from typing import Any, Callable

import numpy as np
import pandas as pd

from . import config, database
from .data_generator import DAY_NAMES, write_sample_csv
from .dataset import CONGESTION_LEVELS, WEATHERS, DatasetError, add_derived_columns, clean_traffic_frame
from .holidays import holidays_between, us_federal_holidays
from .model import FEATURES, ModelBundle, data_fingerprint, train_models

log = logging.getLogger("trafficsense.service")
DAY_SHORT = [d[:3] for d in DAY_NAMES]
DAY_TYPES = ["weekday", "weekend", "holiday"]


def hour_label(hour: int) -> str:
    return f"{hour:02d}:00"


def hour_range_label(hour: int) -> str:
    return f"{hour:02d}:00-{(hour + 1) % 24:02d}:00"


def pct_change(new: float, base: float) -> float:
    return round((new / base - 1.0) * 100.0, 1) if base else 0.0


@dataclass(frozen=True)
class Snapshot:
    raw: pd.DataFrame          # cleaned dataset exactly as stored in SQLite
    data: pd.DataFrame         # with derived columns
    bundle: ModelBundle
    meta: dict[str, str]
    roads: tuple[str, ...]
    free_flow: dict[str, float]
    date_holidays: dict[str, int]
    cache: dict = field(default_factory=dict, compare=False)


def cached(fn: Callable) -> Callable:
    """Memoise analytics per snapshot (cleared automatically when the dataset changes)."""
    @wraps(fn)
    def wrapper(self: "TrafficService", *args, **kwargs):
        snap = self.snapshot
        key = (fn.__name__, args, tuple(sorted(kwargs.items())))
        if key not in snap.cache:
            snap.cache[key] = fn(self, *args, **kwargs)
        return snap.cache[key]
    return wrapper


class TrafficService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._snapshot: Snapshot | None = None

    # ------------------------------------------------------------------ lifecycle
    @property
    def snapshot(self) -> Snapshot:
        if self._snapshot is None:
            raise RuntimeError("TrafficService has not been initialised")
        return self._snapshot

    @property
    def ready(self) -> bool:
        return self._snapshot is not None

    def startup(self) -> None:
        """Ensure a dataset exists in SQLite, then load (or train) the model."""
        database.init_db()
        meta = database.read_meta()
        if database.row_count() == 0 or (meta.get("source") == "sample" and self._sample_is_stale()):
            df = self._load_or_create_sample()
            database.replace_traffic(df, source="sample", filename=config.SAMPLE_CSV.name)
        raw = database.read_traffic()
        with self._lock:
            self._activate(raw, database.read_meta(), allow_cached_model=config.REUSE_SAVED_MODEL)

    def _sample_is_stale(self) -> bool:
        if config.SAMPLE_MAX_AGE_DAYS <= 0:
            return False
        latest = database.read_traffic()["date"].max() if database.row_count() else None
        if latest is None:
            return True
        age = (dt.date.today() - dt.date.fromisoformat(latest)).days
        return age > config.SAMPLE_MAX_AGE_DAYS

    def _load_or_create_sample(self) -> pd.DataFrame:
        csv = config.SAMPLE_CSV
        if csv.exists():
            try:
                df, _ = clean_traffic_frame(pd.read_csv(csv, dtype=str, keep_default_na=False))
                age = (dt.date.today() - dt.date.fromisoformat(df["date"].max())).days
                if config.SAMPLE_MAX_AGE_DAYS <= 0 or age <= config.SAMPLE_MAX_AGE_DAYS:
                    log.info("Loaded sample dataset from %s", csv)
                    return df
                log.info("Sample dataset ends %s (%d days ago); regenerating", df["date"].max(), age)
            except (DatasetError, ValueError) as exc:
                log.warning("Sample CSV unusable (%s); regenerating", exc)
        generated = write_sample_csv(csv, months=config.SAMPLE_MONTHS, seed=config.RANDOM_SEED)
        log.info("Generated %d-row sample dataset at %s", len(generated), csv)
        df, _ = clean_traffic_frame(generated.astype(str))
        return df

    def _activate(self, raw: pd.DataFrame, meta: dict[str, str], allow_cached_model: bool) -> None:
        bundle = None
        if allow_cached_model:
            bundle = ModelBundle.load(config.MODEL_PATH)
            if bundle is not None:
                wants_stat = config.FORCE_STATISTICAL
                if bundle.fingerprint != data_fingerprint(raw) or (wants_stat != (bundle.model_type == "statistical")):
                    bundle = None
                else:
                    log.info("Loaded trained model from %s", config.MODEL_PATH)
        if bundle is None:
            bundle = train_models(raw, force_statistical=config.FORCE_STATISTICAL, seed=config.RANDOM_SEED)
            try:
                if bundle.save(config.MODEL_PATH):
                    log.info("Saved trained model to %s", config.MODEL_PATH)
            except Exception:  # pragma: no cover - saving is best-effort
                log.exception("Could not save model to %s", config.MODEL_PATH)

        data = add_derived_columns(raw)
        free_flow = data.groupby("road_name")["average_speed"].quantile(0.95).round(1).to_dict()
        date_holidays = data.groupby("date")["is_holiday"].max().astype(int).to_dict()
        self._snapshot = Snapshot(
            raw=raw, data=data, bundle=bundle, meta=meta,
            roads=tuple(sorted(data["road_name"].unique())),
            free_flow=free_flow, date_holidays=date_holidays,
        )

    def ingest(self, df: pd.DataFrame, source: str, filename: str | None, mode: str = "replace") -> dict:
        with self._lock:
            if mode == "append":
                combined = pd.concat([self.snapshot.raw, df], ignore_index=True)
                df = combined.drop_duplicates(subset=["date", "time", "road_name"], keep="last")
                df = df.sort_values(["date", "time", "road_name"]).reset_index(drop=True)
            database.replace_traffic(df, source=source, filename=filename)
            self._activate(database.read_traffic(), database.read_meta(), allow_cached_model=False)
            return self.dataset_info()

    def reset_to_sample(self) -> dict:
        df = self._load_or_create_sample()
        return self.ingest(df, source="sample", filename=config.SAMPLE_CSV.name)

    # ------------------------------------------------------------------- helpers
    def dataset_info(self) -> dict[str, Any]:
        snap = self.snapshot
        data = snap.data
        return {
            "source": snap.meta.get("source", "sample"),
            "filename": snap.meta.get("filename") or None,
            "loaded_at": snap.meta.get("loaded_at"),
            "rows": int(len(data)),
            "roads": list(snap.roads),
            "start_date": str(data["date"].min()),
            "end_date": str(data["date"].max()),
            "days": int(data["date"].nunique()),
            "model_type": snap.bundle.model_type,
            "model_trained_at": snap.bundle.trained_at,
            "fallback_reason": snap.bundle.fallback_reason,
        }

    def _filter_road(self, road: str | None) -> pd.DataFrame:
        data = self.snapshot.data
        if road in (None, "", "all"):
            return data
        self.require_road(road)
        return data[data["road_name"] == road]

    def require_road(self, road: str) -> str:
        roads = self.snapshot.roads
        if road in roads:
            return road
        lowered = {r.lower(): r for r in roads}
        if road.lower() in lowered:
            return lowered[road.lower()]
        raise KeyError(f"Unknown road '{road}'. Available roads: {', '.join(roads)}")

    def resolve_holiday(self, date: dt.date) -> tuple[bool, str | None, str]:
        """Is `date` a holiday? Dataset flags win; otherwise use the public-holiday calendar."""
        iso = date.isoformat()
        snap = self.snapshot
        if iso in snap.date_holidays:
            flag = bool(snap.date_holidays[iso])
            name = us_federal_holidays(date.year).get(date) if flag else None
            return flag, name or ("Holiday" if flag else None), "dataset"
        name = us_federal_holidays(date.year).get(date)
        if name:
            return True, name, "calendar"
        same_day = [d for d, f in snap.date_holidays.items() if f and d[5:] == iso[5:]]
        if same_day:
            return True, "Recurring holiday", "dataset (same date in prior year)"
        return False, None, "calendar"

    def _feature_frame(self, road: str, date: dt.date, hours: list[int], weather: str, is_holiday: bool) -> pd.DataFrame:
        dow = date.weekday()
        return pd.DataFrame({
            "road_name": road, "weather": weather, "hour": hours, "day_index": dow,
            "is_weekend": int(dow >= 5), "is_holiday": int(is_holiday),
        })[FEATURES]

    def _weather_mix(self, month: int | None = None) -> dict[str, float]:
        """Historical share of each weather type (per city-hour), preferring the same month."""
        data = self.snapshot.data
        hourly = data.drop_duplicates(["date", "hour"])
        if month is not None:
            same = hourly[hourly["date_ts"].dt.month == month]
            if len(same) >= 24 * 7:
                hourly = same
        shares = hourly["weather"].value_counts(normalize=True)
        return {w: float(shares.get(w, 0.0)) for w in WEATHERS if shares.get(w, 0.0) > 0}

    def _predict_hours(self, road: str, date: dt.date, hours: list[int], weather: str, is_holiday: bool) -> pd.DataFrame:
        bundle = self.snapshot.bundle
        if weather != "auto":
            return bundle.predict(self._feature_frame(road, date, hours, weather, is_holiday))
        mix = self._weather_mix(date.month)
        parts = [bundle.predict(self._feature_frame(road, date, hours, w, is_holiday)) for w in mix]
        out = pd.DataFrame(index=parts[0].index)
        for col in ["vehicle_count", "average_speed"] + [f"p_{c}" for c in CONGESTION_LEVELS]:
            out[col] = sum(part[col] * share for part, share in zip(parts, mix.values()))
        out["congestion_level"] = out[[f"p_{c}" for c in CONGESTION_LEVELS]].to_numpy().argmax(axis=1)
        out["congestion_level"] = out["congestion_level"].map(dict(enumerate(CONGESTION_LEVELS)))
        out["source"] = parts[0]["source"]
        return out

    # ---------------------------------------------------------------- endpoints
    @cached
    def summary(self) -> dict[str, Any]:
        data = self.snapshot.data
        daily = data.groupby("date")["vehicle_count"].sum()
        road_daily = data.groupby(["road_name", "date"])["vehicle_count"].sum().groupby("road_name").mean()
        hourly = data.groupby(["date", "hour"])["vehicle_count"].sum().groupby("hour").mean()
        day_avg = data.groupby(["date", "day_index"])["vehicle_count"].sum().groupby("day_index").mean()
        daytime = hourly.loc[7:20] if len(hourly.loc[7:20]) else hourly  # "sensible travel hours"
        busiest_date = daily.idxmax()

        return {
            "dataset": self.dataset_info(),
            "avg_daily_traffic": int(round(daily.mean())),
            "busiest_road": {
                "name": str(road_daily.idxmax()),
                "avg_daily_vehicles": int(round(road_daily.max())),
                "share_pct": round(float(road_daily.max() / road_daily.sum() * 100), 1),
            },
            "peak_hour": {
                "hour": int(hourly.idxmax()),
                "label": hour_range_label(int(hourly.idxmax())),
                "avg_vehicles": int(round(hourly.max())),
            },
            "quietest_daytime_hour": {
                "hour": int(daytime.idxmin()),
                "label": hour_range_label(int(daytime.idxmin())),
                "avg_vehicles": int(round(daytime.min())),
            },
            "busiest_day": {
                "day": DAY_NAMES[int(day_avg.idxmax())],
                "avg_daily_vehicles": int(round(day_avg.max())),
                "vs_average_pct": pct_change(float(day_avg.max()), float(daily.mean())),
            },
            "busiest_date": {"date": str(busiest_date), "vehicles": int(daily.max())},
            "avg_speed": round(float(data["average_speed"].mean()), 1),
            "total_vehicles": int(data["vehicle_count"].sum()),
            "congestion_share": {
                lvl: round(float((data["congestion_level"] == lvl).mean() * 100), 1) for lvl in CONGESTION_LEVELS
            },
            "road_ranking": [
                {"road": str(r), "avg_daily_vehicles": int(round(v))}
                for r, v in road_daily.sort_values(ascending=False).items()
            ],
        }

    @cached
    def trends(self, granularity: str = "daily", road: str | None = None) -> dict[str, Any]:
        data = self._filter_road(road)
        per_day = data.groupby(["date", "road_name"])["vehicle_count"].sum().unstack(fill_value=0)
        roads = list(per_day.columns)
        daily = pd.DataFrame({
            "total": per_day.sum(axis=1),
            "avg_speed": data.groupby("date")["average_speed"].mean(),
            "high_share": data.groupby("date")["congestion_level"].apply(lambda s: (s == "High").mean() * 100),
            "is_holiday": data.groupby("date")["is_holiday"].max(),
            "rain_hours": data[data["weather"] == "rainy"].groupby("date")["hour"].nunique(),
        }).fillna({"rain_hours": 0})
        daily.index = pd.to_datetime(daily.index)
        per_day.index = pd.to_datetime(per_day.index)

        if granularity == "weekly":
            week = daily.index.to_period("W-SUN").start_time
            grouped = daily.groupby(week)
            road_grouped = per_day.groupby(week)
            days = grouped.size()
            out = pd.DataFrame({
                "total": grouped["total"].sum(),
                "avg_daily": grouped["total"].mean(),
                "avg_speed": grouped["avg_speed"].mean(),
                "high_share": grouped["high_share"].mean(),
                "days": days,
            })
            road_avg = road_grouped.mean()
            points = [
                {
                    "date": idx.strftime("%Y-%m-%d"),
                    "label": f"Week of {idx.strftime('%b %d')}",
                    "total": int(row.total), "avg_daily": int(round(row.avg_daily)),
                    "avg_speed": round(float(row.avg_speed), 1), "high_share": round(float(row.high_share), 1),
                    "days": int(row.days), "partial": bool(row.days < 7),
                    "by_road": {r: int(round(road_avg.loc[idx, r])) for r in roads},
                }
                for idx, row in out.iterrows()
            ]
        elif granularity == "daily":
            rolling = daily["total"].rolling(7, min_periods=1).mean()
            points = [
                {
                    "date": idx.strftime("%Y-%m-%d"),
                    "label": idx.strftime("%b %d"),
                    "day_of_week": DAY_NAMES[idx.dayofweek],
                    "total": int(row.total), "rolling_avg": int(round(rolling.loc[idx])),
                    "avg_speed": round(float(row.avg_speed), 1), "high_share": round(float(row.high_share), 1),
                    "is_holiday": bool(row.is_holiday), "rain_hours": int(row.rain_hours),
                    "by_road": {r: int(per_day.loc[idx, r]) for r in roads},
                }
                for idx, row in daily.iterrows()
            ]
        else:
            raise ValueError("granularity must be 'daily' or 'weekly'")

        monthly = daily["total"].groupby(daily.index.to_period("M")).mean()
        return {
            "granularity": granularity,
            "road": road or "all",
            "roads": roads,
            "points": points,
            "monthly_avg_daily": [
                {"month": p.strftime("%b %Y"), "avg_daily": int(round(v))} for p, v in monthly.items()
            ],
        }

    @cached
    def heatmap(self, road: str | None = None, metric: str = "vehicle_count",
                include_holidays: bool = False) -> dict[str, Any]:
        data = self._filter_road(road)
        if not include_holidays:
            data = data[data["is_holiday"] == 0]
        if metric == "vehicle_count":
            per_slot = data.groupby(["date", "day_index", "hour"])["vehicle_count"].sum()
            grid = per_slot.groupby(["day_index", "hour"]).mean()
            unit = "vehicles/hour"
        elif metric == "average_speed":
            grid = data.groupby(["day_index", "hour"])["average_speed"].mean()
            unit = "km/h"
        elif metric == "high_congestion":
            grid = data.groupby(["day_index", "hour"])["congestion_level"].apply(lambda s: (s == "High").mean() * 100)
            unit = "% of hours High"
        else:
            raise ValueError("metric must be vehicle_count, average_speed or high_congestion")
        cells = [
            {"day": DAY_SHORT[d], "day_index": int(d), "hour": int(h), "value": round(float(v), 1)}
            for (d, h), v in grid.items()
        ]
        top = grid.sort_values(ascending=(metric == "average_speed")).head(5)
        return {
            "road": road or "all", "metric": metric, "unit": unit,
            "days": DAY_SHORT, "hours": list(range(24)), "cells": cells,
            "min": round(float(grid.min()), 1), "max": round(float(grid.max()), 1),
            "worst_slots": [
                {"day": DAY_NAMES[int(d)], "hour": int(h), "label": f"{DAY_NAMES[int(d)]} {hour_range_label(int(h))}",
                 "value": round(float(v), 1)}
                for (d, h), v in top.items()
            ],
            "holidays_excluded": not include_holidays,
        }

    @cached
    def insights(self, road: str | None = None) -> dict[str, Any]:
        data = self._filter_road(road)

        # ---- weekday vs weekend vs holiday
        day_totals = data.groupby(["date", "day_type"])["vehicle_count"].sum().reset_index()
        day_types = {}
        for dtype in DAY_TYPES:
            subset = data[data["day_type"] == dtype]
            if subset.empty:
                continue
            hourly = subset.groupby(["date", "hour"])["vehicle_count"].sum().groupby("hour").mean()
            day_types[dtype] = {
                "days": int(subset["date"].nunique()),
                "avg_daily_vehicles": int(round(day_totals.loc[day_totals["day_type"] == dtype, "vehicle_count"].mean())),
                "avg_speed": round(float(subset["average_speed"].mean()), 1),
                "high_congestion_pct": round(float((subset["congestion_level"] == "High").mean() * 100), 1),
                "peak_hour": int(hourly.idxmax()),
                "peak_hour_label": hour_range_label(int(hourly.idxmax())),
                "peak_hour_vehicles": int(round(hourly.max())),
            }
        profile = (
            data.groupby(["date", "day_type", "hour"])["vehicle_count"].sum()
            .groupby(["day_type", "hour"]).mean().unstack(level=0)
        )
        hourly_profile = [
            {"hour": int(h), "label": hour_label(int(h)),
             **{dtype: int(round(row[dtype])) for dtype in profile.columns if pd.notna(row[dtype])}}
            for h, row in profile.iterrows()
        ]

        # ---- weather effect: raw averages and a controlled comparison
        base_mean = data.groupby(["road_name", "day_type", "hour"])["vehicle_count"].transform("mean")
        base_speed = data.groupby(["road_name", "day_type", "hour"])["average_speed"].transform("mean")
        rel_count = data["vehicle_count"] / base_mean.replace(0, np.nan)
        rel_speed = data["average_speed"] / base_speed.replace(0, np.nan)
        weather_rows = []
        for weather in WEATHERS:
            mask = data["weather"] == weather
            if not mask.any():
                continue
            subset = data[mask]
            weather_rows.append({
                "weather": weather,
                "hours": int(subset[["date", "hour"]].drop_duplicates().shape[0]),
                "avg_vehicles_per_hour": round(float(subset["vehicle_count"].mean()), 1),
                "avg_speed": round(float(subset["average_speed"].mean()), 1),
                "high_congestion_pct": round(float((subset["congestion_level"] == "High").mean() * 100), 1),
                "relative_volume": round(float(rel_count[mask].mean()), 4),
                "relative_speed": round(float(rel_speed[mask].mean()), 4),
            })
        sunny = next((w for w in weather_rows if w["weather"] == "sunny"), weather_rows[0] if weather_rows else None)
        for row in weather_rows:
            row["volume_vs_sunny_pct"] = pct_change(row["relative_volume"], sunny["relative_volume"]) if sunny else 0.0
            row["speed_vs_sunny_pct"] = pct_change(row["relative_speed"], sunny["relative_speed"]) if sunny else 0.0
        total_hours = sum(w["hours"] for w in weather_rows) or 1
        for row in weather_rows:
            row["share_pct"] = round(row["hours"] / total_hours * 100, 1)

        weekday = data[data["day_type"] == "weekday"]
        w_profile = weekday.groupby(["weather", "hour"])["vehicle_count"].mean().unstack(level=0)
        weather_profile = [
            {"hour": int(h), "label": hour_label(int(h)),
             **{w: int(round(row[w])) for w in w_profile.columns if pd.notna(row[w])}}
            for h, row in w_profile.iterrows()
        ]

        # ---- per-road comparison
        roads = []
        for name, subset in data.groupby("road_name"):
            hourly = subset.groupby("hour")["vehicle_count"].mean()
            roads.append({
                "road": str(name),
                "avg_daily_vehicles": int(round(subset.groupby("date")["vehicle_count"].sum().mean())),
                "avg_speed": round(float(subset["average_speed"].mean()), 1),
                "free_flow_speed": self.snapshot.free_flow.get(name),
                "high_congestion_pct": round(float((subset["congestion_level"] == "High").mean() * 100), 1),
                "peak_hour_label": hour_range_label(int(hourly.idxmax())),
            })
        roads.sort(key=lambda r: r["avg_daily_vehicles"], reverse=True)

        holidays = sorted(data.loc[data["is_holiday"] == 1, "date"].unique())
        calendar = holidays_between(dt.date.fromisoformat(data["date"].min()), dt.date.fromisoformat(data["date"].max()))
        holiday_list = [
            {"date": d, "name": calendar.get(dt.date.fromisoformat(d), "Holiday"),
             "vehicles": int(day_totals.loc[day_totals["date"] == d, "vehicle_count"].sum())}
            for d in holidays
        ]

        findings = self._findings(day_types, weather_rows, roads)
        return {
            "road": road or "all",
            "day_types": day_types,
            "hourly_profile": hourly_profile,
            "weather": weather_rows,
            "weather_profile": weather_profile,
            "roads": roads,
            "holidays": holiday_list,
            "findings": findings,
        }

    @staticmethod
    def _findings(day_types: dict, weather_rows: list[dict], roads: list[dict]) -> list[str]:
        notes = []
        wk, we, ho = day_types.get("weekday"), day_types.get("weekend"), day_types.get("holiday")
        if wk and we:
            diff = pct_change(we["avg_daily_vehicles"], wk["avg_daily_vehicles"])
            notes.append(
                f"Weekends carry {abs(diff):.0f}% {'less' if diff < 0 else 'more'} traffic than weekdays, "
                f"peaking around {we['peak_hour_label']} instead of {wk['peak_hour_label']}."
            )
        if wk and ho:
            diff = pct_change(ho["avg_daily_vehicles"], wk["avg_daily_vehicles"])
            notes.append(
                f"Public holidays are {abs(diff):.0f}% {'busier' if diff > 0 else 'quieter'} than a normal weekday, "
                f"with heavy traffic all afternoon peaking around {ho['peak_hour_label']}."
            )
        rain = next((w for w in weather_rows if w["weather"] == "rainy"), None)
        if rain:
            notes.append(
                f"Rain adds {rain['volume_vs_sunny_pct']:+.0f}% vehicles and changes speeds by "
                f"{rain['speed_vs_sunny_pct']:+.0f}% compared with sunny conditions at the same road, hour and day type."
            )
        if roads:
            worst = max(roads, key=lambda r: r["high_congestion_pct"])
            notes.append(
                f"{worst['road']} is the most congestion-prone road ({worst['high_congestion_pct']:.0f}% of hours rated High); "
                f"its worst hour is {worst['peak_hour_label']}."
            )
        return notes

    def predict(self, road: str, date: dt.date, hour: int, weather: str, is_holiday: bool | None = None) -> dict[str, Any]:
        snap = self.snapshot
        road = self.require_road(road)
        holiday_flag, holiday_name, holiday_source = self.resolve_holiday(date)
        if is_holiday is not None:
            holiday_flag, holiday_source = bool(is_holiday), "user"
            holiday_name = holiday_name if is_holiday else None

        pred = self._predict_hours(road, date, [hour], weather, holiday_flag).iloc[0]
        count = float(pred["vehicle_count"])
        low_r, high_r = snap.bundle.residual_ratio
        free_flow = snap.free_flow.get(road) or float(pred["average_speed"])
        speed = float(pred["average_speed"])

        data = snap.data
        day_type = "holiday" if holiday_flag else ("weekend" if date.weekday() >= 5 else "weekday")
        typical = data[(data["road_name"] == road) & (data["hour"] == hour) & (data["day_type"] == day_type)]
        typical_count = float(typical["vehicle_count"].mean()) if len(typical) else None

        actual_row = data[(data["road_name"] == road) & (data["date"] == date.isoformat()) & (data["hour"] == hour)]
        actual = None
        if len(actual_row):
            r = actual_row.iloc[0]
            actual = {"vehicle_count": int(r["vehicle_count"]), "average_speed": float(r["average_speed"]),
                      "congestion_level": r["congestion_level"], "weather": r["weather"]}

        warnings = []
        end = dt.date.fromisoformat(data["date"].max())
        if (date - end).days > 365:
            warnings.append("This date is more than a year beyond the training data; long-range trends are not modelled.")

        return {
            "road": road,
            "date": date.isoformat(),
            "time": hour_label(hour),
            "hour": hour,
            "day_of_week": DAY_NAMES[date.weekday()],
            "weather": weather,
            "is_holiday": holiday_flag,
            "holiday_name": holiday_name,
            "holiday_source": holiday_source,
            "vehicle_count": int(round(count)),
            "vehicle_count_range": [int(round(count * low_r)), int(round(count * high_r))],
            "congestion_level": pred["congestion_level"],
            "congestion_probabilities": {c: round(float(pred[f"p_{c}"]), 3) for c in CONGESTION_LEVELS},
            "average_speed": round(speed, 1),
            "free_flow_speed": free_flow,
            "delay_pct": round(max(0.0, 1 - speed / free_flow) * 100, 1) if free_flow else 0.0,
            "typical_vehicle_count": int(round(typical_count)) if typical_count is not None else None,
            "vs_typical_pct": pct_change(count, typical_count) if typical_count else None,
            "actual": actual,
            "model_used": snap.bundle.model_type,
            "warnings": warnings,
        }

    def best_time(self, road: str, date: dt.date, weather: str = "auto", start_hour: int = 0,
                  end_hour: int = 23, top: int = 5, is_holiday: bool | None = None) -> dict[str, Any]:
        snap = self.snapshot
        road = self.require_road(road)
        if not (0 <= start_hour <= 23 and 0 <= end_hour <= 23 and start_hour <= end_hour):
            raise ValueError("start_hour and end_hour must satisfy 0 <= start_hour <= end_hour <= 23")
        holiday_flag, holiday_name, _ = self.resolve_holiday(date)
        if is_holiday is not None:
            holiday_flag = bool(is_holiday)

        hours = list(range(24))
        pred = self._predict_hours(road, date, hours, weather, holiday_flag)
        free_flow = snap.free_flow.get(road)
        hourly = []
        for h, row in zip(hours, pred.itertuples(index=False)):
            hourly.append({
                "hour": h, "label": hour_label(h), "range_label": hour_range_label(h),
                "vehicle_count": int(round(row.vehicle_count)),
                "average_speed": round(float(row.average_speed), 1),
                "congestion_level": row.congestion_level,
                "in_window": start_hour <= h <= end_hour,
            })
        window = [h for h in hourly if h["in_window"]]
        ranked = sorted(window, key=lambda h: (h["vehicle_count"], -h["average_speed"]))
        best = ranked[: max(1, min(top, len(ranked)))]
        worst = sorted(window, key=lambda h: h["vehicle_count"], reverse=True)[:3]
        peak = worst[0]["vehicle_count"] if worst else 1

        # Best contiguous 2-hour block (useful for "leave between X and Y" advice).
        block = None
        if len(window) >= 2:
            pairs = [(window[i], window[i + 1]) for i in range(len(window) - 1)]
            a, b = min(pairs, key=lambda p: p[0]["vehicle_count"] + p[1]["vehicle_count"])
            block = {"start": a["label"], "end": hour_label((b["hour"] + 1) % 24),
                     "start_hour": a["hour"], "end_hour": (b["hour"] + 1) % 24,
                     "avg_vehicle_count": int(round((a["vehicle_count"] + b["vehicle_count"]) / 2))}

        for item in best:
            item["savings_vs_peak_pct"] = round((1 - item["vehicle_count"] / peak) * 100, 1) if peak else 0.0

        return {
            "road": road, "date": date.isoformat(), "day_of_week": DAY_NAMES[date.weekday()],
            "weather": weather,
            "weather_mix": self._weather_mix(date.month) if weather == "auto" else None,
            "is_holiday": holiday_flag, "holiday_name": holiday_name,
            "window": {"start_hour": start_hour, "end_hour": end_hour},
            "best_hours": best, "worst_hours": worst, "best_block": block,
            "hourly": hourly, "free_flow_speed": free_flow,
            "model_used": snap.bundle.model_type,
        }

    def model_metrics(self) -> dict[str, Any]:
        bundle = self.snapshot.bundle
        return {
            "model_type": bundle.model_type,
            "fallback_reason": bundle.fallback_reason,
            "trained_at": bundle.trained_at,
            "residual_band": {"low_ratio": bundle.residual_ratio[0], "high_ratio": bundle.residual_ratio[1]},
            "rows": int(len(self.snapshot.data)),
            **bundle.metrics,
        }
