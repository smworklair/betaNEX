"""
Простой rate-limit для учебных целей: fixed-window счётчик запросов в
памяти процесса, ключ — IP клиента.

ВАЖНО (учебная пометка, не продакшен-решение): при нескольких
инстансах сервиса за балансировщиком у каждого будет свой счётчик —
общий лимит станет "мягче" в N раз, потому что состояние не разделяется
между процессами. В проде для этого нужен общий стор (Redis и т.п.) —
так же, как Go-план NEX переносит in-process кэш на Valkey только когда
появляется вторая реплика (docs/architecture-go.md, §7). Для одного
процесса на локальной машине in-memory счётчика достаточно, чтобы
прочувствовать сам механизм ограничения нагрузки.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque


class FixedWindowRateLimiter:
    def __init__(self, limit_per_minute: int) -> None:
        self._limit = limit_per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
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
