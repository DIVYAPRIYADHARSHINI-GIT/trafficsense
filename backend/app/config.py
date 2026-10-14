"""Runtime configuration. Every value can be overridden with an environment variable."""

from __future__ import annotations

import os
from pathlib import Path


def _flag(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


BASE_DIR = Path(__file__).resolve().parent.parent  # .../backend
DATA_DIR = Path(os.getenv("TRAFFICSENSE_DATA_DIR", BASE_DIR / "data"))
MODEL_DIR = Path(os.getenv("TRAFFICSENSE_MODEL_DIR", BASE_DIR / "models"))

DB_PATH = DATA_DIR / "trafficsense.db"          # SQLite store for the active dataset
SAMPLE_CSV = DATA_DIR / "traffic_data.csv"      # generated 6-month sample dataset
MODEL_PATH = MODEL_DIR / "traffic_model.joblib"  # trained model persisted with joblib

# Built React app (optional single-server mode). Off by default because the hosted UI
# lives on GitHub Pages. To serve it from FastAPI, build with `VITE_BASE=/ npm run build`
# and start the backend with TRAFFICSENSE_SERVE_FRONTEND=1.
SERVE_FRONTEND = _flag("TRAFFICSENSE_SERVE_FRONTEND")
FRONTEND_DIST = Path(os.getenv("TRAFFICSENSE_FRONTEND_DIST", BASE_DIR.parent / "frontend" / "dist"))

# Force the statistical (historical-average) predictor instead of the Random Forest.
FORCE_STATISTICAL = _flag("TRAFFICSENSE_FORCE_STATISTICAL")

# The spec trains the model on every startup (then saves it with joblib). Set this to 1
# to instead reuse models/traffic_model.joblib when it was trained on identical data.
REUSE_SAVED_MODEL = _flag("TRAFFICSENSE_REUSE_MODEL")

# Regenerate the bundled sample when it is older than this many days, so the
# dataset always covers "the last 6 months". Set to 0 to disable.
SAMPLE_MAX_AGE_DAYS = int(os.getenv("TRAFFICSENSE_SAMPLE_MAX_AGE_DAYS", "7"))

SAMPLE_MONTHS = int(os.getenv("TRAFFICSENSE_SAMPLE_MONTHS", "6"))
RANDOM_SEED = int(os.getenv("TRAFFICSENSE_SEED", "42"))
MAX_UPLOAD_MB = float(os.getenv("TRAFFICSENSE_MAX_UPLOAD_MB", "50"))

# --------------------------------------------------------------------------- CORS
# Browsers send the page origin (scheme + host, no path), so the GitHub Pages site
# https://<user>.github.io/trafficsense/ arrives as "https://<user>.github.io".
#   TRAFFICSENSE_CORS_ORIGINS       explicit comma-separated list (replaces the defaults)
#   GITHUB_PAGES_ORIGIN             e.g. https://octocat.github.io  (added to the defaults)
#   TRAFFICSENSE_CORS_ORIGIN_REGEX  regex fallback; default allows any *.github.io site
#                                   plus localhost / 127.0.0.1 on any port. Set it to an
#                                   empty string to allow only the explicit list.
LOCAL_ORIGINS = [
    "http://localhost:5173", "http://127.0.0.1:5173",   # vite dev
    "http://localhost:4173", "http://127.0.0.1:4173",   # vite preview
    "http://localhost:8000", "http://127.0.0.1:8000",   # backend-served build
]


def _split(value: str) -> list[str]:
    return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]


_explicit = os.getenv("TRAFFICSENSE_CORS_ORIGINS")
CORS_ORIGINS = _split(_explicit) if _explicit else LOCAL_ORIGINS + _split(os.getenv("GITHUB_PAGES_ORIGIN", ""))
CORS_ORIGIN_REGEX = os.getenv(
    "TRAFFICSENSE_CORS_ORIGIN_REGEX",
    r"^https://[A-Za-z0-9-]+\.github\.io$|^http://(localhost|127\.0\.0\.1)(:\d+)?$",
) or None

# True when running on Render (Render injects RENDER=true into every service).
ON_RENDER = _flag("RENDER")
