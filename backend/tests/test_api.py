"""End-to-end API tests. Run from backend/:  pytest -q"""

from __future__ import annotations

import datetime as dt
import io
import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp(prefix="trafficsense-test-")
os.environ["TRAFFICSENSE_DATA_DIR"] = os.path.join(_tmp, "data")
os.environ["TRAFFICSENSE_MODEL_DIR"] = os.path.join(_tmp, "models")

from fastapi.testclient import TestClient  # noqa: E402

from app.data_generator import generate_traffic_data  # noqa: E402
from app.main import app  # noqa: E402

NEXT_TUESDAY = dt.date.today() + dt.timedelta(days=(1 - dt.date.today().weekday()) % 7 or 7)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_dataset_covers_six_months_hourly(client):
    meta = client.get("/api/meta").json()
    assert len(meta["roads"]) == 6
    assert 180 <= meta["days"] <= 185
    assert meta["rows"] == meta["days"] * 24 * len(meta["roads"])
    assert meta["model_type"] == "random_forest"


def test_summary_cards(client):
    body = client.get("/api/summary").json()
    assert body["avg_daily_traffic"] > 0
    assert body["busiest_road"]["name"] == "Highway 101"
    assert body["peak_hour"]["hour"] in {8, 9, 17, 18, 19}
    assert body["busiest_day"]["day"] not in {"Saturday", "Sunday"}


def test_trends_daily_and_weekly(client):
    daily = client.get("/api/trends").json()
    weekly = client.get("/api/trends", params={"granularity": "weekly"}).json()
    assert len(daily["points"]) >= 180
    assert 25 <= len(weekly["points"]) <= 28
    assert client.get("/api/trends", params={"granularity": "hourly"}).status_code == 422


def test_heatmap_shape_and_patterns(client):
    body = client.get("/api/heatmap").json()
    assert len(body["cells"]) == 7 * 24
    grid = {(c["day_index"], c["hour"]): c["value"] for c in body["cells"]}
    assert grid[(1, 8)] > grid[(1, 3)] * 5          # weekday morning peak vs night
    assert grid[(1, 18)] > grid[(6, 18)]            # weekday evening busier than Sunday
    assert grid[(1, 8)] > grid[(1, 12)]             # 8 AM peak above midday lull


def test_insights_weather_and_daytype(client):
    body = client.get("/api/insights").json()
    types = body["day_types"]
    assert types["weekend"]["avg_daily_vehicles"] < types["weekday"]["avg_daily_vehicles"]
    assert types["holiday"]["avg_daily_vehicles"] > types["weekday"]["avg_daily_vehicles"]
    rain = next(w for w in body["weather"] if w["weather"] == "rainy")
    assert rain["volume_vs_sunny_pct"] > 5 and rain["speed_vs_sunny_pct"] < -5


def test_predict_peak_vs_night_and_rain(client):
    def predict(time, weather):
        response = client.post("/api/predict", json={
            "road": "Highway 101", "date": NEXT_TUESDAY.isoformat(), "time": time, "weather": weather})
        assert response.status_code == 200, response.text
        return response.json()

    peak_rain, peak_sun, night = predict("08:00", "rainy"), predict("08:00", "sunny"), predict("3:00 AM", "sunny")
    assert peak_rain["vehicle_count"] > peak_sun["vehicle_count"] > night["vehicle_count"] * 5
    assert peak_rain["average_speed"] < night["average_speed"]
    assert night["congestion_level"] == "Low"
    assert peak_rain["congestion_level"] in {"Medium", "High"}
    assert set(peak_rain["congestion_probabilities"]) == {"Low", "Medium", "High"}


def test_predict_validation(client):
    base = {"road": "Highway 101", "date": NEXT_TUESDAY.isoformat(), "time": "08:00", "weather": "sunny"}
    assert client.post("/api/predict", json={**base, "road": "Nowhere"}).status_code == 404
    assert client.post("/api/predict", json={**base, "time": "26:00"}).status_code == 422
    assert client.post("/api/predict", json={**base, "weather": "snowy"}).status_code == 422
    assert client.post("/api/predict", json={**base, "weather": "auto"}).status_code == 200


def test_best_time(client):
    body = client.get("/api/best-time", params={
        "road": "Central Avenue", "date": NEXT_TUESDAY.isoformat(), "start_hour": 7, "end_hour": 20}).json()
    assert len(body["hourly"]) == 24
    counts = [h["vehicle_count"] for h in body["best_hours"]]
    assert counts == sorted(counts)
    assert all(7 <= h["hour"] <= 20 for h in body["best_hours"])
    assert body["best_hours"][0]["hour"] not in {8, 9, 17, 18}


def test_model_metrics(client):
    body = client.get("/api/model-metrics").json()
    assert body["model"]["vehicle_count"]["r2"] > 0.9
    assert body["model"]["vehicle_count"]["mae"] > 0
    assert body["split"]["method"] == "chronological"
    assert len(body["actual_vs_predicted"]["daily"]) > 20


def test_upload_rejects_bad_files(client):
    files = {"file": ("bad.csv", io.BytesIO(b"foo,bar\n1,2\n"), "text/csv")}
    response = client.post("/api/upload", files=files)
    assert response.status_code == 400 and "Missing required column" in response.json()["detail"]
    assert client.post("/api/upload", files={"file": ("x.csv", io.BytesIO(b""), "text/csv")}).status_code == 400


def test_upload_retrains_then_reset(client):
    end = dt.date.today() - dt.timedelta(days=1)
    df = generate_traffic_data(start=end - dt.timedelta(days=41), end=end, seed=3)
    df = df[df["road_name"].isin(["Main Street", "Airport Road"])].astype({"vehicle_count": object})
    df.loc[df.index[:5], "vehicle_count"] = "oops"  # five invalid rows should be rejected, not fatal
    payload = df.to_csv(index=False).encode()
    response = client.post("/api/upload", files={"file": ("mine.csv", io.BytesIO(payload), "text/csv")})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["report"]["rows_rejected"] == 5
    assert body["dataset"]["roads"] == ["Airport Road", "Main Street"]
    assert client.get("/api/meta").json()["source"] == "upload"

    reset = client.post("/api/reset").json()
    assert reset["dataset"]["source"] == "sample" and len(reset["dataset"]["roads"]) == 6
