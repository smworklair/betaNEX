"""
Тесты метрик Prometheus (app/core/metrics.py): эндпоинт /metrics и то,
что AIService реально пишет провайдерские метрики (успех/фолбэк/
кэш-хит/ошибка, токены, стоимость) в нужных точках.
"""

from __future__ import annotations

import asyncio

import httpx
import pytest
import respx
from starlette.testclient import TestClient

from app.config import Settings
from app.core.budget_store import InMemoryBudgetStore
from app.core.metrics import PROVIDER_REQUESTS_TOTAL, PROVIDER_TOKENS_TOTAL
from app.core.response_cache import InMemoryResponseCache
from app.main import create_app
from app.providers.openai_compat import OpenAICompatProvider
from app.services.ai_service import AIService
from app.services.budget_service import BudgetService, TenantBudget


def _counter_value(counter, **labels: str) -> float:
    return counter.labels(**labels)._value.get()  # noqa: SLF001 — стандартный приём тестирования prometheus_client


def _budget_service() -> BudgetService:
    return BudgetService(store=InMemoryBudgetStore(), budgets={}, default_budget=TenantBudget(), pricing={})


def test_metrics_endpoint_exposes_http_counters(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(gigachat_mock=True)
    monkeypatch.setattr("app.main.get_settings", lambda: settings)
    client = TestClient(create_app())

    client.get("/healthz")
    resp = client.get("/metrics")

    assert resp.status_code == 200
    assert "aigw_http_requests_total" in resp.text
    assert 'route="/healthz"' in resp.text


def test_ask_success_records_provider_and_token_metrics() -> None:
    provider = OpenAICompatProvider(
        name="primary-metrics", api_key="k", base_url="https://primary-metrics.example/v1",
        model="m", timeout=5.0, max_output_tokens=256,
    )
    service = AIService(
        providers={"primary-metrics": provider}, default_provider="primary-metrics", budget_service=_budget_service(),
    )
    before = _counter_value(PROVIDER_REQUESTS_TOTAL, provider="primary-metrics", outcome="success")

    @respx.mock
    async def scenario() -> None:
        respx.post("https://primary-metrics.example/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                json={"choices": [{"message": {"content": "ok"}}], "usage": {"prompt_tokens": 3, "completion_tokens": 2}},
            )
        )
        await service.ask(message="hi", history=[], system=None, provider_name=None, tenant_id="acme")

    asyncio.run(scenario())

    assert _counter_value(PROVIDER_REQUESTS_TOTAL, provider="primary-metrics", outcome="success") == before + 1
    assert _counter_value(PROVIDER_TOKENS_TOTAL, provider="primary-metrics", kind="prompt") >= 3
    assert _counter_value(PROVIDER_TOKENS_TOTAL, provider="primary-metrics", kind="completion") >= 2


def test_ask_fallback_records_error_and_fallback_outcomes() -> None:
    primary = OpenAICompatProvider(
        name="fb-primary", api_key="k", base_url="https://fb-primary.example/v1",
        model="m", timeout=5.0, max_output_tokens=256,
    )
    secondary = OpenAICompatProvider(
        name="fb-secondary", api_key="k", base_url="https://fb-secondary.example/v1",
        model="m", timeout=5.0, max_output_tokens=256,
    )
    service = AIService(
        providers={"fb-primary": primary, "fb-secondary": secondary},
        default_provider="fb-primary",
        budget_service=_budget_service(),
        fallback_chain=["fb-primary", "fb-secondary"],
    )
    error_before = _counter_value(PROVIDER_REQUESTS_TOTAL, provider="fb-primary", outcome="error")
    fallback_before = _counter_value(PROVIDER_REQUESTS_TOTAL, provider="fb-secondary", outcome="fallback")

    @respx.mock
    async def scenario() -> None:
        respx.post("https://fb-primary.example/v1/chat/completions").mock(return_value=httpx.Response(401))
        respx.post("https://fb-secondary.example/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}], "usage": {}})
        )
        await service.ask(message="hi", history=[], system=None, provider_name=None, tenant_id="acme")

    asyncio.run(scenario())

    assert _counter_value(PROVIDER_REQUESTS_TOTAL, provider="fb-primary", outcome="error") == error_before + 1
    assert _counter_value(PROVIDER_REQUESTS_TOTAL, provider="fb-secondary", outcome="fallback") == fallback_before + 1


def test_ask_cache_hit_records_cache_hit_outcome() -> None:
    provider = OpenAICompatProvider(
        name="cache-provider", api_key="k", base_url="https://cache-provider.example/v1",
        model="m", timeout=5.0, max_output_tokens=256,
    )
    service = AIService(
        providers={"cache-provider": provider},
        default_provider="cache-provider",
        budget_service=_budget_service(),
        cache=InMemoryResponseCache(),
        cache_ttl_seconds=60.0,
    )
    hit_before = _counter_value(PROVIDER_REQUESTS_TOTAL, provider="cache-provider", outcome="cache_hit")

    @respx.mock
    async def scenario() -> None:
        respx.post("https://cache-provider.example/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}], "usage": {}})
        )
        await service.ask(message="hi", history=[], system=None, provider_name=None, tenant_id="acme")
        # Второй одинаковый запрос — кэш-хит, провайдер не должен вызываться снова.
        await service.ask(message="hi", history=[], system=None, provider_name=None, tenant_id="acme")

    asyncio.run(scenario())

    assert _counter_value(PROVIDER_REQUESTS_TOTAL, provider="cache-provider", outcome="cache_hit") == hit_before + 1
