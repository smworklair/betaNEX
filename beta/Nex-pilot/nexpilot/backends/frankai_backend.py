"""
Backend на базе FrankAI — локальная генерация, без сети и без внешних
API-ключей. Это backend по умолчанию для Nex-pilot.
"""

from __future__ import annotations

import asyncio

from frankai import FrankAI

from nexpilot.backends.base import Backend


class FrankAIBackend(Backend):
    name = "frankai"

    def __init__(self, engine: FrankAI, max_new_tokens: int = 200) -> None:
        self._engine = engine
        self._max_new_tokens = max_new_tokens

    async def generate(self, prompt: str) -> str:
        # FrankAI.generate — синхронный CPU-bound код (чистый NumPy, без
        # I/O). Если вызвать его напрямую внутри async-функции, он
        # заблокирует весь event loop на всё время генерации — другие
        # корутины (например, параллельные запросы) не смогут выполняться,
        # пока генерация не закончится. asyncio.to_thread уводит вызов в
        # отдельный поток, событийный цикл продолжает работать. Тот же
        # класс задачи решает ai-gateway, только там источник блокировки —
        # ожидание сети, а не вычисления на CPU.
        return await asyncio.to_thread(
            self._engine.generate, prompt, max_new_tokens=self._max_new_tokens
        )
