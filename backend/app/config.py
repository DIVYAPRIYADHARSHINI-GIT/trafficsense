"""Runtime configuration. Every value can be overridden with an environment variable."""

from __future__ import annotations

import os
import re
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
# Allowed = localhost defaults + every origin listed in these env vars (comma-separated):
#   ALLOWED_ORIGINS                 e.g. https://trafficsense.vercel.app,https://traffic.example.com
#   GITHUB_PAGES_ORIGIN             e.g. https://octocat.github.io
#   TRAFFICSENSE_CORS_ORIGINS       explicit list that REPLACES the localhost defaults
# Wildcards: an entry with "*" in the host is turned into a pattern, e.g.
#   https://trafficsense-*.vercel.app   (the project's Vercel preview deployments)
#   TRAFFICSENSE_CORS_ORIGIN_REGEX  extra raw regex; default allows any *.github.io site plus
#                                   localhost / 127.0.0.1 on any port. Set to "" to disable.
LOCAL_ORIGINS = [
    "http://localhost:5173", "http://127.0.0.1:5173",   # vite dev
    "http://localhost:4173", "http://127.0.0.1:4173",   # vite preview
    "http://localhost:8000", "http://127.0.0.1:8000",   # backend-served build
]


def _split(value: str) -> list[str]:
    return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]


def _wildcard_to_regex(origin: str) -> str:
    # "https://trafficsense-*.vercel.app" -> ^https://trafficsense\-[A-Za-z0-9-]*\.vercel\.app$
    return "^" + re.escape(origin).replace(r"\*", "[A-Za-z0-9-]*") + "$"


_explicit = os.getenv("TRAFFICSENSE_CORS_ORIGINS")
_configured = (
    _split(os.getenv("ALLOWED_ORIGINS", ""))
    + _split(os.getenv("GITHUB_PAGES_ORIGIN", ""))
    + (_split(_explicit) if _explicit else [])
)
CORS_ORIGINS = list(dict.fromkeys(
    ([] if _explicit else LOCAL_ORIGINS) + [o for o in _configured if "*" not in o]
))
_patterns = [_wildcard_to_regex(o) for o in _configured if "*" in o]
_default_regex = os.getenv(
    "TRAFFICSENSE_CORS_ORIGIN_REGEX",
    r"^https://[A-Za-z0-9-]+\.github\.io$|^http://(localhost|127\.0\.0\.1)(:\d+)?$",
)
if _default_regex:
    _patterns.append(_default_regex)
CORS_ORIGIN_REGEX = "|".join(f"(?:{p})" for p in _patterns) or None

# True when running on Render (Render injects RENDER=true into every service).
ON_RENDER = _flag("RENDER")
