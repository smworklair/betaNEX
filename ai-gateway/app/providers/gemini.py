"""
Клиент к Google Gemini API (generativelanguage).

Это прямой бэкендовый аналог web/src/llm.ts:askGemini() из фронтенд-
прототипа NEX — тот же HTTP-контракт (тот же URL, то же тело запроса),
но теперь вызывается с сервера, а не из браузера. Ключ живёт в
переменной окружения процесса, а не в localStorage клиента — это и есть
тот шаг "AI на бэкенд", который в docs/ai/README.md описан как план для
Go-версии. Здесь — тот же принцип, на Python, для практики.
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


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(
        self, *, api_key: str, model: str, base_url: str, timeout: float, max_output_tokens: int
    ) -> None:
        if not api_key:
            # Проверяем сразу при создании, а не при первом запросе —
            # ошибка конфигурации должна быть видна на старте сервиса,
            # а не всплывать посреди обработки чьего-то вопроса.
            raise ValueError("GEMINI_API_KEY не задан")
        self._api_key = api_key
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._max_output_tokens = max_output_tokens

    def _payload(self, messages: list[ChatMessage], system: str | None) -> dict:
        # Gemini называет роль ассистента "model", а не "assistant".
        contents = [
            {"role": "model" if m.role == "assistant" else "user", "parts": [{"text": m.content}]}
            for m in messages
        ]
        payload: dict = {
            "contents": contents,
            "generationConfig": {
                "temperature": 0.75,
                "topP": 0.95,
                "maxOutputTokens": self._max_output_tokens,
            },
        }
        if system:
            payload["systemInstruction"] = {"parts": [{"text": system}]}
        return payload

    async def complete(
        self, messages: list[ChatMessage], system: str | None = None
    ) -> CompletionResult:
        url = f"{self._base_url}/models/{self._model}:generateContent"
        headers = {"Content-Type": "application/json", "x-goog-api-key": self._api_key}

        async def _do_request() -> httpx.Response:
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.post(url, headers=headers, json=self._payload(messages, system))
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
        candidates = data.get("candidates") or []
        if not candidates:
            raise ProviderEmptyResponseError(self.name)
        parts = candidates[0].get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts).strip()
        if not text:
            raise ProviderEmptyResponseError(self.name)

        usage_meta = data.get("usageMetadata", {})
        usage = Usage(
            prompt_tokens=usage_meta.get("promptTokenCount", 0),
            completion_tokens=usage_meta.get("candidatesTokenCount", 0),
        )
        return CompletionResult(text=text, usage=usage, provider=self.name, model=self._model)

    async def stream(
        self, messages: list[ChatMessage], system: str | None = None
    ) -> AsyncIterator[StreamChunk]:
        # alt=sse переключает Gemini на Server-Sent Events вместо одного
        # большого JSON-ответа — так же, как планируется для /api/v1/ai/...
        # в Go-версии (docs/ai/README.md, §2.6).
        url = f"{self._base_url}/models/{self._model}:streamGenerateContent"
        params = {"alt": "sse"}
        headers = {"Content-Type": "application/json", "x-goog-api-key": self._api_key}

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                async with client.stream(
                    "POST", url, params=params, headers=headers, json=self._payload(messages, system)
                ) as resp:
                    if resp.status_code in (401, 403):
                        raise ProviderAuthError(self.name)
                    if resp.status_code >= 400:
                        body = await resp.aread()
                        raise ProviderHTTPError(
                            self.name, resp.status_code, body.decode(errors="ignore")[:500]
                        )

                    prompt_tokens = 0
                    completion_tokens = 0
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        raw = line[len("data:") :].strip()
                        if not raw:
                            continue
                        chunk = json.loads(raw)
                        candidates = chunk.get("candidates") or []
                        if candidates:
                            parts = candidates[0].get("content", {}).get("parts", [])
                            delta = "".join(p.get("text", "") for p in parts)
                            if delta:
                                yield StreamChunk(delta=delta)
                        usage_meta = chunk.get("usageMetadata")
                        if usage_meta:
                            prompt_tokens = usage_meta.get("promptTokenCount", prompt_tokens)
                            completion_tokens = usage_meta.get("candidatesTokenCount", completion_tokens)
                    yield StreamChunk(usage=Usage(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens))
        except httpx.TimeoutException as exc:
            raise ProviderTimeoutError(self.name) from exc
