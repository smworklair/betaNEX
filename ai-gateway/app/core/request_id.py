"""
Сквозной request-id — тот же приём, что и в nexd
(internal/platform/httpapi/requestid.go).

nexd — единственный клиент ai-gateway в проде (браузер сюда напрямую не
ходит, см. deps.py:get_tenant_id) и уже присылает заголовок
X-Request-Id с тем же идентификатором, который использует в
собственных логах (см. internal/platform/httpapi/aiproxy.go). Этот
middleware принимает его как есть (или генерирует новый — прямой curl
к сервису, локальная разработка без nexd рядом), кладёт в contextvar
(откуда его читает JSONFormatter, см. core/logging.py) и в заголовок
ответа, и логирует одну строку на запрос: метод, путь, статус,
длительность, request_id. Тело запроса, заголовки авторизации и текст
промпта в лог не попадают.
"""

from __future__ import annotations

import logging
import secrets
import time

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging import request_id_var

logger = logging.getLogger("app.request")

REQUEST_ID_HEADER = "X-Request-Id"

# Симметрично nexd (requestid.go: id пуст или длиннее 64 символов —
# генерируем новый, не доверяя произвольно длинному значению клиента).
_MAX_INCOMING_LEN = 64


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        incoming = request.headers.get(REQUEST_ID_HEADER, "")
        request_id = incoming if incoming and len(incoming) <= _MAX_INCOMING_LEN else secrets.token_hex(16)
        token = request_id_var.set(request_id)
        start = time.monotonic()
        try:
            response = await call_next(request)
        except Exception:
            logger.exception(
                "http request failed",
                extra={"method": request.method, "path": request.url.path},
            )
            raise
        else:
            duration_ms = (time.monotonic() - start) * 1000
            response.headers[REQUEST_ID_HEADER] = request_id
            logger.info(
                "http request",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": round(duration_ms, 2),
                },
            )
            return response
        finally:
            request_id_var.reset(token)
