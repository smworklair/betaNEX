"""
HTTP-эндпоинты. Роутер — самый тонкий слой в приложении: разобрать
запрос, вызвать сервис, сформировать ответ. Никакой бизнес-логики и
никаких прямых вызовов провайдеров здесь быть не должно — это задача
app/services/ai_service.py.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.api.schemas import AskRequest, AskResponse, HealthResponse, ProvidersResponse, UsageOut
from app.api.schemas import PageContext as PageContextIn
from app.core.context_registry import PageContext
from app.deps import enforce_budget, enforce_rate_limit, get_ai_service, get_tenant_id
from app.providers.base import ChatMessage
from app.services.ai_service import AIService

logger = logging.getLogger(__name__)

router = APIRouter()


def _to_service_context(context: PageContextIn | None) -> PageContext | None:
    """Pydantic-схема запроса → сервисный dataclass (см. ai_service.py, шапка файла)."""
    if context is None:
        return None
    return PageContext(page=context.page, title=context.title, facts=list(context.facts), state=context.state)


@router.get("/api/v1/ai/providers", response_model=ProvidersResponse, tags=["ai"])
async def providers(service: AIService = Depends(get_ai_service)) -> ProvidersResponse:
    """
    Список реально настроенных на сервере провайдеров (по каким заданы
    ключи в .env) — фронтенд использует это, чтобы показать выбор
    провайдера в Настройках, не храня и не проверяя никакие ключи сам.
    """
    return ProvidersResponse(providers=service.provider_names, default=service.default_provider)


@router.get("/healthz", response_model=HealthResponse, tags=["service"])
async def healthz() -> HealthResponse:
    """Liveness-проверка — без обращения к провайдерам (быстро и дёшево)."""
    return HealthResponse()


@router.post(
    "/api/v1/ai/ask",
    response_model=AskResponse,
    dependencies=[Depends(enforce_rate_limit), Depends(enforce_budget)],
    tags=["ai"],
)
async def ask(
    req: AskRequest,
    service: AIService = Depends(get_ai_service),
    tenant_id: str = Depends(get_tenant_id),
) -> AskResponse:
    """Обычный (не потоковый) запрос: дождаться полного ответа модели и вернуть JSON."""
    history = [ChatMessage(role=m.role, content=m.content) for m in req.history]
    result = await service.ask(
        message=req.message,
        history=history,
        system=req.system,
        context=_to_service_context(req.context),
        provider_name=req.provider,
        tenant_id=tenant_id,
    )
    return AskResponse(
        text=result.text,
        provider=result.provider,
        model=result.model,
        usage=UsageOut(
            prompt_tokens=result.usage.prompt_tokens,
            completion_tokens=result.usage.completion_tokens,
            total_tokens=result.usage.total_tokens,
        ),
    )


@router.post(
    "/api/v1/ai/stream",
    dependencies=[Depends(enforce_rate_limit), Depends(enforce_budget)],
    tags=["ai"],
)
async def ask_stream(
    req: AskRequest,
    service: AIService = Depends(get_ai_service),
    tenant_id: str = Depends(get_tenant_id),
) -> StreamingResponse:
    """
    Потоковый ответ через Server-Sent Events.

    Контракт (event: delta / event: usage / event: error) сознательно
    совпадает с тем, что описан как план для Go-бэкенда в
    docs/ai/README.md, §2.6 — так проще сравнить этот учебный сервис с
    "боевым" планом NEX и увидеть, что стриминг — это один и тот же
    протокол независимо от языка реализации.
    """
    history = [ChatMessage(role=m.role, content=m.content) for m in req.history]

    async def event_source():
        try:
            async for chunk in service.ask_stream(
                message=req.message,
                history=history,
                system=req.system,
                context=_to_service_context(req.context),
                provider_name=req.provider,
                tenant_id=tenant_id,
            ):
                if chunk.delta:
                    yield _sse("delta", {"text": chunk.delta})
                if chunk.usage:
                    yield _sse(
                        "usage",
                        {
                            "prompt_tokens": chunk.usage.prompt_tokens,
                            "completion_tokens": chunk.usage.completion_tokens,
                            "total_tokens": chunk.usage.total_tokens,
                        },
                    )
        except Exception as exc:  # noqa: BLE001
            # HTTP-статус 200 к этому моменту уже отправлен клиенту (стрим
            # начался) — сообщить об ошибке можно только SSE-событием
            # error, а не сменой статус-кода, поэтому ловим широко.
            logger.warning("stream error: %s", exc)
            yield _sse("error", {"detail": str(exc)})

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
