"""
Клиент к GigaChat (Сбер) — https://developers.sber.ru/docs/ru/gigachat/api/overview

В отличие от OpenAI-совместимых провайдеров, у GigaChat СВОЙ контракт
авторизации и своя PKI:

1. OAuth2 client credentials: POST {oauth_url} с Basic-заголовком
   Authorization ("Authorization key" — уже base64(client_id:client_secret),
   выдаётся в личном кабинете GigaChat API целиком, поэтому здесь не
   собирается вручную) и телом `scope=<GIGACHAT_API_PERS|CORP|B2B>`.
   Обязателен заголовок RqUID (уникальный per-request UUID). В ответ —
   access_token и expires_at (unix-время в миллисекундах) — токен кэшируется
   в памяти процесса и переиспользуется, пока не истёк.
2. POST {base_url}/chat/completions с Bearer-токеном — тело в духе OpenAI
   (messages/model/temperature), но модель называется "GigaChat"/"GigaChat-Pro".

Сертификаты: сервисы Сбера используют цепочку НУЦ Минцифры России, которой
обычно нет в системном доверенном хранилище — стандартный httpx-клиент с
verify=True (по умолчанию) отклонит TLS-соединение с ошибкой self-signed
certificate. Правильное решение — импортировать корневой сертификат НУЦ
(публикуется на Госуслугах) и передать его путь через GIGACHAT_CA_BUNDLE.
Если путь не задан, используем verify=GIGACHAT_INSECURE_SKIP_VERIFY (по
умолчанию False — тогда без бандла провайдер просто не сможет подключиться,
и это будет явная, а не тихая проблема).

⚠️ Живьём из этой среды (без реальных клиентских credentials и сети до
ngw.devices.sberbank.ru) API не проверялось — контракт реализован строго
по официальной документации. Для локальной разработки/тестов без реальных
credentials есть режим GIGACHAT_MOCK=true (см. _mock_complete) — он
имитирует успешный ответ без единого сетевого вызова.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator

import httpx

from app.core.retry import with_retries
from app.providers.base import ChatMessage, CompletionResult, LLMProvider, StreamChunk, Usage
from app.providers.exceptions import (
    ProviderAuthError,
    ProviderEmptyResponseError,
    ProviderHTTPError,
    ProviderTimeoutError,
)

logger = logging.getLogger(__name__)

_MOCK_REPLY = (
    "[GIGACHAT_MOCK] Это заглушка ответа GigaChat — реальный API не вызывался. "
    "Отключите GIGACHAT_MOCK, чтобы ходить в настоящий сервис."
)


class GigaChatProvider(LLMProvider):
    name = "gigachat"

    def __init__(
        self,
        *,
        auth_key: str,
        scope: str,
        oauth_url: str,
        base_url: str,
        model: str,
        timeout: float,
        max_output_tokens: int,
        ca_bundle: str | None = None,
        insecure_skip_verify: bool = False,
        mock: bool = False,
    ) -> None:
        if not auth_key and not mock:
            raise ValueError("GIGACHAT_AUTH_KEY не задан")
        self._auth_key = auth_key
        self._scope = scope
        self._oauth_url = oauth_url.rstrip("/")
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout
        self._max_output_tokens = max_output_tokens
        self._mock = mock
        # verify: путь к PEM с корнем НУЦ Минцифры, либо False (небезопасно,
        # только для дев-стенда), либо True (сработает, только если сертификат
        # уже добавлен в системное доверенное хранилище ОС).
        self._verify: bool | str = ca_bundle or (not insecure_skip_verify)
        self._token: str | None = None
        self._token_expires_at: float = 0.0

    def _messages_payload(self, messages: list[ChatMessage], system: str | None) -> list[dict]:
        payload: list[dict] = []
        if system:
            payload.append({"role": "system", "content": system})
        payload.extend({"role": m.role, "content": m.content} for m in messages)
        return payload

    async def _fetch_token(self) -> str:
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "RqUID": str(uuid.uuid4()),
            "Authorization": f"Basic {self._auth_key}",
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout, verify=self._verify) as client:
                resp = await client.post(self._oauth_url, headers=headers, data={"scope": self._scope})
        except httpx.TimeoutException as exc:
            raise ProviderTimeoutError(self.name) from exc
        except httpx.HTTPError as exc:
            raise ProviderHTTPError(self.name, 0, str(exc)) from exc

        if resp.status_code in (401, 403):
            raise ProviderAuthError(self.name)
        if resp.status_code >= 400:
            raise ProviderHTTPError(self.name, resp.status_code, resp.text[:500])

        data = resp.json()
        # expires_at у GigaChat — unix-время в МИЛЛИСЕКУНДАХ, а не секундах.
        self._token = data["access_token"]
        self._token_expires_at = data["expires_at"] / 1000.0
        return self._token

    async def _get_token(self) -> str:
        # 60-секундный запас, чтобы не отправить запрос токеном, который
        # истечёт на пути до сервера.
        if self._token and time.time() < self._token_expires_at - 60:
            return self._token
        return await with_retries(self._fetch_token)

    async def complete(
        self, messages: list[ChatMessage], system: str | None = None
    ) -> CompletionResult:
        if self._mock:
            return self._mock_complete(messages)

        token = await self._get_token()
        url = f"{self._base_url}/chat/completions"
        body = {
            "model": self._model,
            "messages": self._messages_payload(messages, system),
            "temperature": 0.75,
            "max_tokens": self._max_output_tokens,
        }

        async def _do_request() -> httpx.Response:
            headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
            try:
                async with httpx.AsyncClient(timeout=self._timeout, verify=self._verify) as client:
                    resp = await client.post(url, headers=headers, json=body)
            except httpx.TimeoutException as exc:
                raise ProviderTimeoutError(self.name) from exc
            except httpx.HTTPError as exc:
                raise ProviderHTTPError(self.name, 0, str(exc)) from exc
            if resp.status_code in (401, 403):
                raise ProviderAuthError(self.name)
            if resp.status_code >= 400:
                raise ProviderHTTPError(self.name, resp.status_code, resp.text[:500])
            return resp

        resp = await with_retries(_do_request)
        data = resp.json()
        choices = data.get("choices") or []
        text = (choices[0].get("message", {}).get("content") if choices else "") or ""
        text = text.strip()
        if not text:
            raise ProviderEmptyResponseError(self.name)

        usage_raw = data.get("usage", {})
        usage = Usage(
            prompt_tokens=usage_raw.get("prompt_tokens", 0),
            completion_tokens=usage_raw.get("completion_tokens", 0),
        )
        return CompletionResult(text=text, usage=usage, provider=self.name, model=self._model)

    def _mock_complete(self, messages: list[ChatMessage]) -> CompletionResult:
        logger.info("gigachat mock: %d сообщений в истории, сеть не используется", len(messages))
        usage = Usage(prompt_tokens=sum(len(m.content) for m in messages) // 4, completion_tokens=len(_MOCK_REPLY) // 4)
        return CompletionResult(text=_MOCK_REPLY, usage=usage, provider=self.name, model=self._model)

    async def stream(
        self, messages: list[ChatMessage], system: str | None = None
    ) -> AsyncIterator[StreamChunk]:
        if self._mock:
            result = self._mock_complete(messages)
            yield StreamChunk(delta=result.text)
            yield StreamChunk(usage=result.usage)
            return

        token = await self._get_token()
        url = f"{self._base_url}/chat/completions"
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
        body = {
            "model": self._model,
            "messages": self._messages_payload(messages, system),
            "temperature": 0.75,
            "max_tokens": self._max_output_tokens,
            "stream": True,
        }

        # GigaChat стримит в том же формате SSE, что и OpenAI (event data: {...}).
        try:
            async with httpx.AsyncClient(timeout=self._timeout, verify=self._verify) as client:
                async with client.stream("POST", url, headers=headers, json=body) as resp:
                    if resp.status_code in (401, 403):
                        raise ProviderAuthError(self.name)
                    if resp.status_code >= 400:
                        raw = await resp.aread()
                        raise ProviderHTTPError(
                            self.name, resp.status_code, raw.decode(errors="ignore")[:500]
                        )

                    import json as _json

                    prompt_tokens = 0
                    completion_tokens = 0
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        raw_line = line[len("data:") :].strip()
                        if not raw_line or raw_line == "[DONE]":
                            continue
                        chunk = _json.loads(raw_line)
                        choices = chunk.get("choices") or []
                        if choices:
                            delta = choices[0].get("delta", {}).get("content")
                            if delta:
                                yield StreamChunk(delta=delta)
                        usage_raw = chunk.get("usage")
                        if usage_raw:
                            prompt_tokens = usage_raw.get("prompt_tokens", prompt_tokens)
                            completion_tokens = usage_raw.get("completion_tokens", completion_tokens)
                    yield StreamChunk(usage=Usage(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens))
        except httpx.TimeoutException as exc:
            raise ProviderTimeoutError(self.name) from exc
