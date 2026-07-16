"""
Сервисный слой: единственная точка входа для роутера, не знающая ничего
про HTTP и ничего про конкретный провайдер.

Отвечает за:
- выбор провайдера (явный из запроса либо провайдер по умолчанию из конфига);
- единый системный промпт, если вызывающий его не передал;
- перевод ошибок провайдера (ProviderError) в ошибку сервиса
  (AIServiceError), которую уже роутер превращает в HTTP-ответ.

Роутер (app/api/routes.py) НЕ обращается к провайдерам напрямую — это и
есть смысл слоистости router → service → provider.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from app.core.context_registry import PageContext, build_context_block
from app.providers.base import ChatMessage, CompletionResult, LLMProvider, StreamChunk, Usage
from app.providers.exceptions import (
    ProviderAuthError,
    ProviderError,
    ProviderHTTPError,
    ProviderTimeoutError,
)
from app.services.budget_service import BudgetService

logger = logging.getLogger(__name__)

DEFAULT_SYSTEM_PROMPT = (
    "Ты — учебный AI-ассистент сервиса ai-gateway проекта NEX. "
    "Отвечай кратко, по делу, без лишних вступлений."
)


class AIServiceError(Exception):
    """Ошибка, которую видит роутер и переводит в HTTP problem+json-ответ."""

    def __init__(self, message: str, *, status_code: int = 502) -> None:
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def _resolve_system(explicit_system: str | None, context: PageContext | None) -> str:
    """
    Явный `system` (передан клиентом целиком) имеет приоритет — так
    главный чат NEX (web/src/pages/Chat.tsx) может слать свою большую
    константу ORG_CONTEXT, не завязанную на один раздел. Если явного
    system нет, но есть context — берём DEFAULT_SYSTEM_PROMPT и
    подмешиваем инструкцию раздела из context_registry.py. Если нет ни
    того ни другого — просто DEFAULT_SYSTEM_PROMPT.

    Почему полный оверрайд — это ОК, а не дыра: `system` доступен только
    аутентифицированным вызовам через прокси nexd (см. app/deps.py:
    verify_gateway_secret, internal/platform/httpapi/aiproxy.go) — не
    открытому интернету. Это первый-party фронтенд NEX с захардкоженным
    ORG_CONTEXT, а не текст, введённый пользователем: реальный
    prompt-injection риск — не в `system` (не пользовательский ввод), а
    в `message`/`history`/`context.facts` (пользовательский ввод),
    которые всегда идут ОТДЕЛЬНЫМИ структурными полями (роль "user" или
    данные context'а), а не конкатенируются в текст системной
    инструкции — так модель может отличить "инструкция" от "данные" на
    уровне контракта API, а не текстовой эвристикой. Размер `system`/
    `history`/`facts` ограничен в api/schemas.py — без этого
    неограниченный `system` сам по себе был бы вектором amplification-DoS
    по стоимости вызова провайдера.
    """
    if explicit_system:
        return explicit_system
    context_block = build_context_block(context)
    if context_block:
        return f"{DEFAULT_SYSTEM_PROMPT} {context_block}"
    return DEFAULT_SYSTEM_PROMPT


def _status_for(exc: ProviderError) -> int:
    # Ключ провайдера неверен — это НАША конфигурация, а не проблема
    # клиента сервиса, поэтому 502 (Bad Gateway), а не 401: 401 здесь
    # означал бы "у тебя нет доступа к ai-gateway", что неверно.
    if isinstance(exc, ProviderAuthError):
        return 502
    if isinstance(exc, ProviderTimeoutError):
        return 504
    if isinstance(exc, ProviderHTTPError) and 400 <= exc.status_code < 500:
        return 502
    return 502


class AIService:
    def __init__(
        self, providers: dict[str, LLMProvider], default_provider: str, budget_service: BudgetService
    ) -> None:
        self._providers = providers
        self._default_provider = default_provider
        self._budget = budget_service

    @property
    def provider_names(self) -> list[str]:
        return list(self._providers)

    @property
    def default_provider(self) -> str:
        return self._default_provider

    def _resolve(self, provider_name: str | None) -> LLMProvider:
        name = provider_name or self._default_provider
        provider = self._providers.get(name)
        if provider is None:
            raise AIServiceError(f"провайдер не настроен: {name!r}", status_code=400)
        return provider

    async def ask(
        self,
        *,
        message: str,
        history: list[ChatMessage],
        system: str | None,
        context: PageContext | None = None,
        provider_name: str | None,
        tenant_id: str,
    ) -> CompletionResult:
        # Проверка лимита (check) сюда сознательно НЕ дублируется — она
        # уже выполнена на уровне Depends до вызова этого метода, см.
        # app/deps.py:enforce_budget и пояснение в шапке budget_service.py.
        provider = self._resolve(provider_name)
        messages = [*history, ChatMessage(role="user", content=message)]
        try:
            result = await provider.complete(messages, _resolve_system(system, context))
        except ProviderError as exc:
            logger.warning("ai_service.ask: %s", exc)
            raise AIServiceError(exc.message, status_code=_status_for(exc)) from exc
        await self._budget.record(tenant_id, provider.name, result.usage)
        return result

    async def ask_stream(
        self,
        *,
        message: str,
        history: list[ChatMessage],
        system: str | None,
        context: PageContext | None = None,
        provider_name: str | None,
        tenant_id: str,
    ) -> AsyncIterator[StreamChunk]:
        provider = self._resolve(provider_name)
        messages = [*history, ChatMessage(role="user", content=message)]
        # Итоговый usage приходит только в последнем чанке потока
        # (см. providers/gemini.py и openai_compat.py) — накапливаем
        # его тут, чтобы записать в бюджет один раз в конце, а не по
        # частям.
        usage = Usage()
        try:
            async for chunk in provider.stream(messages, _resolve_system(system, context)):
                if chunk.usage:
                    usage = chunk.usage
                yield chunk
        except ProviderError as exc:
            logger.warning("ai_service.ask_stream: %s", exc)
            raise AIServiceError(exc.message, status_code=_status_for(exc)) from exc
        await self._budget.record(tenant_id, provider.name, usage)
