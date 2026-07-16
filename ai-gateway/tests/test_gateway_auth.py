"""
Тесты verify_gateway_secret (app/deps.py) — проверка серверного секрета
nexd↔ai-gateway, который заменяет голое доверие заголовку X-Tenant-Id
(см. deps.py:get_tenant_id, docstring там же).

Request собирается вручную из ASGI scope — вызывать полноценный
TestClient/create_app() тут незачем, verify_gateway_secret — чистая
зависимость, читающая только заголовки и настройки.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException, Request

from app import config as config_module
from app import deps as deps_module
from app.deps import GATEWAY_SECRET_HEADER, verify_gateway_secret


def _request(headers: dict[str, str]) -> Request:
    raw_headers = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    scope = {"type": "http", "headers": raw_headers, "method": "POST", "path": "/api/v1/ai/ask"}
    return Request(scope)


def _settings_with_secret(secret: str) -> config_module.Settings:
    # model_construct: задаёт поле по имени напрямую, минуя валидацию и
    # validation_alias — иначе пришлось бы собирать Settings через
    # переменные окружения (gateway_shared_secret объявлен с
    # validation_alias="NEX_AI_GATEWAY_SECRET", см. app/config.py).
    return config_module.Settings.model_construct(gateway_shared_secret=secret)


def test_no_secret_configured_allows_any_request(monkeypatch: pytest.MonkeyPatch) -> None:
    """Локальная разработка без nexd рядом: секрет не задан — как раньше, ничего не ломается."""
    monkeypatch.setattr(deps_module, "get_settings", lambda: _settings_with_secret(""))
    asyncio.run(verify_gateway_secret(_request({})))


def test_missing_header_rejected_when_secret_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(deps_module, "get_settings", lambda: _settings_with_secret("s3cr3t"))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(verify_gateway_secret(_request({})))
    assert exc.value.status_code == 401


def test_wrong_secret_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(deps_module, "get_settings", lambda: _settings_with_secret("s3cr3t"))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(verify_gateway_secret(_request({GATEWAY_SECRET_HEADER: "wrong"})))
    assert exc.value.status_code == 401


def test_correct_secret_allows_request(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(deps_module, "get_settings", lambda: _settings_with_secret("s3cr3t"))
    asyncio.run(verify_gateway_secret(_request({GATEWAY_SECRET_HEADER: "s3cr3t"})))
