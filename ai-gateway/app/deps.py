"""
Зависимости FastAPI (Depends): достаём сервис и rate-limiter из
состояния приложения (app.state), а не из глобальных переменных модуля.

Почему не глобальные переменные: явная сборка в одном месте (см.
app/main.py:create_app) легче тестировать и понимать, чем неявные
синглтоны, создающиеся при импорте модуля. Тот же принцип, что в Go:
"явное лучше неявного", всё собирается в композиционном корне
(docs/architecture-go.md, §1).
"""

from __future__ import annotations

import hmac

from fastapi import Depends, HTTPException, Request, status

from app.config import get_settings
from app.core.errors import RateLimitExceeded
from app.core.ratelimit import RateLimiter
from app.services.ai_service import AIService
from app.services.budget_service import BudgetService

GATEWAY_SECRET_HEADER = "X-Gateway-Secret"


def get_ai_service(request: Request) -> AIService:
    return request.app.state.ai_service


async def verify_gateway_secret(request: Request) -> None:
    """
    Проверка серверного секрета nexd↔ai-gateway (см. Settings.gateway_shared_secret).

    Пока секрет не настроен (пусто) — пропускает всё как раньше: это
    сохраняет локальную разработку (`uvicorn app.main:app` без nexd
    рядом) рабочей без дополнительной настройки. Как только секрет
    задан (staging/prod, см. deploy/.env.example) — запрос без него или
    с неверным значением отклоняется ДО того, как X-Tenant-Id вообще
    будет прочитан: без этого X-Tenant-Id остаётся самопредставлением
    клиента, а не проверенным фактом (см. get_tenant_id ниже).

    hmac.compare_digest — не ради тайминг-атаки по сети (шум сети её и
    так скрывает), а чтобы не оставлять в коде обычное `==` для
    сравнения секретов по многолетней конвенции ("так не сравнивают
    секреты"), которую проще один раз соблюсти, чем каждый раз
    объяснять на код-ревью, почему тут исключение.
    """
    secret = get_settings().gateway_shared_secret
    if not secret:
        return
    given = request.headers.get(GATEWAY_SECRET_HEADER, "")
    if not given or not hmac.compare_digest(given, secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or missing gateway secret")


async def enforce_rate_limit(request: Request) -> None:
    """
    Простая защита от злоупотребления: не больше N запросов в минуту с
    одного IP (настраивается RATE_LIMIT_PER_MINUTE).

    Подключается как Depends только на "дорогих" эндпоинтах (/ask,
    /stream) — /healthz им намеренно не защищён, иначе мониторинг сам
    себя мог бы упереть в лимит.
    """
    limiter: RateLimiter = request.app.state.rate_limiter
    client_ip = request.client.host if request.client else "unknown"
    if not await limiter.allow(client_ip):
        raise RateLimitExceeded()


async def get_tenant_id(request: Request) -> str:
    """
    Идентификация тенанта: заголовок X-Tenant-Id.

    Сам по себе этот заголовок — самопредставление клиента: без
    дополнительной проверки любой, кто может достучаться до ai-gateway,
    мог бы вписать туда чужого/дорогого тенанта и кататься на его
    бюджете. Поэтому эндпоинты, которые тратят бюджет (/ask, /stream,
    /providers), навешивают verify_gateway_secret ПЕРЕД этой
    зависимостью (см. api/routes.py) — он отклоняет запрос, если
    настроен gateway_shared_secret, а секрета нет или он неверный.
    Секрет и X-Tenant-Id подставляет только nexd (internal/platform/
    aiproxy), беря tenant_id из настоящей аутентифицированной сессии, а
    не из тела запроса браузера — так подделать заголовок с уровня
    браузера уже нельзя.

    Если секрет не настроен (локальная разработка без nexd рядом,
    gateway_shared_secret == "") — поведение то же, что было раньше:
    заголовок читается как есть, без header'а запрос уходит в
    синтетический тенант "default".
    """
    return request.headers.get("X-Tenant-Id", "").strip() or "default"


async def enforce_budget(request: Request, tenant_id: str = Depends(get_tenant_id)) -> None:
    """
    Пред-проверка бюджета тенанта — ДО входа в обработчик.

    Важно именно "до", а не "после": для /stream HTTP-статус 200 уходит
    клиенту, как только начинается тело StreamingResponse, и сменить
    его на "бюджет исчерпан" уже нельзя. Проверка на уровне Depends
    гарантирует обычный ответ 429 вместо SSE-события error после уже
    отправленного 200. Подробности — app/services/budget_service.py.
    """
    budget_service: BudgetService = request.app.state.budget_service
    await budget_service.check(tenant_id)
