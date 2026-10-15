"""CORS configuration tests (ALLOWED_ORIGINS / GITHUB_PAGES_ORIGIN / wildcard handling).

Each case reloads app.config in a subprocess-free way by setting env vars and
re-importing, then checks the actual preflight response from CORSMiddleware.
"""

from __future__ import annotations

import importlib
import sys

import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient


def _client(monkeypatch, **env) -> TestClient:
    for key in ("ALLOWED_ORIGINS", "GITHUB_PAGES_ORIGIN", "TRAFFICSENSE_CORS_ORIGINS", "TRAFFICSENSE_CORS_ORIGIN_REGEX"):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    config = importlib.reload(sys.modules.get("app.config") or importlib.import_module("app.config"))
    app = FastAPI()
    app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS,
                       allow_origin_regex=config.CORS_ORIGIN_REGEX, allow_methods=["*"], allow_headers=["*"])

    @app.get("/ping")
    def ping():
        return {"ok": True}

    return TestClient(app)


def _allowed(client: TestClient, origin: str) -> bool:
    response = client.options("/ping", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
    return response.headers.get("access-control-allow-origin") == origin


@pytest.fixture(autouse=True)
def _restore_config():
    yield
    importlib.reload(importlib.import_module("app.config"))


def test_vercel_domain_via_allowed_origins(monkeypatch):
    client = _client(monkeypatch, ALLOWED_ORIGINS="https://trafficsense.vercel.app/, https://traffic.example.com")
    assert _allowed(client, "https://trafficsense.vercel.app")      # trailing slash in env is tolerated
    assert _allowed(client, "https://traffic.example.com")
    assert not _allowed(client, "https://evil.vercel.app")
    assert not _allowed(client, "https://evil.example.com")


def test_wildcard_preview_deployments(monkeypatch):
    client = _client(monkeypatch, ALLOWED_ORIGINS="https://trafficsense-*.vercel.app")
    assert _allowed(client, "https://trafficsense-git-main-divya.vercel.app")
    assert not _allowed(client, "https://trafficsense.vercel.app.evil.com")
    assert not _allowed(client, "https://other-git-main.vercel.app")


def test_defaults_keep_github_pages_and_localhost(monkeypatch):
    client = _client(monkeypatch, ALLOWED_ORIGINS="https://trafficsense.vercel.app")
    assert _allowed(client, "https://divyapriyadharshini-git.github.io")
    assert _allowed(client, "http://localhost:5173")
    assert _allowed(client, "http://127.0.0.1:4173")


def test_regex_can_be_disabled(monkeypatch):
    client = _client(monkeypatch, ALLOWED_ORIGINS="https://trafficsense.vercel.app", TRAFFICSENSE_CORS_ORIGIN_REGEX="")
    assert _allowed(client, "https://trafficsense.vercel.app")
    assert _allowed(client, "http://localhost:5173")                 # explicit localhost list still applies
    assert not _allowed(client, "https://someone.github.io")
