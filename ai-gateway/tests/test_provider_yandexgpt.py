"""
Юнит-тесты YandexGPTProvider.

⚠️ Как и в test_provider_gigachat.py — реализация проверена по
документации Yandex Cloud Foundation Models, httpx замокан через respx.
Живой поход в llm.api.cloud.yandex.net из этой среды не выполнялся (нет
реального Api-Key/folder_id) — см. app/providers/yandexgpt.py, шапка файла.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
import respx

from app.providers.exceptions import ProviderAuthError, ProviderEmptyResponseError
from app.providers.yandexgpt import YandexGPTProvider


def _provider(**overrides) -> YandexGPTProvider:
    kwargs = dict(
        api_key="test-api-key",
        folder_id="b1gfolder123",
        model="yandexgpt-lite",
        base_url="https://llm.api.cloud.yandex.net",
        timeout=5.0,
        max_output_tokens=256,
    )
    kwargs.update(overrides)
    return YandexGPTProvider(**kwargs)


def test_mock_mode_never_touches_network() -> None:
    provider = _provider(api_key="", folder_id="", mock=True)

    @respx.mock
    async def scenario() -> None:
        result = await provider.complete([], system=None)
        assert "YANDEXGPT_MOCK" in result.text

    asyncio.run(scenario())


def test_complete_success_and_request_contract() -> None:
    provider = _provider()

    @respx.mock
    async def scenario() -> None:
        route = respx.post("https://llm.api.cloud.yandex.net/foundationModels/v1/completion").mock(
            return_value=httpx.Response(
                200,
                json={
                    "result": {
                        "alternatives": [{"message": {"role": "assistant", "text": " Привет! "}, "status": "ALTERNATIVE_STATUS_FINAL"}],
                        "usage": {"inputTextTokens": "12", "completionTokens": "4", "totalTokens": "16"},
                    }
                },
            )
        )
        result = await provider.complete([], system="Будь краток")
        assert result.text == "Привет!"
        assert result.usage.prompt_tokens == 12
        assert result.usage.completion_tokens == 4

        sent = route.calls.last.request
        assert sent.headers["Authorization"] == "Api-Key test-api-key"
        assert sent.headers["x-folder-id"] == "b1gfolder123"
        body = json.loads(sent.content)
        assert body["modelUri"] == "gpt://b1gfolder123/yandexgpt-lite/latest"
        assert body["messages"][0] == {"role": "system", "text": "Будь краток"}
        assert body["completionOptions"]["stream"] is False

    asyncio.run(scenario())


def test_complete_auth_error() -> None:
    provider = _provider()

    @respx.mock
    async def scenario() -> None:
        respx.post("https://llm.api.cloud.yandex.net/foundationModels/v1/completion").mock(
            return_value=httpx.Response(401)
        )
        with pytest.raises(ProviderAuthError):
            await provider.complete([], system=None)

    asyncio.run(scenario())


def test_complete_empty_response_raises() -> None:
    provider = _provider()

    @respx.mock
    async def scenario() -> None:
        respx.post("https://llm.api.cloud.yandex.net/foundationModels/v1/completion").mock(
            return_value=httpx.Response(200, json={"result": {"alternatives": [{"message": {"text": ""}}]}})
        )
        with pytest.raises(ProviderEmptyResponseError):
            await provider.complete([], system=None)

    asyncio.run(scenario())


def test_stream_converts_cumulative_text_to_deltas() -> None:
    """
    YandexGPT в стриме присылает НАКОПЛЕННЫЙ текст на каждый чанк (не
    дельту, в отличие от OpenAI/Gemini) — провайдер обязан сам вычислить
    разницу, иначе клиент увидит текст, дублирующийся на каждый чанк.
    """
    provider = _provider()

    ndjson = "\n".join(
        json.dumps({"result": {"alternatives": [{"message": {"text": text}}], "usage": usage}})
        for text, usage in [
            ("Привет", None),
            ("Привет, как", None),
            ("Привет, как дела?", {"inputTextTokens": "3", "completionTokens": "6"}),
        ]
    )

    @respx.mock
    async def scenario() -> None:
        respx.post("https://llm.api.cloud.yandex.net/foundationModels/v1/completion").mock(
            return_value=httpx.Response(200, content=ndjson.encode("utf-8"))
        )
        deltas = []
        final_usage = None
        async for chunk in provider.stream([], system=None):
            if chunk.delta:
                deltas.append(chunk.delta)
            if chunk.usage:
                final_usage = chunk.usage

        assert deltas == ["Привет", ", как", " дела?"]
        assert final_usage is not None
        assert final_usage.prompt_tokens == 3
        assert final_usage.completion_tokens == 6

    asyncio.run(scenario())


def test_missing_config_raises_unless_mock() -> None:
    with pytest.raises(ValueError):
        YandexGPTProvider(
            api_key="", folder_id="", model="yandexgpt-lite", base_url="https://llm.api.cloud.yandex.net",
            timeout=5.0, max_output_tokens=256,
        )
