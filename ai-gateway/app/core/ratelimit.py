"""
Rate-limit запросов: абстракция + in-memory реализация по умолчанию,
плюс Redis-реализация для нескольких инстансов (см. RedisRateLimiter).

Та же граница и тот же приём, что у core/budget_store.py (см. шапку
того файла) — при нескольких инстансах ai-gateway за балансировщиком
(или `uvicorn --workers N`, несколько ОС-процессов) счётчик InMemoryRateLimiter
НЕ общий: лимит станет "мягче" в N раз, потому что каждый процесс считает
попадания отдельно. RedisRateLimiter снимает это ограничение, разделяя
счётчик через общий Redis/Valkey (см. app/main.py: включается конфигом
CACHE_BACKEND=redis, см. app/config.py).
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from collections import defaultdict, deque
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from redis.asyncio import Redis


class RateLimiter(ABC):
    @abstractmethod
    async def allow(self, key: str) -> bool:
        """True, если очередное событие для key укладывается в лимит."""


class InMemoryRateLimiter(RateLimiter):
    """Fixed-window счётчик в памяти процесса — см. границы в шапке файла."""

    def __init__(self, limit_per_minute: int) -> None:
        self._limit = limit_per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    async def allow(self, key: str) -> bool:
        """True, если запрос укладывается в лимит; попутно чистит старые метки."""
        now = time.monotonic()
        window_start = now - 60.0
        hits = self._hits[key]
        while hits and hits[0] < window_start:
            hits.popleft()
        if len(hits) >= self._limit:
            return False
        hits.append(now)
        return True


class RedisRateLimiter(RateLimiter):
    """
    Fixed-window счётчик через общий Redis/Valkey — тот же алгоритм, что
    и у InMemoryRateLimiter (окно в 60 секунд), но счётчик один на все
    инстансы ai-gateway, а не по одному на процесс.

    INCR + EXPIRE, а не Lua-скрипт для атомарности: гонка возможна только
    в первую миллисекунду нового окна (несколько параллельных запросов
    видят count==1 и все шлют EXPIRE) — EXPIRE идемпотентен (просто
    переустанавливает тот же TTL), поэтому лишний вызов не портит
    корректность, а Lua усложнил бы код ради выгоды, которая здесь не нужна.
    """

    def __init__(self, redis_client: Redis, limit_per_minute: int) -> None:
        self._redis = redis_client
        self._limit = limit_per_minute

    async def allow(self, key: str) -> bool:
        window = int(time.time() // 60)
        redis_key = f"ratelimit:{key}:{window}"
        count = await self._redis.incr(redis_key)
        if count == 1:
            await self._redis.expire(redis_key, 60)
        return count <= self._limit
