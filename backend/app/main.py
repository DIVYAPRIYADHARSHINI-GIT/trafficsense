"""TrafficSense FastAPI application.

Run locally:  uvicorn app.main:app --reload --port 8000           (from backend/)
On Render:    uvicorn app.main:app --host 0.0.0.0 --port $PORT    (see render.yaml)
Docs:         http://localhost:8000/docs
"""

from __future__ import annotations

import datetime as dt
import logging
from contextlib import asynccontextmanager
from typing import Literal, Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, config
from .data_generator import generate_traffic_data
from .dataset import WEATHERS, DatasetError, clean_traffic_frame, read_csv_bytes
from .model import SKLEARN_AVAILABLE, data_fingerprint  # noqa: F401  (re-exported for tests)
from .schemas import PredictRequest, WeatherOrAuto
from .service import TrafficService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("trafficsense")

service = TrafficService()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Load (or generate) the 6-month dataset into SQLite and train/load the model.
    service.startup()
    info = service.dataset_info()
    log.info("TrafficSense ready: %s rows, %s -> %s, model=%s", info["rows"], info["start_date"],
             info["end_date"], info["model_type"])
    yield


app = FastAPI(
    title="TrafficSense API",
    description="Predict the jam before you're in it. Traffic analytics and Random Forest predictions.",
    version=__version__,
    lifespan=lifespan,
)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_origin_regex=config.CORS_ORIGIN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=86400,
)


@app.exception_handler(KeyError)
async def _unknown_road(_, exc: KeyError):
    return JSONResponse(status_code=404, content={"detail": str(exc.args[0]) if exc.args else "Not found"})


@app.exception_handler(ValueError)
async def _bad_value(_, exc: ValueError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


def _road(road: Optional[str]) -> Optional[str]:
    return None if road in (None, "", "all") else service.require_road(road)


# --------------------------------------------------------------------- meta
@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok" if service.ready else "starting", "version": __version__,
            "sklearn_available": SKLEARN_AVAILABLE, "on_render": config.ON_RENDER}


@app.get("/api/meta", tags=["meta"], summary="Roads, weather options and dataset coverage for forms")
def meta():
    info = service.dataset_info()
    return {**info, "weathers": WEATHERS, "congestion_levels": ["Low", "Medium", "High"],
            "today": dt.date.today().isoformat()}


# ---------------------------------------------------------------- analytics
@app.get("/api/summary", tags=["analytics"], summary="Dashboard stats")
def summary():
    return service.summary()


@app.get("/api/trends", tags=["analytics"], summary="Daily or weekly traffic trend")
def trends(granularity: Literal["daily", "weekly"] = "daily", road: Optional[str] = None):
    return service.trends(granularity, _road(road))


@app.get("/api/heatmap", tags=["analytics"], summary="Hour-of-day x day-of-week traffic grid")
def heatmap(
    road: Optional[str] = None,
    metric: Literal["vehicle_count", "average_speed", "high_congestion"] = "vehicle_count",
    include_holidays: bool = False,
):
    return service.heatmap(_road(road), metric, include_holidays)


@app.get("/api/insights", tags=["analytics"], summary="Weekday vs weekend, weather effect, road comparison")
def insights(road: Optional[str] = None):
    return service.insights(_road(road))


# --------------------------------------------------------------- prediction
@app.post("/api/predict", tags=["prediction"], summary="Predict traffic for a road, date, hour and weather")
def predict(req: PredictRequest):
    return service.predict(req.road, req.date, req.hour, req.weather, req.is_holiday)


@app.get("/api/best-time", tags=["prediction"], summary="Lowest-traffic hours for a road and date")
def best_time(
    road: str,
    date: dt.date,
    weather: WeatherOrAuto = "auto",
    start_hour: int = Query(0, ge=0, le=23),
    end_hour: int = Query(23, ge=0, le=23),
    top: int = Query(5, ge=1, le=24),
    is_holiday: Optional[bool] = None,
):
    return service.best_time(road, date, weather, start_hour, end_hour, top, is_holiday)


@app.get("/api/model-metrics", tags=["prediction"], summary="MAE, RMSE, R2 and actual vs predicted values")
def model_metrics():
    return service.model_metrics()


# ------------------------------------------------------------------- data
@app.post("/api/upload", tags=["data"], summary="Upload a traffic CSV and retrain the model")
async def upload(file: UploadFile = File(...), mode: Literal["replace", "append"] = Form("replace")):
    if file.filename and not file.filename.lower().endswith((".csv", ".txt")):
        raise HTTPException(400, "Please upload a .csv file.")
    content = await file.read(int(config.MAX_UPLOAD_MB * 1024 * 1024) + 1)
    if len(content) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"File too large (limit {config.MAX_UPLOAD_MB:g} MB).")
    try:
        frame, report = clean_traffic_frame(read_csv_bytes(content))
    except DatasetError as exc:
        raise HTTPException(400, str(exc)) from exc

    from starlette.concurrency import run_in_threadpool  # retraining is CPU-bound
    info = await run_in_threadpool(service.ingest, frame, "upload", file.filename, mode)
    metrics = service.model_metrics()
    return {
        "message": f"Loaded {report['rows_loaded']:,} rows and retrained the {info['model_type'].replace('_', ' ')} model.",
        "mode": mode,
        "report": report,
        "dataset": info,
        "metrics": {"model": metrics["model"], "training_seconds": metrics["training_seconds"]},
    }


@app.post("/api/reset", tags=["data"], summary="Restore the bundled 6-month sample dataset")
def reset():
    return {"message": "Sample dataset restored and model retrained.", "dataset": service.reset_to_sample()}


@app.get("/api/sample-csv", tags=["data"], summary="Download a CSV template in the expected format",
         response_class=PlainTextResponse)
def sample_csv(rows: int = Query(48, ge=1, le=2000)):
    end = dt.date.today() - dt.timedelta(days=1)
    df = generate_traffic_data(start=end - dt.timedelta(days=1), end=end, seed=7).head(rows)
    return PlainTextResponse(
        df.to_csv(index=False), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="trafficsense_template.csv"'},
    )


@app.get("/api/dataset.csv", tags=["data"], summary="Download the active dataset", response_class=PlainTextResponse)
def dataset_csv():
    return PlainTextResponse(
        service.snapshot.raw.to_csv(index=False), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="trafficsense_dataset.csv"'},
    )


# ------------------------------------------------- optional built frontend
if config.SERVE_FRONTEND and (config.FRONTEND_DIST / "index.html").exists():
    assets = config.FRONTEND_DIST / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(404, "Not found")
        candidate = (config.FRONTEND_DIST / full_path).resolve()
        if full_path and candidate.is_file() and config.FRONTEND_DIST.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(config.FRONTEND_DIST / "index.html")
else:
    @app.get("/", include_in_schema=False)
    def root():
        # API-only deployment (Render): the UI is served from GitHub Pages.
        return {"name": "TrafficSense API", "tagline": "Predict the jam before you're in it.",
                "docs": "/docs", "health": "/api/health"}
