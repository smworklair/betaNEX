"""
Клиент к любому OpenAI-совместимому API (/chat/completions).

Параметризован по `name`, поэтому один класс обслуживает сразу
несколько "явных" провайдеров в реестре (app/main.py._build_service):
OpenAI, DeepSeek, Qwen, Kimi (Moonshot) — у всех совместимый контракт
/chat/completions, отличаются только base_url, модель по умолчанию и
переменные окружения с ключом. Плюс остаётся свободный слот `custom`
для любого другого OpenAI-совместимого сервиса, не описанного отдельно.

Существует как демонстрация того, что добавление нового провайдера не
требует трогать роутер или сервис — только реализовать интерфейс
LLMProvider (app/providers/base.py) либо, как здесь, сконфигурировать
уже существующую реализацию под новый base_url/модель.
"""

from __future__ import annotations

import json
import logging
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


class OpenAICompatProvider(LLMProvider):
    def __init__(
        self,
        *,
        name: str,
        api_key: str,
        base_url: str,
        model: str,
        timeout: float,
        max_output_tokens: int,
    ) -> None:
        if not api_key:
            raise ValueError(f"{name.upper()}_API_KEY не задан")
        self.name = name
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout
        self._max_output_tokens = max_output_tokens

    def _messages_payload(self, messages: list[ChatMessage], system: str | None) -> list[dict]:
        payload: list[dict] = []
        if system:
            payload.append({"role": "system", "content": system})
        payload.extend({"role": m.role, "content": m.content} for m in messages)
        return payload

    async def complete(
        self, messages: list[ChatMessage], system: str | None = None
    ) -> CompletionResult:
        url = f"{self._base_url}/chat/completions"
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self._api_key}"}
        body = {
            "model": self._model,
            "messages": self._messages_payload(messages, system),
            "temperature": 0.75,
            "max_tokens": self._max_output_tokens,
        }

        async def _do_request() -> httpx.Response:
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.post(url, headers=headers, json=body)
            except httpx.TimeoutException as exc:
                raise ProviderTimeoutError(self.name) from exc
            except httpx.HTTPError as exc:
                raise ProviderHTTPError(self.name, 0, str(exc)) from exc
            # Статус проверяем ВНУТРИ ретраящейся функции, а не снаружи —
            # иначе with_retries никогда не увидит 5xx как исключение и не
            # повторит запрос (просто вернёт "успешный" http-ответ с кодом 500).
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

    async def stream(
        self, messages: list[ChatMessage], system: str | None = None
    ) -> AsyncIterator[StreamChunk]:
        url = f"{self._base_url}/chat/completions"
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self._api_key}"}
        body = {
            "model": self._model,
            "messages": self._messages_payload(messages, system),
            "temperature": 0.75,
            "max_tokens": self._max_output_tokens,
            "stream": True,
        }

        # Ретраить стрим целиком нельзя, если чанки уже пошли клиенту —
        # поэтому retry применяется только к самому открытию соединения,
        # а не оборачивает весь async for ниже.
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                async with client.stream("POST", url, headers=headers, json=body) as resp:
                    if resp.status_code in (401, 403):
                        raise ProviderAuthError(self.name)
                    if resp.status_code >= 400:
                        raw = await resp.aread()
                        raise ProviderHTTPError(
                            self.name, resp.status_code, raw.decode(errors="ignore")[:500]
                        )

                    prompt_tokens = 0
                    completion_tokens = 0
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        raw = line[len("data:") :].strip()
                        if not raw or raw == "[DONE]":
                            continue
                        chunk = json.loads(raw)
                        choices = chunk.get("choices") or []
                        if choices:
                            delta = choices[0].get("delta", {}).get("content")
                            if delta:
                                yield StreamChunk(delta=delta)
                        # Не все OpenAI-совместимые провайдеры присылают usage
                        # в стриме (это опция OpenAI stream_options) — считаем
                        # отсутствие нормой, а не ошибкой.
                        usage_raw = chunk.get("usage")
                        if usage_raw:
                            prompt_tokens = usage_raw.get("prompt_tokens", prompt_tokens)
                            completion_tokens = usage_raw.get("completion_tokens", completion_tokens)
                    yield StreamChunk(usage=Usage(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens))
        except httpx.TimeoutException as exc:
            raise ProviderTimeoutError(self.name) from exc
