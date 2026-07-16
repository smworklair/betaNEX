"""
Тесты RedisRateLimiter и RedisResponseCache — тот же алгоритм, что и у
in-memory реализаций (см. test_ratelimit.py/test_response_cache.py), но
через настоящий Redis/Valkey (мокать протокол Redis ради этих тестов
менее ценно, чем один раз проверить его вживую).

Требуют доступный сервер по REDIS_URL (по умолчанию
redis://localhost:6379/0, см. ai-gateway/.env.example). Если сервера нет
(например, в CI — там Redis не поднимается специально ради этого модуля,
см. ../.github/workflows/ci.yml) — модуль пропускается целиком, а не
падает: Redis — опциональный backend (см. app/config.py:
Settings.cache_backend), а не обязательная часть сервиса.
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest

from app.core.ratelimit import RedisRateLimiter
from app.core.response_cache import CachedResponse, RedisResponseCache
from app.providers.base import Usage

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")


def _redis_available() -> bool:
    from redis.asyncio import Redis

    async def ping() -> bool:
        client = Redis.from_url(REDIS_URL, socket_connect_timeout=0.5)
        try:
            await client.ping()
        except Exception:  # noqa: BLE001 — доступность сервера, а не конкретная ошибка, важна здесь
            return False
        else:
            return True
        finally:
            await client.aclose()

    return asyncio.run(ping())


pytestmark = pytest.mark.skipif(not _redis_available(), reason=f"Redis недоступен по {REDIS_URL}")


def _key() -> str:
    # Уникальный ключ на тест — тесты не мешают друг другу и повторным
    # прогонам против одного и того же долгоживущего сервера.
    return f"test:{uuid.uuid4()}"


def test_redis_rate_limiter_allows_up_to_limit_then_blocks() -> None:
    from redis.asyncio import Redis

    async def scenario() -> None:
        client = Redis.from_url(REDIS_URL)
        try:
            limiter = RedisRateLimiter(client, limit_per_minute=3)
            key = _key()
            for _ in range(3):
                assert await limiter.allow(key) is True
            assert await limiter.allow(key) is False
        finally:
            await client.aclose()

    asyncio.run(scenario())


def test_redis_rate_limiter_keys_are_independent() -> None:
    from redis.asyncio import Redis

    async def scenario() -> None:
        client = Redis.from_url(REDIS_URL)
        try:
            limiter = RedisRateLimiter(client, limit_per_minute=1)
            key_a, key_b = _key(), _key()
            assert await limiter.allow(key_a) is True
            assert await limiter.allow(key_b) is True
            assert await limiter.allow(key_a) is False
            assert await limiter.allow(key_b) is False
        finally:
            await client.aclose()

    asyncio.run(scenario())


def test_redis_response_cache_miss_then_set_then_hit() -> None:
    from redis.asyncio import Redis

    async def scenario() -> None:
        client = Redis.from_url(REDIS_URL)
        try:
            cache = RedisResponseCache(client)
            key = _key()
            value = CachedResponse(
                text="привет", usage=Usage(prompt_tokens=1, completion_tokens=2), provider="gemini", model="m"
            )

            assert await cache.get(key) is None
            await cache.set(key, value, ttl_seconds=30)
            got = await cache.get(key)
            assert got == value
        finally:
            await client.aclose()

    asyncio.run(scenario())


def test_redis_response_cache_entry_expires_after_ttl() -> None:
    from redis.asyncio import Redis

    async def scenario() -> None:
        client = Redis.from_url(REDIS_URL)
        try:
            cache = RedisResponseCache(client)
            key = _key()
            value = CachedResponse(text="x", usage=Usage(), provider="p", model="m")

            await cache.set(key, value, ttl_seconds=1)
            assert await cache.get(key) is not None
            await asyncio.sleep(1.3)
            assert await cache.get(key) is None
        finally:
            await client.aclose()

    asyncio.run(scenario())
