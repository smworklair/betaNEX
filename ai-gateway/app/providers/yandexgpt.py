"""
Клиент к YandexGPT (Yandex Cloud Foundation Models) —
https://yandex.cloud/ru/docs/foundation-models/concepts/yandexgpt/models

Контракт целиком отличается от OpenAI-совместимого:

- Авторизация — заголовок Authorization, значение либо `Api-Key <ключ>`
  (статический API-ключ сервисного аккаунта, самый простой вариант для
  сервер-сервер интеграции), либо `Bearer <IAM-токен>` (короткоживущий,
  нужно самостоятельно обновлять раз ~в час — в этом клиенте сознательно
  НЕ реализовано, т.к. это отдельный OAuth-подобный поток через
  Yandex Cloud IAM API; для gateway с одним функциональным ключом Api-Key
  проще и это официально рекомендуемый способ для бэкенд-сервисов).
- Помимо ключа обязателен folder_id — либо заголовком x-folder-id, либо
  как часть modelUri (`gpt://<folder_id>/<model>/latest`); используем
  оба места, как в официальных примерах.
- Роли сообщений — `system`/`user`/`assistant`, но поле с текстом
  называется `text`, а не `content`.
- Usage в ответе — inputTextTokens/completionTokens/totalTokens (строки!
  в API это строковые числа, поэтому приводим через int()).
- Стриминг (`stream: true`) отдаёт newline-delimited JSON, но КАЖДЫЙ
  чанк содержит НАКОПЛЕННЫЙ текст с начала ответа, а не дельту (в отличие
  от OpenAI/Gemini SSE) — здесь это явно учтено: дельта считается как
  разница длины с предыдущим накопленным текстом.

⚠️ Живьём из этой среды (нет реального Api-Key/folder_id и сети до
llm.api.cloud.yandex.net) API не проверялось — контракт реализован строго
по официальной документации. Режим YANDEXGPT_MOCK=true имитирует ответ
без сетевого вызова — для локальной разработки и демонстрации.
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

_MOCK_REPLY = (
    "[YANDEXGPT_MOCK] Это заглушка ответа YandexGPT — реальный API не вызывался. "
    "Отключите YANDEXGPT_MOCK, чтобы ходить в настоящий сервис."
)


class YandexGPTProvider(LLMProvider):
    name = "yandexgpt"

    def __init__(
        self,
        *,
        api_key: str,
        folder_id: str,
        model: str,
        base_url: str,
        timeout: float,
        max_output_tokens: int,
        mock: bool = False,
    ) -> None:
        if (not api_key or not folder_id) and not mock:
            raise ValueError("YANDEXGPT_API_KEY и YANDEXGPT_FOLDER_ID должны быть заданы")
        self._api_key = api_key
        self._folder_id = folder_id
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._max_output_tokens = max_output_tokens
        self._mock = mock

    def _model_uri(self) -> str:
        return f"gpt://{self._folder_id}/{self._model}/latest"

    def _messages_payload(self, messages: list[ChatMessage], system: str | None) -> list[dict]:
        payload: list[dict] = []
        if system:
            payload.append({"role": "system", "text": system})
        payload.extend({"role": m.role, "text": m.content} for m in messages)
        return payload

    def _payload(self, messages: list[ChatMessage], system: str | None, *, stream: bool) -> dict:
        return {
            "modelUri": self._model_uri(),
            "completionOptions": {
                "stream": stream,
                "temperature": 0.75,
                "maxTokens": str(self._max_output_tokens),
            },
            "messages": self._messages_payload(messages, system),
        }

    def _headers(self) -> dict:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Api-Key {self._api_key}",
            "x-folder-id": self._folder_id,
        }

    def _mock_complete(self, messages: list[ChatMessage]) -> CompletionResult:
        logger.info("yandexgpt mock: %d сообщений в истории, сеть не используется", len(messages))
        usage = Usage(prompt_tokens=sum(len(m.content) for m in messages) // 4, completion_tokens=len(_MOCK_REPLY) // 4)
        return CompletionResult(text=_MOCK_REPLY, usage=usage, provider=self.name, model=self._model)

    async def complete(
        self, messages: list[ChatMessage], system: str | None = None
    ) -> CompletionResult:
        if self._mock:
            return self._mock_complete(messages)

        url = f"{self._base_url}/foundationModels/v1/completion"
        body = self._payload(messages, system, stream=False)

        async def _do_request() -> httpx.Response:
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.post(url, headers=self._headers(), json=body)
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
        result = data.get("result", {})
        alternatives = result.get("alternatives") or []
        text = (alternatives[0].get("message", {}).get("text") if alternatives else "") or ""
        text = text.strip()
        if not text:
            raise ProviderEmptyResponseError(self.name)

        usage_raw = result.get("usage", {})
        usage = Usage(
            prompt_tokens=int(usage_raw.get("inputTextTokens", 0)),
            completion_tokens=int(usage_raw.get("completionTokens", 0)),
        )
        return CompletionResult(text=text, usage=usage, provider=self.name, model=self._model)

    async def stream(
        self, messages: list[ChatMessage], system: str | None = None
    ) -> AsyncIterator[StreamChunk]:
        if self._mock:
            result = self._mock_complete(messages)
            yield StreamChunk(delta=result.text)
            yield StreamChunk(usage=result.usage)
            return

        url = f"{self._base_url}/foundationModels/v1/completion"
        body = self._payload(messages, system, stream=True)

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                async with client.stream("POST", url, headers=self._headers(), json=body) as resp:
                    if resp.status_code in (401, 403):
                        raise ProviderAuthError(self.name)
                    if resp.status_code >= 400:
                        raw = await resp.aread()
                        raise ProviderHTTPError(
                            self.name, resp.status_code, raw.decode(errors="ignore")[:500]
                        )

                    prompt_tokens = 0
                    completion_tokens = 0
                    sent_so_far = ""
                    async for line in resp.aiter_lines():
                        raw_line = line.strip()
                        if not raw_line:
                            continue
                        chunk = json.loads(raw_line)
                        result = chunk.get("result", {})
                        alternatives = result.get("alternatives") or []
                        if alternatives:
                            # ВАЖНО: text здесь — это накопленный ответ с
                            # начала генерации, а не дельта (в отличие от
                            # OpenAI/Gemini). Приводим к дельте вручную.
                            full_text = alternatives[0].get("message", {}).get("text", "")
                            if full_text.startswith(sent_so_far):
                                delta = full_text[len(sent_so_far):]
                            else:
                                # Модель прислала текст, не продолжающий
                                # предыдущий чанк, — считаем это новым
                                # полным текстом (защита от рассинхрона).
                                delta = full_text
                            sent_so_far = full_text
                            if delta:
                                yield StreamChunk(delta=delta)
                        usage_raw = result.get("usage")
                        if usage_raw:
                            prompt_tokens = int(usage_raw.get("inputTextTokens", prompt_tokens))
                            completion_tokens = int(usage_raw.get("completionTokens", completion_tokens))
                    yield StreamChunk(usage=Usage(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens))
        except httpx.TimeoutException as exc:
            raise ProviderTimeoutError(self.name) from exc
