"""
Ограничение размера тела запроса — до того, как оно попадёт в Pydantic.

Поля запроса (AskRequest.message/history/system, PageContext.facts) уже
ограничены по длине (см. api/schemas.py), но Pydantic валидирует их
ПОСЛЕ того, как ASGI-сервер полностью прочитал тело в память — сколь
угодно большое тело (гигабайты) всё равно было бы буферизовано целиком
до отказа. Эта проверка режет запрос по Content-Length раньше, до
чтения тела хендлером.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

# С запасом над суммой лимитов полей (message 8000 + history 50×8000 +
# system 20000 + facts 50×500 + служебный JSON-оверхед) — реальные
# запросы укладываются на порядок меньше.
MAX_BODY_BYTES = 1_000_000


class MaxBodySizeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                size = int(content_length)
            except ValueError:
                size = None
            if size is not None and size > MAX_BODY_BYTES:
                return JSONResponse(
                    status_code=413,
                    content={
                        "type": "about:blank",
                        "title": "payload too large",
                        "status": 413,
                        "detail": f"тело запроса больше {MAX_BODY_BYTES} байт",
                    },
                )
        return await call_next(request)
