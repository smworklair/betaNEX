"""Pydantic-схемы запросов и ответов — контракт HTTP API сервиса."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

ProviderName = Literal["gemini", "custom", "openai", "deepseek", "qwen", "kimi", "gigachat", "yandexgpt"]


class ChatMessageIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=8000)


class PageContext(BaseModel):
    """
    Контекст страницы фронтенда — откуда открыт мини-чат.

    Вместо того чтобы фронтенд сам собирал текст системного промпта
    (как раньше делал `web/src/ai.tsx`, подставляя "Контекст: ..." прямо
    в текст вопроса), он присылает СТРУКТУРУ: идентификатор раздела
    (`page`) и короткие факты о текущем состоянии экрана (`facts`).
    Сервер (см. app/core/context_registry.py) сам превращает `page` в
    ролевую инструкцию ("ты — финансовый аналитик колледжа" и т.п.), а
    `facts`/`state` подмешивает как актуальные данные. Разделение важно:
    роль ассистента — часть системного промпта (доверенная), а факты со
    страницы — обычные данные, не инструкция (см. docs/ai/README.md,
    §3 "разделение системной инструкции и данных").
    """

    page: str = Field(..., min_length=1, max_length=64, description="Идентификатор раздела, напр. 'finance'")
    title: str | None = Field(default=None, max_length=200, description="Человекочитаемое имя раздела/экрана")
    facts: list[str] = Field(
        default_factory=list,
        max_length=50,
        description="Короткие факты о текущем состоянии экрана (KPI, фильтры и т.п.)",
    )
    state: str | None = Field(default=None, max_length=2000, description="Свободное краткое описание состояния экрана")

    @field_validator("facts")
    @classmethod
    def _facts_items_bounded(cls, items: list[str]) -> list[str]:
        # Field(max_length=...) на list[str] ограничивает число элементов,
        # но не длину каждого — без этого один элемент мог бы быть сколь
        # угодно большим (тот же обход лимита, что и до этой проверки).
        for item in items:
            if len(item) > 500:
                raise ValueError("каждый факт не длиннее 500 символов")
        return items


class AskRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000, description="Вопрос пользователя")
    history: list[ChatMessageIn] = Field(
        default_factory=list,
        max_length=50,
        description="Предыдущие сообщения диалога, старые → новые",
    )
    system: str | None = Field(
        default=None,
        max_length=20000,
        description="Полностью переопределить системный промпт (используется главным чатом NEX; "
        "для мини-чатов на страницах предпочтителен `context`, а не эта опция). Доступно только "
        "аутентифицированным вызовам через nexd-прокси — см. internal/platform/httpapi/aiproxy.go.",
    )
    context: PageContext | None = Field(
        default=None, description="Контекст страницы — превращается в системный промпт на сервере"
    )
    provider: ProviderName | None = Field(
        default=None, description="Какой провайдер использовать; если не задан — берётся из конфига"
    )


class UsageOut(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class AskResponse(BaseModel):
    text: str
    provider: str
    model: str
    usage: UsageOut


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


class ProvidersResponse(BaseModel):
    providers: list[str]
    default: str
