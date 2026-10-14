"""Synthetic but realistic hourly traffic dataset generator.

Patterns baked in (all documented in the README):
  * Weekday commute peaks 08:00-10:00 and 17:00-20:00, quiet nights.
  * Weekends are lighter overall with a broad midday hump instead of sharp peaks.
  * Public holidays are *heavier* than a normal weekday (leisure / getaway trips),
    with sustained traffic from late morning to the evening.
  * Rain adds demand (people drive instead of walking/cycling), lowers speed and
    reduces effective road capacity, so the same volume becomes more congested.
  * Weather is city-wide and persistent (hourly Markov chain, month-dependent rain odds).
  * Mild seasonality (summer-holiday dip, September back-to-school bump), a slow
    growth trend, day-to-day noise, per-record noise, and rare incidents.

Run standalone:  python -m app.data_generator --out data/traffic_data.csv
"""

from __future__ import annotations

import argparse
import datetime as dt
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from .holidays import holidays_between

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
WEATHER_TYPES = ["sunny", "cloudy", "rainy"]


@dataclass(frozen=True)
class RoadProfile:
    name: str
    capacity: int            # vehicles/hour the road carries before flow breaks down
    free_flow_kmh: float     # uncongested travel speed
    peak_utilisation: float  # weekday-peak demand as a fraction of capacity
    weekend_peak: float      # weekend midday peak relative to the weekday peak
    commute_weight: float    # 1 = sharp commuter peaks, lower = flatter all-day demand


ROADS: tuple[RoadProfile, ...] = (
    RoadProfile("Highway 101", 5400, 100.0, 0.92, 0.62, 1.00),
    RoadProfile("Central Avenue", 2200, 55.0, 0.90, 0.60, 0.90),
    RoadProfile("Main Street", 1700, 45.0, 0.86, 0.82, 0.60),
    RoadProfile("Riverside Drive", 1500, 60.0, 0.80, 0.88, 0.70),
    RoadProfile("Airport Road", 2800, 75.0, 0.78, 0.86, 0.50),
    RoadProfile("Industrial Boulevard", 1900, 65.0, 0.86, 0.42, 1.00),
)

# Relative demand by hour (index = hour of day, max = 1.0).
WEEKDAY_COMMUTE = np.array([
    0.10, 0.07, 0.05, 0.05, 0.08, 0.18, 0.40, 0.66,  # 00-07
    0.96, 1.00, 0.74, 0.60, 0.64, 0.62, 0.60, 0.66,  # 08-15  (morning peak 8-10)
    0.80, 0.95, 1.00, 0.92, 0.64, 0.46, 0.32, 0.18,  # 16-23  (evening peak 17-20)
])
WEEKDAY_FLAT = np.array([
    0.12, 0.08, 0.06, 0.06, 0.09, 0.20, 0.42, 0.62,
    0.78, 0.82, 0.80, 0.80, 0.84, 0.82, 0.80, 0.82,
    0.84, 0.86, 0.86, 0.80, 0.64, 0.48, 0.34, 0.20,
])
WEEKEND_SHAPE = np.array([
    0.22, 0.17, 0.12, 0.09, 0.07, 0.09, 0.15, 0.26,
    0.43, 0.62, 0.80, 0.92, 0.98, 1.00, 0.98, 0.95,
    0.92, 0.88, 0.82, 0.74, 0.62, 0.50, 0.39, 0.29,
])
HOLIDAY_SHAPE = np.array([
    0.14, 0.10, 0.07, 0.06, 0.07, 0.12, 0.22, 0.36,
    0.55, 0.72, 0.85, 0.93, 0.97, 0.98, 0.97, 0.96,
    0.97, 1.00, 0.98, 0.90, 0.74, 0.55, 0.40, 0.27,
])
HOLIDAY_PEAK = 1.06  # holiday sustained level vs weekday peak -> ~15% more vehicles per day

DOW_FACTOR = np.array([0.98, 1.00, 1.01, 1.02, 1.04, 1.00, 0.86])  # Mon..Sun
FRIDAY_EVENING_BOOST = 1.05                                          # 15:00-20:00 on Fridays
MONTH_FACTOR = {1: 0.96, 2: 0.98, 3: 1.00, 4: 1.00, 5: 1.01, 6: 1.00,
                7: 0.95, 8: 0.94, 9: 1.03, 10: 1.02, 11: 1.00, 12: 0.97}
RAIN_PROBABILITY = {1: 0.28, 2: 0.27, 3: 0.26, 4: 0.24, 5: 0.20, 6: 0.15,
                    7: 0.10, 8: 0.11, 9: 0.15, 10: 0.22, 11: 0.27, 12: 0.29}
CLOUD_PROBABILITY = 0.30
WEATHER_PERSISTENCE = 0.92  # chance the weather simply carries over to the next hour

WEATHER_DEMAND = {"sunny": 1.00, "cloudy": 1.03, "rainy": 1.18}
WEATHER_SPEED = {"sunny": 1.00, "cloudy": 0.98, "rainy": 0.86}
WEATHER_CAPACITY = {"sunny": 1.00, "cloudy": 0.98, "rainy": 0.88}

INCIDENT_RATE = 0.0025


def default_date_range(months: int = 6, today: dt.date | None = None) -> tuple[dt.date, dt.date]:
    """The last `months` calendar months, ending yesterday (the last complete day)."""
    today = today or dt.date.today()
    end = today - dt.timedelta(days=1)
    start = (pd.Timestamp(end) - pd.DateOffset(months=months) + pd.Timedelta(days=1)).date()
    return start, end


def _road_weekday_profile(road: RoadProfile) -> np.ndarray:
    blend = road.commute_weight * WEEKDAY_COMMUTE + (1 - road.commute_weight) * WEEKDAY_FLAT
    return blend / blend.max()


def _simulate_weather(timestamps: pd.DatetimeIndex, rng: np.random.Generator) -> np.ndarray:
    weather = np.empty(len(timestamps), dtype=object)
    months = timestamps.month.to_numpy()
    current = "sunny"
    for i, month in enumerate(months):
        if i == 0 or rng.random() > WEATHER_PERSISTENCE:
            p_rain = RAIN_PROBABILITY[int(month)]
            p_cloud = CLOUD_PROBABILITY
            current = rng.choice(WEATHER_TYPES, p=[1 - p_rain - p_cloud, p_cloud, p_rain])
        weather[i] = current
    return weather


def generate_traffic_data(
    start: dt.date | None = None,
    end: dt.date | None = None,
    months: int = 6,
    seed: int = 42,
    roads: tuple[RoadProfile, ...] = ROADS,
) -> pd.DataFrame:
    if start is None or end is None:
        start, end = default_date_range(months)
    rng = np.random.default_rng(seed)

    timestamps = pd.date_range(pd.Timestamp(start), pd.Timestamp(end) + pd.Timedelta(hours=23), freq="h")
    n_hours = len(timestamps)
    hours = timestamps.hour.to_numpy()
    dows = timestamps.dayofweek.to_numpy()
    months_arr = timestamps.month.to_numpy()
    dates = timestamps.normalize()

    holiday_map = holidays_between(start, end)
    holiday_dates = pd.DatetimeIndex([pd.Timestamp(d) for d in holiday_map])
    is_holiday = dates.isin(holiday_dates)
    is_weekend = dows >= 5

    weather = _simulate_weather(timestamps, rng)

    # City-wide modifiers shared by every road.
    unique_days = dates.unique()
    day_noise = pd.Series(rng.normal(1.0, 0.035, len(unique_days)), index=unique_days)
    daily_factor = day_noise.reindex(dates).to_numpy()
    progress = (timestamps - timestamps[0]) / (timestamps[-1] - timestamps[0])
    trend = 1.0 + 0.025 * np.asarray(progress, dtype=float)
    season = np.vectorize(MONTH_FACTOR.get)(months_arr)
    dow_factor = DOW_FACTOR[dows]
    friday_boost = np.where((dows == 4) & (hours >= 15) & (hours <= 19), FRIDAY_EVENING_BOOST, 1.0)
    weather_demand = np.vectorize(WEATHER_DEMAND.get)(weather)
    weather_speed = np.vectorize(WEATHER_SPEED.get)(weather)
    weather_capacity = np.vectorize(WEATHER_CAPACITY.get)(weather)

    frames = []
    for road in roads:
        weekday_profile = _road_weekday_profile(road)
        shape = np.where(
            is_holiday,
            HOLIDAY_SHAPE[hours] * HOLIDAY_PEAK,
            np.where(is_weekend, WEEKEND_SHAPE[hours] * road.weekend_peak, weekday_profile[hours]),
        )
        demand = (
            road.capacity * road.peak_utilisation * shape * dow_factor * friday_boost
            * weather_demand * season * trend * daily_factor
        )
        noise = rng.lognormal(mean=0.0, sigma=0.07, size=n_hours)
        counts = demand * noise

        utilisation = counts / (road.capacity * weather_capacity)
        speed = road.free_flow_kmh * weather_speed / (1.0 + 0.55 * utilisation ** 4)
        speed *= rng.normal(1.0, 0.035, n_hours)

        incident = rng.random(n_hours) < INCIDENT_RATE
        speed = np.where(incident, speed * rng.uniform(0.35, 0.6, n_hours), speed)
        counts = np.where(incident, counts * rng.uniform(0.95, 1.2, n_hours), counts)
        speed = np.clip(speed, 5.0, road.free_flow_kmh * 1.08)

        speed_ratio = speed / road.free_flow_kmh
        congestion = np.where(
            incident | (utilisation >= 0.80) | (speed_ratio < 0.55),
            "High",
            np.where((utilisation >= 0.50) | (speed_ratio < 0.75), "Medium", "Low"),
        )

        frames.append(pd.DataFrame({
            "date": timestamps.strftime("%Y-%m-%d"),
            "time": timestamps.strftime("%H:00"),
            "day_of_week": [DAY_NAMES[d] for d in dows],
            "road_name": road.name,
            "vehicle_count": np.maximum(np.rint(counts), 0).astype(int),
            "average_speed": np.round(speed, 1),
            "weather": weather,
            "is_holiday": is_holiday.astype(int),
            "congestion_level": congestion,
        }))

    data = pd.concat(frames, ignore_index=True)
    return data.sort_values(["date", "time", "road_name"], kind="stable").reset_index(drop=True)


def write_sample_csv(path: Path, months: int = 6, seed: int = 42) -> pd.DataFrame:
    data = generate_traffic_data(months=months, seed=seed)
    path.parent.mkdir(parents=True, exist_ok=True)
    data.to_csv(path, index=False)
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the TrafficSense sample dataset.")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "data" / "traffic_data.csv")
    parser.add_argument("--months", type=int, default=6)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    data = write_sample_csv(args.out, months=args.months, seed=args.seed)
    print(f"Wrote {len(data):,} rows ({data['date'].min()} -> {data['date'].max()}) to {args.out}")
    print(data["congestion_level"].value_counts(normalize=True).round(3).to_string())


if __name__ == "__main__":
    main()
