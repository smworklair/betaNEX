"""
Юнит-тесты GigaChatProvider.

⚠️ Как и сам провайдер — эти тесты проверяют реализацию контракта строго
по документации (OAuth2 client credentials + /chat/completions), httpx
замокан через respx. Реального сетевого похода в ngw.devices.sberbank.ru
здесь нет и не может быть — живой сервис с этой средой не проверялся
(см. app/providers/gigachat.py, шапка файла).
"""

from __future__ import annotations

import asyncio
import time

import httpx
import pytest
import respx

from app.providers.exceptions import ProviderAuthError
from app.providers.gigachat import GigaChatProvider


def _provider(**overrides) -> GigaChatProvider:
    kwargs = dict(
        auth_key="dGVzdDp0ZXN0",  # base64("test:test") — фиктивный, для теста формата заголовка
        scope="GIGACHAT_API_PERS",
        oauth_url="https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
        base_url="https://gigachat.devices.sberbank.ru/api/v1",
        model="GigaChat",
        timeout=5.0,
        max_output_tokens=256,
        insecure_skip_verify=True,  # только для теста — реальный CA-бандл сюда не нужен
    )
    kwargs.update(overrides)
    return GigaChatProvider(**kwargs)


def test_mock_mode_never_touches_network() -> None:
    provider = _provider(auth_key="", mock=True)

    @respx.mock  # без зарегистрированных роутов — любой реальный запрос тут же упадёт
    async def scenario() -> None:
        result = await provider.complete([], system=None)
        assert "GIGACHAT_MOCK" in result.text

    asyncio.run(scenario())


def test_oauth_flow_and_token_reuse() -> None:
    provider = _provider()

    @respx.mock
    async def scenario() -> None:
        oauth_route = respx.post("https://ngw.devices.sberbank.ru:9443/api/v2/oauth").mock(
            return_value=httpx.Response(
                200, json={"access_token": "tok-1", "expires_at": int((time.time() + 3600) * 1000)}
            )
        )
        chat_route = respx.post("https://gigachat.devices.sberbank.ru/api/v1/chat/completions").mock(
            return_value=httpx.Response(
                200, json={"choices": [{"message": {"content": "ответ"}}], "usage": {"prompt_tokens": 5, "completion_tokens": 2}}
            )
        )

        result = await provider.complete([], system="сис. промпт")
        assert result.text == "ответ"
        assert result.provider == "gigachat"

        # Второй вызов — токен ещё валиден (запас 3600с), OAuth не должен переспрашиваться.
        await provider.complete([], system="сис. промпт")

        assert oauth_route.call_count == 1
        assert chat_route.call_count == 2

        # Проверяем реальный заголовок авторизации chat-запроса.
        last_chat = chat_route.calls.last.request
        assert last_chat.headers["Authorization"] == "Bearer tok-1"
        oauth_req = oauth_route.calls.last.request
        assert oauth_req.headers["Authorization"] == "Basic dGVzdDp0ZXN0"
        assert "RqUID" in oauth_req.headers

    asyncio.run(scenario())


def test_token_refetched_when_close_to_expiry() -> None:
    """
    Токен с expires_at ближе чем 60с к текущему моменту считается
    непригодным для переиспользования (см. GigaChatProvider._get_token —
    60-секундный запас на сетевую задержку) — OAuth должен вызываться
    заново на каждый такой запрос.
    """
    provider = _provider()

    @respx.mock
    async def scenario() -> None:
        oauth_route = respx.post("https://ngw.devices.sberbank.ru:9443/api/v2/oauth").mock(
            return_value=httpx.Response(
                200, json={"access_token": "tok-soon-expired", "expires_at": int((time.time() + 30) * 1000)}
            )
        )
        respx.post("https://gigachat.devices.sberbank.ru/api/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}], "usage": {}})
        )

        await provider.complete([], system=None)
        await provider.complete([], system=None)

        assert oauth_route.call_count == 2

    asyncio.run(scenario())


def test_oauth_auth_error() -> None:
    provider = _provider()

    @respx.mock
    async def scenario() -> None:
        respx.post("https://ngw.devices.sberbank.ru:9443/api/v2/oauth").mock(return_value=httpx.Response(403))
        with pytest.raises(ProviderAuthError):
            await provider.complete([], system=None)

    asyncio.run(scenario())


def test_missing_auth_key_raises_unless_mock() -> None:
    with pytest.raises(ValueError):
        GigaChatProvider(
            auth_key="",
            scope="GIGACHAT_API_PERS",
            oauth_url="https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
            base_url="https://gigachat.devices.sberbank.ru/api/v1",
            model="GigaChat",
            timeout=5.0,
            max_output_tokens=256,
        )
