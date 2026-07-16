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

from fastapi import Depends, Request

from app.core.errors import RateLimitExceeded
from app.core.ratelimit import FixedWindowRateLimiter
from app.services.ai_service import AIService
from app.services.budget_service import BudgetService


def get_ai_service(request: Request) -> AIService:
    return request.app.state.ai_service


async def enforce_rate_limit(request: Request) -> None:
    """
    Простая защита от злоупотребления: не больше N запросов в минуту с
    одного IP (настраивается RATE_LIMIT_PER_MINUTE).

    Подключается как Depends только на "дорогих" эндпоинтах (/ask,
    /stream) — /healthz им намеренно не защищён, иначе мониторинг сам
    себя мог бы упереть в лимит.
    """
    limiter: FixedWindowRateLimiter = request.app.state.rate_limiter
    client_ip = request.client.host if request.client else "unknown"
    if not limiter.allow(client_ip):
        raise RateLimitExceeded()


async def get_tenant_id(request: Request) -> str:
    """
    Идентификация тенанта: заголовок X-Tenant-Id. Если клиент его не
    передал, запрос относится к синтетическому тенанту "default" — у
    ЛЮБОГО запроса есть бюджет, и заголовок нельзя обойти, просто не
    указав его (иначе бюджетирование ничего бы не стоило обойти).

    Более "боевой" вариант — резолвить tenant_id из API-ключа или
    сессии, а не из сырого заголовка (как в Go-версии NEX tenant
    резолвится из поддомена/заголовка ДО входа в бизнес-логику, см.
    docs/architecture-go.md, §5). Сюда легко добавить такой резолвер,
    не трогая остальной код — это единственная функция, которую нужно
    заменить.
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
