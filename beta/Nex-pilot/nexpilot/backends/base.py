"""
Единый интерфейс backend'а генерации для Nex-pilot.

Тот же приём, что и LLMProvider в ai-gateway
(../../ai-gateway/app/providers/base.py) и Engine в FrankAI
(../../FrankAI/frankai/engine.py): верхний слой (assistant.py) не
должен знать, вызывает ли он локальную модель FrankAI или удалённый
HTTP-сервис (ai-gateway). Добавление нового backend'а — новый файл
здесь, без изменений в assistant.py или cli.py.

Метод асинхронный (async def), даже для FrankAI, у которого внутри нет
никакого сетевого I/O — так оба backend'а (локальный и HTTP) имеют
ОДИНАКОВУЮ сигнатуру, и NexPilot может работать с любым из них, не
зная, какой перед ним.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class Backend(ABC):
    name: str

    @abstractmethod
    async def generate(self, prompt: str) -> str: ...
