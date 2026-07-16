"""
Тесты RequestIDMiddleware (app/core/request_id.py) — сквозной
идентификатор запроса, симметричный requestID в nexd (см.
internal/platform/httpapi/requestid.go).
"""

from __future__ import annotations

from starlette.testclient import TestClient

from app.config import Settings
from app.core.request_id import REQUEST_ID_HEADER
from app.main import create_app


def _client(monkeypatch) -> TestClient:
    settings = Settings(gigachat_mock=True)
    monkeypatch.setattr("app.main.get_settings", lambda: settings)
    return TestClient(create_app())


def test_incoming_request_id_is_echoed_back(monkeypatch) -> None:
    client = _client(monkeypatch)
    resp = client.get("/healthz", headers={REQUEST_ID_HEADER: "req-from-nexd"})
    assert resp.status_code == 200
    assert resp.headers[REQUEST_ID_HEADER] == "req-from-nexd"


def test_missing_request_id_is_generated(monkeypatch) -> None:
    client = _client(monkeypatch)
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.headers[REQUEST_ID_HEADER] != ""


def test_oversized_request_id_is_replaced(monkeypatch) -> None:
    client = _client(monkeypatch)
    resp = client.get("/healthz", headers={REQUEST_ID_HEADER: "x" * 100})
    assert resp.status_code == 200
    assert resp.headers[REQUEST_ID_HEADER] != "x" * 100
