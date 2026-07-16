"""
Юнит-тесты интеграции кэша ответов в AIService (см. app/services/
ai_service.py:_cache_key и app/core/response_cache.py). Провайдер —
OpenAICompatProvider с respx-моком (как в test_provider_openai_compat.py
и test_ai_service_fallback.py): попадание в кэш проверяем по
route.call_count — если он не вырос на втором запросе, к сети вообще не
обращались.
"""

from __future__ import annotations

import asyncio

import httpx
import respx

from app.core.budget_store import InMemoryBudgetStore
from app.core.response_cache import InMemoryResponseCache
from app.providers.openai_compat import OpenAICompatProvider
from app.services.ai_service import AIService
from app.services.budget_service import BudgetService, TenantBudget


def _provider(name: str = "gemini", base_url: str = "https://gemini.example/v1") -> OpenAICompatProvider:
    return OpenAICompatProvider(
        name=name, api_key="test-key", base_url=base_url, model="test-model", timeout=5.0, max_output_tokens=256
    )


def _budget_service() -> BudgetService:
    return BudgetService(store=InMemoryBudgetStore(), budgets={}, default_budget=TenantBudget(), pricing={})


def _service(cache: InMemoryResponseCache | None) -> AIService:
    provider = _provider()
    return AIService(
        providers={"gemini": provider},
        default_provider="gemini",
        budget_service=_budget_service(),
        fallback_chain=["gemini"],
        cache=cache,
        cache_ttl_seconds=60.0,
    )


def test_second_identical_ask_is_served_from_cache_without_network_call() -> None:
    service = _service(InMemoryResponseCache())

    @respx.mock
    async def scenario() -> None:
        route = respx.post("https://gemini.example/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": "ответ раз"}}],
                    "usage": {"prompt_tokens": 5, "completion_tokens": 3},
                },
            )
        )
        first = await service.ask(message="привет", history=[], system=None, provider_name=None, tenant_id="acme")
        assert first.text == "ответ раз"
        assert route.call_count == 1

        second = await service.ask(message="привет", history=[], system=None, provider_name=None, tenant_id="acme")
        assert second.text == "ответ раз"  # тот же кэшированный текст
        assert route.call_count == 1  # к сети не ходили второй раз

        # Кэш-хит не тратит бюджет тенанта.
        usage = await service._budget.usage_for("acme")
        assert usage.day.tokens == 8  # только от первого (реального) запроса

    asyncio.run(scenario())


def test_cache_disabled_hits_network_every_time() -> None:
    service = _service(cache=None)

    @respx.mock
    async def scenario() -> None:
        route = respx.post("https://gemini.example/v1/chat/completions").mock(
            return_value=httpx.Response(
                200, json={"choices": [{"message": {"content": "ok"}}], "usage": {}}
            )
        )
        await service.ask(message="привет", history=[], system=None, provider_name=None, tenant_id="acme")
        await service.ask(message="привет", history=[], system=None, provider_name=None, tenant_id="acme")
        assert route.call_count == 2

    asyncio.run(scenario())


def test_cache_is_isolated_between_tenants() -> None:
    """
    Требование безопасности: один тенант не должен получать ответ,
    закэшированный для промпта другого (см. докстринг
    core/response_cache.py) — даже если вопрос дословно совпадает.
    """
    service = _service(InMemoryResponseCache())

    @respx.mock
    async def scenario() -> None:
        route = respx.post("https://gemini.example/v1/chat/completions").mock(
            return_value=httpx.Response(
                200, json={"choices": [{"message": {"content": "ok"}}], "usage": {}}
            )
        )
        await service.ask(message="привет", history=[], system=None, provider_name=None, tenant_id="tenant-a")
        await service.ask(message="привет", history=[], system=None, provider_name=None, tenant_id="tenant-b")
        # Разные тенанты — разные ключи кэша, оба реально сходили к провайдеру.
        assert route.call_count == 2

    asyncio.run(scenario())


def test_different_history_produces_different_cache_key() -> None:
    service = _service(InMemoryResponseCache())

    @respx.mock
    async def scenario() -> None:
        route = respx.post("https://gemini.example/v1/chat/completions").mock(
            return_value=httpx.Response(
                200, json={"choices": [{"message": {"content": "ok"}}], "usage": {}}
            )
        )
        from app.providers.base import ChatMessage

        await service.ask(message="привет", history=[], system=None, provider_name=None, tenant_id="acme")
        await service.ask(
            message="привет",
            history=[ChatMessage(role="user", content="контекст другой")],
            system=None,
            provider_name=None,
            tenant_id="acme",
        )
        assert route.call_count == 2  # разная история — разный кэш-ключ, оба реальны

    asyncio.run(scenario())


def test_stream_second_identical_request_served_from_cache() -> None:
    service = _service(InMemoryResponseCache())

    @respx.mock
    async def scenario() -> None:
        route = respx.post("https://gemini.example/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                content=b'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n',
                headers={"Content-Type": "text/event-stream"},
            )
        )
        first_chunks = [
            c
            async for c in service.ask_stream(
                message="привет", history=[], system=None, provider_name=None, tenant_id="acme"
            )
        ]
        assert [c.delta for c in first_chunks if c.delta] == ["hello"]
        assert route.call_count == 1

        second_chunks = [
            c
            async for c in service.ask_stream(
                message="привет", history=[], system=None, provider_name=None, tenant_id="acme"
            )
        ]
        assert [c.delta for c in second_chunks if c.delta] == ["hello"]
        assert route.call_count == 1  # второй раз — из кэша, без сети

    asyncio.run(scenario())
