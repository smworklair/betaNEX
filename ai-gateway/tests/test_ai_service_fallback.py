"""
Юнит-тесты fallback-цепочки провайдеров в AIService (см. app/services/
ai_service.py:_resolve_chain). Используем OpenAICompatProvider как оба
"провайдера" цепочки (реальный HTTP-контракт, замоканный через respx,
как и в test_provider_openai_compat.py) — сам факт, что это два
экземпляра одного класса, не важен: сервис работает через интерфейс
LLMProvider, не зная, какой конкретно провайдер за ним стоит.

401/403 выбраны для имитации "провайдер недоступен" вместо 500 — это
ProviderAuthError, которая НЕ ретраится (см. app/core/retry.py), поэтому
тест не ждёт реальных задержек between-retry.
"""

from __future__ import annotations

import asyncio

import httpx
import pytest
import respx

from collections.abc import AsyncIterator

from app.core.budget_store import InMemoryBudgetStore
from app.providers.base import ChatMessage, CompletionResult, LLMProvider, StreamChunk
from app.providers.exceptions import ProviderTimeoutError
from app.providers.openai_compat import OpenAICompatProvider
from app.services.ai_service import AIService, AIServiceError
from app.services.budget_service import BudgetService, TenantBudget


class _FakeStreamingProvider(LLMProvider):
    """
    Двойник LLMProvider для сценария, который у реального
    OpenAICompatProvider не воспроизвести чисто через httpx-мок: провайдер
    успевает отдать часть текста и ТОЛЬКО ПОТОМ падает (например, разрыв
    соединения на середине долгого ответа). Единственный способ надёжно
    проверить, что AIService в этом случае не переключается на следующего
    в цепочке — управлять моментом ошибки напрямую, не через сетевой слой.
    """

    def __init__(self, name: str, *, chunks: list[StreamChunk], fail_after: bool) -> None:
        self.name = name
        self._chunks = chunks
        self._fail_after = fail_after

    async def complete(self, messages: list[ChatMessage], system: str | None = None) -> CompletionResult:
        raise NotImplementedError

    async def stream(self, messages: list[ChatMessage], system: str | None = None) -> AsyncIterator[StreamChunk]:
        for chunk in self._chunks:
            yield chunk
        if self._fail_after:
            raise ProviderTimeoutError(self.name)


def _provider(name: str, base_url: str) -> OpenAICompatProvider:
    return OpenAICompatProvider(
        name=name, api_key="test-key", base_url=base_url, model="test-model", timeout=5.0, max_output_tokens=256
    )


def _budget_service() -> BudgetService:
    # Лимитов нет ни по одному измерению — тесты фокусируются на
    # переключении провайдеров, а не на бюджете (он покрыт отдельно в
    # test_budget_service.py и test_request_limits.py).
    return BudgetService(
        store=InMemoryBudgetStore(), budgets={}, default_budget=TenantBudget(), pricing={}
    )


def _service(fallback_chain: list[str]) -> AIService:
    primary = _provider("primary", "https://primary.example/v1")
    secondary = _provider("secondary", "https://secondary.example/v1")
    return AIService(
        providers={"primary": primary, "secondary": secondary},
        default_provider="primary",
        budget_service=_budget_service(),
        fallback_chain=fallback_chain,
    )


def test_ask_falls_back_to_next_provider_on_auth_error() -> None:
    service = _service(["primary", "secondary"])

    @respx.mock
    async def scenario() -> None:
        respx.post("https://primary.example/v1/chat/completions").mock(return_value=httpx.Response(401))
        respx.post("https://secondary.example/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                json={"choices": [{"message": {"content": "ответ от secondary"}}], "usage": {"prompt_tokens": 5, "completion_tokens": 2}},
            )
        )
        result = await service.ask(
            message="привет", history=[], system=None, provider_name=None, tenant_id="acme"
        )
        assert result.text == "ответ от secondary"
        assert result.provider == "secondary"

        # Бюджет записан ровно один раз, за провайдера, который реально ответил.
        usage = await service._budget.usage_for("acme")
        assert usage.day.tokens == 7

    asyncio.run(scenario())


def test_ask_explicit_provider_does_not_fall_back() -> None:
    service = _service(["primary", "secondary"])

    @respx.mock
    async def scenario() -> None:
        respx.post("https://primary.example/v1/chat/completions").mock(return_value=httpx.Response(401))
        secondary_route = respx.post("https://secondary.example/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}], "usage": {}})
        )
        with pytest.raises(AIServiceError):
            await service.ask(
                message="привет", history=[], system=None, provider_name="primary", tenant_id="acme"
            )
        # Явный выбор провайдера — secondary не должен был вызываться вовсе.
        assert secondary_route.call_count == 0

    asyncio.run(scenario())


def test_ask_raises_after_entire_chain_fails() -> None:
    service = _service(["primary", "secondary"])

    @respx.mock
    async def scenario() -> None:
        respx.post("https://primary.example/v1/chat/completions").mock(return_value=httpx.Response(401))
        respx.post("https://secondary.example/v1/chat/completions").mock(return_value=httpx.Response(403))
        with pytest.raises(AIServiceError):
            await service.ask(message="привет", history=[], system=None, provider_name=None, tenant_id="acme")

    asyncio.run(scenario())


def test_stream_falls_back_before_first_chunk() -> None:
    service = _service(["primary", "secondary"])

    @respx.mock
    async def scenario() -> None:
        respx.post("https://primary.example/v1/chat/completions").mock(return_value=httpx.Response(401))
        respx.post("https://secondary.example/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                content=b'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n',
                headers={"Content-Type": "text/event-stream"},
            )
        )
        chunks = [
            chunk
            async for chunk in service.ask_stream(
                message="привет", history=[], system=None, provider_name=None, tenant_id="acme"
            )
        ]
        deltas = [c.delta for c in chunks if c.delta]
        assert deltas == ["hello"]

    asyncio.run(scenario())


def test_stream_does_not_fall_back_once_chunks_started() -> None:
    """
    Если первый провайдер отдал хотя бы один чанк, а затем упал (например,
    разрыв соединения на середине долгого ответа) — переключаться на
    следующего уже нельзя: часть ответа уже показана пользователю, начинать
    её заново от другой модели было бы хуже, чем оборвать поток ошибкой
    (см. api/routes.py, событие SSE "error").
    """
    primary = _FakeStreamingProvider("primary", chunks=[StreamChunk(delta="Приве")], fail_after=True)
    secondary_calls: list[str] = []

    class _SpySecondary(LLMProvider):
        name = "secondary"

        async def complete(self, messages: list[ChatMessage], system: str | None = None) -> CompletionResult:
            raise NotImplementedError

        async def stream(self, messages: list[ChatMessage], system: str | None = None) -> AsyncIterator[StreamChunk]:
            secondary_calls.append("called")
            yield StreamChunk(delta="не должно вызваться")

    service = AIService(
        providers={"primary": primary, "secondary": _SpySecondary()},
        default_provider="primary",
        budget_service=_budget_service(),
        fallback_chain=["primary", "secondary"],
    )

    async def scenario() -> None:
        received: list[str] = []
        with pytest.raises(AIServiceError):
            async for chunk in service.ask_stream(
                message="привет", history=[], system=None, provider_name=None, tenant_id="acme"
            ):
                if chunk.delta:
                    received.append(chunk.delta)
        assert received == ["Приве"]
        assert secondary_calls == []

    asyncio.run(scenario())
