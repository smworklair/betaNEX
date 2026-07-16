"""
Юнит-тесты InMemoryResponseCache: попадание/промах, TTL, эвикция при
переполнении. Без pytest-asyncio — как и в test_budget_service.py, тесты
обычные (def), сами управляют event loop через asyncio.run().

RedisResponseCache (тот же контракт через общий Redis/Valkey) покрыт
отдельно в test_redis_backends.py.
"""

from __future__ import annotations

import asyncio

from app.core.response_cache import CachedResponse, InMemoryResponseCache
from app.providers.base import Usage


def _response(text: str = "ответ") -> CachedResponse:
    return CachedResponse(text=text, usage=Usage(prompt_tokens=1, completion_tokens=2), provider="gemini", model="m")


def test_miss_on_empty_cache() -> None:
    cache = InMemoryResponseCache()

    async def scenario() -> None:
        assert await cache.get("k1") is None

    asyncio.run(scenario())


def test_set_then_get_hits() -> None:
    cache = InMemoryResponseCache()
    value = _response("привет")

    async def scenario() -> None:
        await cache.set("k1", value, ttl_seconds=60)
        got = await cache.get("k1")
        assert got == value

    asyncio.run(scenario())


def test_entry_expires_after_ttl() -> None:
    cache = InMemoryResponseCache()

    async def scenario() -> None:
        await cache.set("k1", _response(), ttl_seconds=0.05)
        assert await cache.get("k1") is not None
        await asyncio.sleep(0.1)
        assert await cache.get("k1") is None

    asyncio.run(scenario())


def test_overwriting_key_updates_value() -> None:
    cache = InMemoryResponseCache()

    async def scenario() -> None:
        await cache.set("k1", _response("старый"), ttl_seconds=60)
        await cache.set("k1", _response("новый"), ttl_seconds=60)
        got = await cache.get("k1")
        assert got is not None
        assert got.text == "новый"

    asyncio.run(scenario())


def test_eviction_drops_oldest_entry_when_full() -> None:
    cache = InMemoryResponseCache(max_entries=2)

    async def scenario() -> None:
        await cache.set("k1", _response("первый"), ttl_seconds=60)
        await cache.set("k2", _response("второй"), ttl_seconds=60)
        await cache.set("k3", _response("третий"), ttl_seconds=60)  # переполнение — вытесняет k1

        assert await cache.get("k1") is None
        assert (await cache.get("k2")) is not None
        assert (await cache.get("k3")) is not None

    asyncio.run(scenario())
