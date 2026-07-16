"""
Тесты InMemoryRateLimiter (app/core/ratelimit.py) — единственная
реализация RateLimiter, реально используемая сегодня; RedisRateLimiter —
заготовка под будущий multi-instance деплой (см. её docstring), которую
здесь тестировать нечего — она сознательно поднимает NotImplementedError.
"""

from __future__ import annotations

import asyncio

from app.core.ratelimit import InMemoryRateLimiter


def test_allows_up_to_limit_then_blocks() -> None:
    async def scenario() -> None:
        limiter = InMemoryRateLimiter(limit_per_minute=3)
        for _ in range(3):
            assert await limiter.allow("k1") is True
        assert await limiter.allow("k1") is False

    asyncio.run(scenario())


def test_keys_are_independent() -> None:
    async def scenario() -> None:
        limiter = InMemoryRateLimiter(limit_per_minute=1)
        assert await limiter.allow("a") is True
        assert await limiter.allow("b") is True
        assert await limiter.allow("a") is False
        assert await limiter.allow("b") is False

    asyncio.run(scenario())
