"""Prediction models.

Primary:  scikit-learn Random Forests trained on hour, day of week, weekend flag,
          holiday flag, road and weather.
            * RandomForestRegressor  -> vehicle_count
            * RandomForestRegressor  -> average_speed
            * RandomForestClassifier -> congestion_level (with class probabilities)
Fallback: StatisticalModel - historical averages for the same road / day / hour /
          weather, backing off to coarser groups (and multiplicative weather /
          day-type ratios) when a combination has too few samples. It is used when
          scikit-learn is unavailable, when training fails, or when forced with
          TRAFFICSENSE_FORCE_STATISTICAL=1. It is also always evaluated as the
          baseline so the UI can show how much the Random Forest adds.

Evaluation is a chronological hold-out (first 80% of days -> train, last 20% ->
test), which mimics forecasting unseen future days. The served models are then
refit on the full dataset.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .dataset import CONGESTION_LEVELS, WEATHERS, add_derived_columns

log = logging.getLogger("trafficsense.model")

try:  # The ML stack is optional at runtime: without it we fall back to statistics.
    import sklearn
    from sklearn.compose import ColumnTransformer
    from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder

    SKLEARN_AVAILABLE = True
    SKLEARN_VERSION = sklearn.__version__
except Exception:  # pragma: no cover - exercised only without scikit-learn
    SKLEARN_AVAILABLE = False
    SKLEARN_VERSION = None

try:
    import joblib
except Exception:  # pragma: no cover
    joblib = None

CATEGORICAL_FEATURES = ["road_name", "weather"]
NUMERIC_FEATURES = ["hour", "day_index", "is_weekend", "is_holiday"]
FEATURES = CATEGORICAL_FEATURES + NUMERIC_FEATURES
FEATURE_LABELS = {
    "hour": "Hour of day", "day_index": "Day of week", "is_weekend": "Weekend",
    "is_holiday": "Holiday", "road_name": "Road", "weather": "Weather",
}
BUNDLE_FORMAT = 1
TEST_FRACTION = 0.2

# Random Forest size. Tuned for Render's free tier (512 MB RAM, 0.1 CPU): the old
# 120-tree / unlimited-leaf forests were ~129 MB pickled and peaked near 570 MB RSS.
# 40 trees capped at 2000 leaves keep test R2 at 0.976 (vs 0.976) and MAE 98.7 (vs
# 98.3) while shrinking the three models ~4x. Override with env vars if you have more RAM.
RF_TREES = int(os.getenv("TRAFFICSENSE_RF_TREES", "40"))
RF_MAX_LEAF_NODES = int(os.getenv("TRAFFICSENSE_RF_MAX_LEAF_NODES", "2000")) or None
RF_MIN_SAMPLES_LEAF = int(os.getenv("TRAFFICSENSE_RF_MIN_SAMPLES_LEAF", "2"))
# Parallel jobs for fitting. Render's free tier exposes a fraction of one CPU, where
# extra worker processes only add memory; default to 1 there (RENDER is set by Render).
RF_N_JOBS = int(os.getenv("TRAFFICSENSE_RF_N_JOBS", "1" if os.getenv("RENDER") else "-1"))


# --------------------------------------------------------------------------- metrics
def regression_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    err = predicted - actual
    ss_res = float(np.sum(err ** 2))
    ss_tot = float(np.sum((actual - actual.mean()) ** 2))
    abs_total = float(np.sum(np.abs(actual)))
    wape = float(np.sum(np.abs(err)) / abs_total) if abs_total else 0.0
    return {
        "mae": round(float(np.mean(np.abs(err))), 3),
        "rmse": round(float(np.sqrt(np.mean(err ** 2))), 3),
        "r2": round(1.0 - ss_res / ss_tot, 4) if ss_tot else 0.0,
        "wape": round(wape, 4),
        "accuracy": round(max(0.0, 1.0 - wape), 4),  # 1 - WAPE, a friendly headline number
    }


def data_fingerprint(df: pd.DataFrame) -> str:
    hashed = pd.util.hash_pandas_object(df.reset_index(drop=True), index=False).to_numpy()
    return hashlib.sha256(hashed.tobytes()).hexdigest()[:16]


# --------------------------------------------------------------- statistical model
class StatisticalModel:
    """Historical-average predictor with hierarchical back-off."""

    MIN_SAMPLES = 3

    def fit(self, data: pd.DataFrame) -> "StatisticalModel":
        data = data.copy()
        self.global_count = float(data["vehicle_count"].mean())
        self.global_speed = float(data["average_speed"].mean())

        base_keys = ["road_name", "day_type", "hour"]
        base = data.groupby(base_keys)
        rel_count = data["vehicle_count"] / base["vehicle_count"].transform("mean").replace(0, np.nan)
        rel_speed = data["average_speed"] / base["average_speed"].transform("mean").replace(0, np.nan)
        self.weather_count_ratio = rel_count.groupby(data["weather"]).mean().fillna(1.0).to_dict()
        self.weather_speed_ratio = rel_speed.groupby(data["weather"]).mean().fillna(1.0).to_dict()

        road_hour = data.groupby(["road_name", "hour"])
        rel2_count = data["vehicle_count"] / road_hour["vehicle_count"].transform("mean").replace(0, np.nan)
        rel2_speed = data["average_speed"] / road_hour["average_speed"].transform("mean").replace(0, np.nan)
        self.day_type_count_ratio = rel2_count.groupby(data["day_type"]).mean().fillna(1.0).to_dict()
        self.day_type_speed_ratio = rel2_speed.groupby(data["day_type"]).mean().fillna(1.0).to_dict()

        non_holiday = data[data["is_holiday"] == 0]
        self.levels = [
            ("road+weekday+hour+weather", ["road_name", "day_index", "hour", "weather"], self._table(non_holiday, ["road_name", "day_index", "hour", "weather"])),
            ("road+daytype+hour+weather", ["road_name", "day_type", "hour", "weather"], self._table(data, ["road_name", "day_type", "hour", "weather"])),
            ("road+daytype+hour", ["road_name", "day_type", "hour"], self._table(data, base_keys)),
            ("road+hour", ["road_name", "hour"], self._table(data, ["road_name", "hour"])),
            ("road", ["road_name"], self._table(data, ["road_name"])),
        ]
        return self

    @staticmethod
    def _table(data: pd.DataFrame, keys: list[str]) -> dict[tuple, tuple]:
        if data.empty:
            return {}
        grouped = data.groupby(keys)
        stats = pd.DataFrame({
            "count": grouped["vehicle_count"].mean(),
            "speed": grouped["average_speed"].mean(),
            "n": grouped.size(),
        })
        probs = pd.crosstab(
            [data[k] for k in keys], data["congestion_level"], normalize="index"
        ).reindex(columns=CONGESTION_LEVELS, fill_value=0.0)
        stats = stats.join(probs, how="left").fillna(0.0)
        table = {}
        for key, row in stats.iterrows():
            key = key if isinstance(key, tuple) else (key,)
            table[key] = (row["count"], row["speed"], int(row["n"]), tuple(row[c] for c in CONGESTION_LEVELS))
        return table

    def predict(self, features: pd.DataFrame) -> pd.DataFrame:
        records = []
        for row in features.itertuples(index=False):
            values = row._asdict()
            day_type = "holiday" if values["is_holiday"] else ("weekend" if values["is_weekend"] else "weekday")
            values["day_type"] = day_type
            result = None
            for level, (name, keys, table) in enumerate(self.levels):
                if level == 0 and values["is_holiday"]:
                    continue
                hit = table.get(tuple(values[k] for k in keys))
                if hit is None or (hit[2] < self.MIN_SAMPLES and name != "road"):
                    continue
                count, speed, _, probs = hit
                if "weather" not in keys:
                    count *= self.weather_count_ratio.get(values["weather"], 1.0)
                    speed *= self.weather_speed_ratio.get(values["weather"], 1.0)
                if "day_type" not in keys and "day_index" not in keys:
                    count *= self.day_type_count_ratio.get(day_type, 1.0)
                    speed *= self.day_type_speed_ratio.get(day_type, 1.0)
                result = (count, speed, probs, name)
                break
            if result is None:  # unseen road
                result = (self.global_count, self.global_speed, (1 / 3, 1 / 3, 1 / 3), "global")
            count, speed, probs, name = result
            records.append({
                "vehicle_count": count, "average_speed": speed,
                **{f"p_{c}": p for c, p in zip(CONGESTION_LEVELS, probs)},
                "source": name,
            })
        out = pd.DataFrame.from_records(records, index=features.index)
        out["congestion_level"] = out[[f"p_{c}" for c in CONGESTION_LEVELS]].to_numpy().argmax(axis=1)
        out["congestion_level"] = out["congestion_level"].map(dict(enumerate(CONGESTION_LEVELS)))
        return out


# ------------------------------------------------------------- random forest model
class RandomForestTrafficModel:
    def __init__(self, n_estimators: int = RF_TREES, seed: int = 42):
        self.n_estimators = n_estimators
        self.seed = seed

    def _pipeline(self, estimator) -> "Pipeline":
        prep = ColumnTransformer(
            [("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL_FEATURES)],
            remainder="passthrough",
            verbose_feature_names_out=False,
        )
        return Pipeline([("prep", prep), ("rf", estimator)])

    def fit(self, data: pd.DataFrame) -> "RandomForestTrafficModel":
        X = data[FEATURES]
        common = dict(
            n_estimators=self.n_estimators, min_samples_leaf=RF_MIN_SAMPLES_LEAF,
            max_leaf_nodes=RF_MAX_LEAF_NODES, n_jobs=RF_N_JOBS, random_state=self.seed,
        )
        self.count_model = self._pipeline(RandomForestRegressor(**common)).fit(X, data["vehicle_count"])
        self.speed_model = self._pipeline(RandomForestRegressor(**common)).fit(X, data["average_speed"])
        self.congestion_model = self._pipeline(RandomForestClassifier(**common)).fit(X, data["congestion_level"])
        return self

    def predict(self, features: pd.DataFrame) -> pd.DataFrame:
        X = features[FEATURES]
        out = pd.DataFrame(index=features.index)
        out["vehicle_count"] = self.count_model.predict(X)
        out["average_speed"] = self.speed_model.predict(X)
        proba = self.congestion_model.predict_proba(X)
        classes = list(self.congestion_model.classes_)
        for level in CONGESTION_LEVELS:
            out[f"p_{level}"] = proba[:, classes.index(level)] if level in classes else 0.0
        out["congestion_level"] = out[[f"p_{c}" for c in CONGESTION_LEVELS]].to_numpy().argmax(axis=1)
        out["congestion_level"] = out["congestion_level"].map(dict(enumerate(CONGESTION_LEVELS)))
        out["source"] = "random_forest"
        return out

    def feature_importance(self) -> list[dict[str, Any]]:
        names = self.count_model.named_steps["prep"].get_feature_names_out()
        weights = self.count_model.named_steps["rf"].feature_importances_
        grouped: dict[str, float] = {}
        for name, weight in zip(names, weights):
            base = next((c for c in CATEGORICAL_FEATURES if name.startswith(c + "_")), name)
            grouped[base] = grouped.get(base, 0.0) + float(weight)
        return sorted(
            ({"feature": k, "label": FEATURE_LABELS.get(k, k), "importance": round(v, 4)} for k, v in grouped.items()),
            key=lambda item: item["importance"], reverse=True,
        )


# ----------------------------------------------------------------------- bundle
@dataclass
class ModelBundle:
    model_type: str                       # "random_forest" | "statistical"
    stat_model: StatisticalModel
    rf_model: RandomForestTrafficModel | None
    metrics: dict[str, Any]
    fingerprint: str
    trained_at: str
    fallback_reason: str | None = None
    residual_ratio: tuple[float, float] = (0.85, 1.15)  # 10th / 90th pct of actual/predicted on test
    sklearn_version: str | None = SKLEARN_VERSION
    format: int = BUNDLE_FORMAT
    extra: dict[str, Any] = field(default_factory=dict)

    def predict(self, features: pd.DataFrame) -> pd.DataFrame:
        if self.rf_model is not None:
            try:
                out = self.rf_model.predict(features)
            except Exception:  # pragma: no cover - defensive: never fail a request
                log.exception("Random Forest prediction failed; using statistical fallback")
                out = self.stat_model.predict(features)
        else:
            out = self.stat_model.predict(features)
        out["vehicle_count"] = out["vehicle_count"].clip(lower=0)
        out["average_speed"] = out["average_speed"].clip(lower=1.0)
        return out

    def save(self, path: Path) -> bool:
        if joblib is None:
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        joblib.dump(self, tmp, compress=1)  # light compression: fast on a 0.1-CPU host
        tmp.replace(path)
        return True

    @staticmethod
    def load(path: Path) -> "ModelBundle | None":
        if joblib is None or not path.exists():
            return None
        try:
            bundle = joblib.load(path)
        except Exception:
            log.warning("Could not load saved model at %s; retraining", path)
            return None
        if getattr(bundle, "format", None) != BUNDLE_FORMAT or bundle.sklearn_version != SKLEARN_VERSION:
            return None
        return bundle


# ---------------------------------------------------------------------- training
def time_split(data: pd.DataFrame, test_fraction: float = TEST_FRACTION, seed: int = 42):
    dates = np.sort(data["date"].unique())
    if len(dates) >= 10:
        cutoff = dates[int(len(dates) * (1 - test_fraction))]
        train, test = data[data["date"] < cutoff], data[data["date"] >= cutoff]
        split = {"method": "chronological", "train_start": str(dates[0]), "train_end": str(train["date"].max()),
                 "test_start": str(cutoff), "test_end": str(dates[-1])}
    else:
        test = data.sample(frac=test_fraction, random_state=seed)
        train = data.drop(test.index)
        split = {"method": "random", "train_start": str(dates[0]), "train_end": str(dates[-1]),
                 "test_start": str(dates[0]), "test_end": str(dates[-1])}
    split.update(train_rows=int(len(train)), test_rows=int(len(test)))
    return train, test, split


def _evaluate(pred: pd.DataFrame, test: pd.DataFrame) -> dict[str, Any]:
    return {
        "vehicle_count": regression_metrics(test["vehicle_count"], pred["vehicle_count"]),
        "average_speed": regression_metrics(test["average_speed"], pred["average_speed"]),
        "congestion_accuracy": round(float((pred["congestion_level"].to_numpy() == test["congestion_level"].to_numpy()).mean()), 4),
    }


def _actual_vs_predicted(test: pd.DataFrame, pred: pd.DataFrame, baseline: pd.DataFrame, seed: int) -> dict[str, Any]:
    frame = test[["timestamp", "date", "road_name", "vehicle_count"]].copy()
    frame["predicted"] = pred["vehicle_count"].round().astype(int)
    frame["baseline"] = baseline["vehicle_count"].round().astype(int)

    daily = frame.groupby("date")[["vehicle_count", "predicted", "baseline"]].sum().reset_index()
    daily_points = [
        {"date": r.date, "actual": int(r.vehicle_count), "predicted": int(r.predicted), "baseline": int(r.baseline)}
        for r in daily.itertuples(index=False)
    ]

    last_days = sorted(frame["date"].unique())[-7:]
    recent = frame[frame["date"].isin(last_days)].sort_values("timestamp")
    hourly = {
        road: [
            {"timestamp": r.timestamp.strftime("%Y-%m-%dT%H:00"), "actual": int(r.vehicle_count),
             "predicted": int(r.predicted), "baseline": int(r.baseline)}
            for r in group.itertuples(index=False)
        ]
        for road, group in recent.groupby("road_name")
    }

    sample = frame.sample(n=min(600, len(frame)), random_state=seed)
    scatter = [
        {"actual": int(r.vehicle_count), "predicted": int(r.predicted), "road": r.road_name}
        for r in sample.itertuples(index=False)
    ]
    return {"daily": daily_points, "hourly": hourly, "scatter": scatter}


def _residual_ratio(test: pd.DataFrame, pred: pd.DataFrame) -> tuple[float, float]:
    mask = pred["vehicle_count"] >= max(25.0, float(test["vehicle_count"].quantile(0.1)))
    if mask.sum() < 20:
        return (0.85, 1.15)
    ratio = test.loc[mask, "vehicle_count"] / pred.loc[mask, "vehicle_count"]
    return (round(float(ratio.quantile(0.10)), 4), round(float(ratio.quantile(0.90)), 4))


def train_models(df: pd.DataFrame, force_statistical: bool = False, seed: int = 42) -> ModelBundle:
    started = time.perf_counter()
    data = add_derived_columns(df)
    train, test, split = time_split(data, seed=seed)

    baseline_eval = StatisticalModel().fit(train)
    baseline_pred = baseline_eval.predict(test[FEATURES])
    baseline_metrics = _evaluate(baseline_pred, test)

    fallback_reason = None
    rf_model = None
    model_pred = baseline_pred
    metrics = baseline_metrics
    importance: list[dict[str, Any]] = []

    if force_statistical:
        fallback_reason = "Statistical mode forced via TRAFFICSENSE_FORCE_STATISTICAL."
    elif not SKLEARN_AVAILABLE:
        fallback_reason = "scikit-learn is not installed."
    else:
        try:
            rf_eval = RandomForestTrafficModel(seed=seed).fit(train)
            model_pred = rf_eval.predict(test[FEATURES])
            del rf_eval  # free the evaluation forests before fitting the served ones (peak RAM)
            metrics = _evaluate(model_pred, test)
            rf_model = RandomForestTrafficModel(seed=seed).fit(data)
            importance = rf_model.feature_importance()
        except Exception as exc:  # pragma: no cover - defensive
            log.exception("Random Forest training failed; falling back to statistics")
            fallback_reason = f"Random Forest training failed: {exc}"
            rf_model, model_pred, metrics = None, baseline_pred, baseline_metrics

    stat_model = StatisticalModel().fit(data)
    seconds = round(time.perf_counter() - started, 2)
    model_type = "random_forest" if rf_model is not None else "statistical"
    log.info("Trained %s model on %d rows in %.2fs (R2=%.3f)", model_type, len(data), seconds,
             metrics["vehicle_count"]["r2"])

    return ModelBundle(
        model_type=model_type,
        stat_model=stat_model,
        rf_model=rf_model,
        fallback_reason=fallback_reason,
        fingerprint=data_fingerprint(df),
        trained_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        residual_ratio=_residual_ratio(test, model_pred),
        metrics={
            "model": metrics,
            "baseline": baseline_metrics,
            "split": split,
            "training_seconds": seconds,
            "features": [FEATURE_LABELS[f] for f in FEATURES],
            "feature_importance": importance,
            "rf_params": {"n_estimators": RF_TREES, "min_samples_leaf": RF_MIN_SAMPLES_LEAF,
                          "max_leaf_nodes": RF_MAX_LEAF_NODES} if rf_model is not None else None,
            "actual_vs_predicted": _actual_vs_predicted(test, model_pred, baseline_pred, seed),
        },
    )
