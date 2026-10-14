"""Export precomputed JSON for the frontend's offline mode.

The GitHub Pages site falls back to these files when the Render backend is asleep
or unreachable. Everything is computed by the same TrafficService the API uses,
so the numbers match the live backend for the bundled sample dataset.

Output (default: ../frontend/public/data/):
  meta.json                      dataset coverage, roads, model type
  summary.json                   GET /api/summary
  trends-daily[-<road>].json     GET /api/trends?granularity=daily[&road=]
  trends-weekly[-<road>].json    GET /api/trends?granularity=weekly[&road=]
  heatmap-<metric>[-<road>].json GET /api/heatmap?metric=...[&road=]
  insights[-<road>].json         GET /api/insights[?road=]
  model-metrics.json             GET /api/model-metrics
  predictions.json               table for every road x hour x day x weather x holiday
  manifest.json                  index of files + generation timestamp

Run from backend/:  python -m scripts.export_static [--out DIR]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_OUT = BACKEND_DIR.parent / "frontend" / "public" / "data"


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def to_jsonable(value):
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(v) for v in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return None if np.isnan(value) else round(float(value), 4)
    if isinstance(value, float):
        return None if value != value else round(value, 4)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, (pd.Timestamp, dt.date, dt.datetime)):
        return value.isoformat()
    return value


def write(out: Path, name: str, payload, files: list[str]) -> None:
    path = out / name
    path.write_text(json.dumps(to_jsonable(payload), separators=(",", ":")), encoding="utf-8")
    files.append(name)


def build_prediction_table(service) -> dict:
    """Predictions for every road x hour x day-of-week x weather x holiday flag.

    Stored compactly: values[road][day][holiday][weather][hour] = [count, speed, level, pLow, pMed, pHigh].
    """
    from app.dataset import CONGESTION_LEVELS, WEATHERS
    from app.model import FEATURES

    snap = service.snapshot
    roads = list(snap.roads)
    rows = []
    for road in roads:
        for day in range(7):
            for holiday in (0, 1):
                for weather in WEATHERS:
                    for hour in range(24):
                        rows.append({"road_name": road, "weather": weather, "hour": hour, "day_index": day,
                                     "is_weekend": int(day >= 5), "is_holiday": holiday})
    frame = pd.DataFrame(rows)[FEATURES]
    pred = snap.bundle.predict(frame)
    level_index = {lvl: i for i, lvl in enumerate(CONGESTION_LEVELS)}

    values: dict = {}
    for (_, feat), (_, p) in zip(frame.iterrows(), pred.iterrows()):
        cell = [
            int(round(p["vehicle_count"])), round(float(p["average_speed"]), 1), level_index[p["congestion_level"]],
            *[round(float(p[f"p_{c}"]), 3) for c in CONGESTION_LEVELS],
        ]
        (values.setdefault(feat["road_name"], {}).setdefault(str(feat["day_index"]), {})
         .setdefault(str(feat["is_holiday"]), {}).setdefault(feat["weather"], [])).append(cell)

    # Typical vehicle count per road / day type / hour (for "vs typical" in offline mode).
    data = snap.data
    typical = (data.groupby(["road_name", "day_type", "hour"])["vehicle_count"].mean().round()
               .astype(int).unstack("hour"))
    typical_map = {
        road: {dtype: typical.loc[(road, dtype)].tolist() for dtype in ("weekday", "weekend", "holiday")
               if (road, dtype) in typical.index}
        for road in roads
    }
    return {
        "model_used": snap.bundle.model_type,
        "roads": roads,
        "weathers": list(WEATHERS),
        "congestion_levels": list(CONGESTION_LEVELS),
        "fields": ["vehicle_count", "average_speed", "congestion_index", "p_Low", "p_Medium", "p_High"],
        "layout": "values[road][day_index 0=Mon][is_holiday 0|1][weather][hour 0-23]",
        "residual_ratio": list(snap.bundle.residual_ratio),
        "free_flow": snap.free_flow,
        "weather_mix_by_month": {str(m): service._weather_mix(m) for m in range(1, 13)},
        "typical": typical_map,
        "values": values,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    # Use a throwaway data/model dir so exporting never touches the dev database.
    tmp = Path(tempfile.mkdtemp(prefix="trafficsense-export-"))
    os.environ.setdefault("TRAFFICSENSE_DATA_DIR", str(tmp / "data"))
    os.environ.setdefault("TRAFFICSENSE_MODEL_DIR", str(tmp / "models"))
    sys.path.insert(0, str(BACKEND_DIR))

    from app.main import WEATHERS, service  # noqa: E402  (env must be set first)

    service.startup()
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.json"):
        old.unlink()
    files: list[str] = []
    roads = list(service.snapshot.roads)

    info = service.dataset_info()
    write(out, "meta.json", {**info, "weathers": WEATHERS, "congestion_levels": ["Low", "Medium", "High"],
                             "today": dt.date.today().isoformat()}, files)
    write(out, "summary.json", service.summary(), files)
    for road in [None, *roads]:
        suffix = f"-{slug(road)}" if road else ""
        write(out, f"trends-daily{suffix}.json", service.trends("daily", road), files)
        write(out, f"trends-weekly{suffix}.json", service.trends("weekly", road), files)
        for metric in ("vehicle_count", "average_speed", "high_congestion"):
            write(out, f"heatmap-{metric}{suffix}.json", service.heatmap(road, metric, False), files)
        write(out, f"insights{suffix}.json", service.insights(road), files)
    write(out, "model-metrics.json", service.model_metrics(), files)
    write(out, "predictions.json", build_prediction_table(service), files)
    write(out, "manifest.json", {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "dataset": {k: info[k] for k in ("start_date", "end_date", "rows", "model_type")},
        "road_slugs": {road: slug(road) for road in roads},
        "files": sorted(files),
    }, files)

    total = sum((out / f).stat().st_size for f in files)
    print(f"Exported {len(files)} files ({total / 1024:.0f} KB) to {out}")


if __name__ == "__main__":
    main()
