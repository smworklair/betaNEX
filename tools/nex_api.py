"""Мини-клиент HTTP API NEX для dev-скриптов (только стандартная библиотека).

Авторизация — dev-заголовки X-Dev-* (работают только при NEX_ENV=development,
см. internal/platform/httpapi/devauth.go). Ошибки API (problem+json)
поднимаются как ApiError с кодом и текстом проблемы.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ApiError(Exception):
    """Ошибка уровня API: HTTP-статус и тело problem+json (если было)."""

    status: int
    title: str = ""
    detail: str = ""

    def __str__(self) -> str:
        parts = [f"HTTP {self.status}"]
        if self.title:
            parts.append(self.title)
        if self.detail:
            parts.append(self.detail)
        return ": ".join(parts)


@dataclass
class NexAPI:
    """Клиент одного tenant'а с dev-авторизацией."""

    base_url: str = "http://localhost:8080"
    tenant: str = "college-1"
    actor: str = "dev-admin"
    roles: str = "admin"
    timeout: float = 10.0
    _opener: urllib.request.OpenerDirector = field(
        # ProxyHandler({}) — намеренно мимо системного прокси: клиент ходит
        # только на локальный dev-сервер.
        default_factory=lambda: urllib.request.build_opener(urllib.request.ProxyHandler({})),
        repr=False,
    )

    def request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
    ) -> Any:
        """Выполняет запрос и возвращает разобранный JSON (или None для 204)."""
        url = self.base_url.rstrip("/") + path
        if params:
            url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v})
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("X-Dev-Actor", self.actor)
        req.add_header("X-Dev-Roles", self.roles)
        req.add_header("X-Dev-Tenant", self.tenant)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with self._opener.open(req, timeout=self.timeout) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raise _to_api_error(e) from None

    def get(self, path: str, **params: str) -> Any:
        return self.request("GET", path, params=params)

    def post(self, path: str, body: dict[str, Any] | None = None) -> Any:
        return self.request("POST", path, body=body)

    def patch(self, path: str, body: dict[str, Any]) -> Any:
        return self.request("PATCH", path, body=body)

    def delete(self, path: str) -> Any:
        return self.request("DELETE", path)

    def healthz(self) -> bool:
        """True, если сервис жив (GET /healthz отвечает status=ok)."""
        try:
            return self.get("/healthz").get("status") == "ok"
        except (ApiError, OSError):
            return False


def _to_api_error(e: urllib.error.HTTPError) -> ApiError:
    """Разбирает тело problem+json из HTTP-ошибки, не падая на мусоре."""
    title = detail = ""
    try:
        problem = json.loads(e.read())
        title = problem.get("title", "")
        detail = problem.get("detail", "")
    except (ValueError, OSError):
        pass
    return ApiError(status=e.code, title=title, detail=detail)
