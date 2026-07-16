"""
Единый интерфейс провайдера LLM (порт в терминах гексагональной
архитектуры).

Зачем нужен этот слой: сервис (app/services/ai_service.py) и роутер
(app/api/routes.py) не должны знать НИЧЕГО о деталях конкретного API
(Gemini, OpenAI-совместимый или следующий, который вы добавите). Они
работают только с этим протоколом — значит, добавление нового
провайдера не требует трогать ни сервис, ни роутер, только реализовать
LLMProvider в новом файле. Тот же приём есть в Go-части NEX: "интерфейс
объявляет потребитель, а не поставщик" (docs/go-guide.md, §1).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal

Role = Literal["user", "assistant"]


@dataclass(slots=True, frozen=True)
class ChatMessage:
    role: Role
    content: str


@dataclass(slots=True, frozen=True)
class Usage:
    """Статистика по токенам — без неё нет ни оценки стоимости, ни бюджетов."""

    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


@dataclass(slots=True, frozen=True)
class CompletionResult:
    text: str
    usage: Usage
    provider: str
    model: str


@dataclass(slots=True, frozen=True)
class StreamChunk:
    """
    Один кусок потокового ответа.

    delta — очередной фрагмент текста (в служебных чанках может
    отсутствовать); usage заполняется только в финальном чанке, когда
    провайдер прислал итоговую статистику по токенам.
    """

    delta: str | None = None
    usage: Usage | None = None


class LLMProvider(ABC):
    """Контракт, которому должен соответствовать любой провайдер."""

    name: str

    @abstractmethod
    async def complete(
        self, messages: list[ChatMessage], system: str | None = None
    ) -> CompletionResult:
        """Обычный (не потоковый) запрос — дождаться полного ответа и вернуть его."""

    @abstractmethod
    def stream(
        self, messages: list[ChatMessage], system: str | None = None
    ) -> AsyncIterator[StreamChunk]:
        """Потоковый запрос — асинхронный генератор кусков ответа."""
