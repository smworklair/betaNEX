"""
Юнит-тесты OpenAICompatProvider — общий класс для openai/deepseek/qwen/
kimi/custom (см. app/main.py:_build_service). Проверяем контракт один раз
здесь, а не по разу на каждый "явный" провайдер — они отличаются только
конфигурацией (base_url/model), а не логикой запроса.

httpx мокается на транспортном уровне через respx — так тестируется
настоящий HTTP-контракт (URL, заголовки, тело), а не заглушка вместо
клиента.
"""

from __future__ import annotations

import asyncio

import httpx
import pytest
import respx

from app.providers.exceptions import ProviderAuthError, ProviderEmptyResponseError, ProviderHTTPError
from app.providers.openai_compat import OpenAICompatProvider


def _provider(name: str = "deepseek", base_url: str = "https://api.deepseek.com/v1") -> OpenAICompatProvider:
    return OpenAICompatProvider(
        name=name, api_key="test-key", base_url=base_url, model="test-model", timeout=5.0, max_output_tokens=256
    )


def test_complete_success() -> None:
    provider = _provider()

    @respx.mock
    async def scenario() -> None:
        route = respx.post("https://api.deepseek.com/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": " Привет! "}}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 3},
                },
            )
        )
        result = await provider.complete([], system="Будь краток")
        assert result.text == "Привет!"
        assert result.provider == "deepseek"
        assert result.usage.prompt_tokens == 10
        assert result.usage.completion_tokens == 3

        # Проверяем реальный контракт запроса, а не только ответ.
        sent = route.calls.last.request
        assert sent.headers["Authorization"] == "Bearer test-key"
        import json

        body = json.loads(sent.content)
        assert body["model"] == "test-model"
        assert body["messages"][0] == {"role": "system", "content": "Будь краток"}

    asyncio.run(scenario())


def test_complete_auth_error() -> None:
    provider = _provider()

    @respx.mock
    async def scenario() -> None:
        respx.post("https://api.deepseek.com/v1/chat/completions").mock(return_value=httpx.Response(401))
        with pytest.raises(ProviderAuthError):
            await provider.complete([], system=None)

    asyncio.run(scenario())


def test_complete_empty_response_raises() -> None:
    provider = _provider()

    @respx.mock
    async def scenario() -> None:
        respx.post("https://api.deepseek.com/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={"choices": [{"message": {"content": ""}}]})
        )
        with pytest.raises(ProviderEmptyResponseError):
            await provider.complete([], system=None)

    asyncio.run(scenario())


def test_complete_retries_on_500_then_succeeds() -> None:
    """Транзиентный 500 должен ретраиться (см. app/core/retry.py) и в итоге вернуть успех."""
    provider = _provider()

    @respx.mock
    async def scenario() -> None:
        route = respx.post("https://api.deepseek.com/v1/chat/completions").mock(
            side_effect=[
                httpx.Response(500, text="upstream error"),
                httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}], "usage": {}}),
            ]
        )
        result = await provider.complete([], system=None)
        assert result.text == "ok"
        assert route.call_count == 2

    asyncio.run(scenario())


def test_complete_does_not_retry_on_400() -> None:
    """4xx — проблема запроса, а не транзиентный сбой: повторов быть не должно."""
    provider = _provider()

    @respx.mock
    async def scenario() -> None:
        route = respx.post("https://api.deepseek.com/v1/chat/completions").mock(
            return_value=httpx.Response(400, text="bad request")
        )
        with pytest.raises(ProviderHTTPError):
            await provider.complete([], system=None)
        assert route.call_count == 1

    asyncio.run(scenario())


def test_missing_api_key_raises_at_construction() -> None:
    with pytest.raises(ValueError):
        OpenAICompatProvider(
            name="openai", api_key="", base_url="https://api.openai.com/v1", model="m", timeout=5.0, max_output_tokens=10
        )
