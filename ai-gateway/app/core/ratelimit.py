"""
Rate-limit запросов: абстракция + in-memory реализация по умолчанию.

Та же граница и тот же приём, что у core/budget_store.py (см. шапку
того файла) — при нескольких инстансах ai-gateway за балансировщиком
(или `uvicorn --workers N`, несколько ОС-процессов) счётчик в памяти
процесса НЕ общий: лимит станет "мягче" в N раз, потому что каждый
процесс считает попадания отдельно. Прод-реализация — Redis (INCR на
ключ "{key}:{window}" + EXPIRE, или sliding-window через Lua-скрипт);
ей достаточно реализовать протокол RateLimiter ниже, ничего в вызывающем
коде (app/deps.py) менять не придётся.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from collections import defaultdict, deque


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
    Прод-реализация для нескольких инстансов — НЕ реализована здесь
    (учебный сервис, см. app/README.md про границы проекта), но
    протокол уже готов принять её без изменений в app/deps.py/app/main.py:

        limiter: RateLimiter = RedisRateLimiter(redis_client, limit_per_minute=...)
        app.state.rate_limiter = limiter

    Набросок реализации (INCR + EXPIRE, тот же fixed-window, что и у
    InMemoryRateLimiter, но через общий Redis):

        async def allow(self, key: str) -> bool:
            window = int(time.time() // 60)
            redis_key = f"ratelimit:{key}:{window}"
            count = await self._redis.incr(redis_key)
            if count == 1:
                await self._redis.expire(redis_key, 60)
            return count <= self._limit

    Требует зависимости `redis` (redis.asyncio) — намеренно не добавлена
    в requirements.txt, пока не появится реальный Redis/Valkey в стеке
    (тот же принцип, что и у Go-плана NEX, docs/architecture-go.md, §7:
    "Valkey только когда появится вторая реплика").
    """

    def __init__(self, *_args: object, **_kwargs: object) -> None:
        raise NotImplementedError(
            "RedisRateLimiter — заготовка под будущий multi-instance деплой, "
            "см. docstring класса. Пока используйте InMemoryRateLimiter."
        )

    async def allow(self, key: str) -> bool:  # pragma: no cover - недостижимо, __init__ уже поднял исключение
        raise NotImplementedError
