"""
Кэш ответов LLM: (tenant, provider, system, messages) → готовый ответ, с
TTL. Экономит и токены (не платим провайдеру повторно за один и тот же
вопрос), и задержку (кэш-хит отвечает мгновенно, без сетевого вызова).

Изоляция по тенантам ОБЯЗАТЕЛЬНА: ключ кэша всегда включает tenant_id
(см. AIService._cache_key в app/services/ai_service.py) — иначе тенант A
мог бы получить ответ, сгенерированный для промпта тенанта B, включая
любые чувствительные данные, случайно попавшие в тот промпт. Тот же
принцип "не смешивать данные разных тенантов в одном контексте", что и
в docs/ai/README.md, §3 ("lethal trifecta").

Абстракция + in-memory реализация — тот же приём, что у
core/budget_store.py и core/ratelimit.py (см. их докстринги): для
учебных целей памяти процесса достаточно, но у неё та же граница —
несколько инстансов/воркеров ai-gateway кэш друг с другом не разделяют
(и, в отличие от бюджета, это не проблема корректности — просто кэш
получится "мягче": каждый воркер кэширует свою копию одних и тех же
ответов). Прод-реализация — Redis (SETEX), см. RedisResponseCache ниже.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from collections import OrderedDict
from dataclasses import dataclass

from app.providers.base import Usage


@dataclass(slots=True, frozen=True)
class CachedResponse:
    """Всё, что нужно, чтобы собрать CompletionResult/StreamChunk без похода к провайдеру."""

    text: str
    usage: Usage
    provider: str
    model: str


class ResponseCache(ABC):
    @abstractmethod
    async def get(self, key: str) -> CachedResponse | None:
        """None — промах: записи не было либо она истекла по TTL."""

    @abstractmethod
    async def set(self, key: str, value: CachedResponse, ttl_seconds: float) -> None:
        """Записать значение; протухает через ttl_seconds от текущего момента."""


class InMemoryResponseCache(ResponseCache):
    """
    In-memory TTL-кэш с ограничением числа записей.

    Эвикция — простой FIFO (выселяем самую старую запись при
    переполнении), не LRU: полноценная LRU-семантика (обновлять позицию
    записи при каждом get) — сложность, не нужная учебному сервису;
    неограниченный же рост памяти — реальный риск для долгоживущего
    dev-процесса, поэтому граница всё-таки есть, просто самая простая.
    """

    def __init__(self, max_entries: int = 1000) -> None:
        self._max_entries = max_entries
        # OrderedDict — вставка новой записи (или её обновление, для
        # чего запись предварительно удаляется) всегда уходит в конец,
        # поэтому popitem(last=False) всегда снимает самую старую.
        self._entries: OrderedDict[str, tuple[float, CachedResponse]] = OrderedDict()

    async def get(self, key: str) -> CachedResponse | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at < time.monotonic():
            del self._entries[key]
            return None
        return value

    async def set(self, key: str, value: CachedResponse, ttl_seconds: float) -> None:
        if key in self._entries:
            del self._entries[key]
        elif len(self._entries) >= self._max_entries:
            self._entries.popitem(last=False)
        self._entries[key] = (time.monotonic() + ttl_seconds, value)


class RedisResponseCache(ResponseCache):
    """
    Прод-реализация для нескольких инстансов — НЕ реализована здесь (тот
    же приём и та же граница, что у RedisRateLimiter в core/ratelimit.py
    и у прод-заметки в core/budget_store.py), но протокол уже готов
    принять её без изменений в AIService/main.py:

        cache: ResponseCache = RedisResponseCache(redis_client)
        app.state.response_cache = cache

    Набросок реализации (SETEX с TTL, значение — JSON):

        async def get(self, key: str) -> CachedResponse | None:
            raw = await self._redis.get(f"llmcache:{key}")
            if raw is None:
                return None
            data = json.loads(raw)
            return CachedResponse(text=data["text"], usage=Usage(**data["usage"]),
                                   provider=data["provider"], model=data["model"])

        async def set(self, key: str, value: CachedResponse, ttl_seconds: float) -> None:
            payload = {"text": value.text, "provider": value.provider, "model": value.model,
                       "usage": {"prompt_tokens": value.usage.prompt_tokens,
                                 "completion_tokens": value.usage.completion_tokens}}
            await self._redis.setex(f"llmcache:{key}", max(1, int(ttl_seconds)), json.dumps(payload))

    Требует зависимости `redis` (redis.asyncio) — намеренно не добавлена
    в requirements.txt, пока не появится реальный Redis/Valkey в стеке
    (тот же принцип, что и у RedisRateLimiter/docs/architecture-go.md,
    §7: "Valkey только когда появится вторая реплика").
    """

    def __init__(self, *_args: object, **_kwargs: object) -> None:
        raise NotImplementedError(
            "RedisResponseCache — заготовка под будущий multi-instance деплой, "
            "см. docstring класса. Пока используйте InMemoryResponseCache."
        )

    async def get(self, key: str) -> CachedResponse | None:  # pragma: no cover - недостижимо
        raise NotImplementedError

    async def set(self, key: str, value: CachedResponse, ttl_seconds: float) -> None:  # pragma: no cover
        raise NotImplementedError
