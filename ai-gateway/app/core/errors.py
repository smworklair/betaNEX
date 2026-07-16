"""
Единый формат ошибок — RFC 9457 (application/problem+json), как в
Go-бэкенде NEX (internal/platform/httpapi/problem.go, см.
docs/architecture-go.md, §6). Совпадение не случайное: клиенту, который
уже умеет разбирать ошибки основного Go-сервиса, не нужно учить второй
формат специально для AI-шлюза.
"""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse

from app.services.ai_service import AIServiceError
from app.services.budget_service import BudgetExceededError


def problem(status: int, title: str, detail: str, **extra: object) -> JSONResponse:
    # **extra — расширение RFC 9457 (стандарт явно это допускает):
    # дополнительные поля сверх type/title/status/detail, чтобы клиент
    # мог программно отличить, например, ПОЧЕМУ именно исчерпан бюджет,
    # не парся текст detail.
    content: dict[str, object] = {"type": "about:blank", "title": title, "status": status, "detail": detail}
    content.update(extra)
    return JSONResponse(status_code=status, media_type="application/problem+json", content=content)


class RateLimitExceeded(Exception):
    def __init__(self, message: str = "слишком много запросов, попробуйте позже") -> None:
        self.message = message
        super().__init__(message)


async def ai_service_error_handler(request: Request, exc: AIServiceError) -> JSONResponse:
    return problem(exc.status_code, "ai-gateway error", exc.message)


async def rate_limit_error_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return problem(429, "rate limit exceeded", exc.message)


async def budget_exceeded_handler(request: Request, exc: BudgetExceededError) -> JSONResponse:
    # 429, а не 402 (Payment Required) — тем же кодом, что уже описан
    # как план для Go-версии в docs/ai/README.md, §2.4: "Budget
    # проверяет лимит tenant'а до запроса (429 при исчерпании)". Смысл
    # тот же, что и у rate-limit (429) — "попробуй позже", просто окно
    # ожидания не минута, а до конца суток/месяца (см. поле period).
    return problem(
        429,
        "tenant budget exceeded",
        str(exc),
        tenant_id=exc.tenant_id,
        period=exc.period,
        limit_kind=exc.kind,
        limit=exc.limit,
        used=exc.used,
    )
