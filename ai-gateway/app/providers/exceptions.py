"""
Исключения уровня провайдера — единый вид ошибок независимо от того,
какой именно внешний API их вызвал.

Сервисный слой (ai_service.py) ловит только эти типы, а не разбирается
в кодах ошибок каждого конкретного провайдера по отдельности.
"""

from __future__ import annotations


class ProviderError(Exception):
    """Базовая ошибка провайдера LLM."""

    def __init__(self, provider: str, message: str) -> None:
        self.provider = provider
        self.message = message
        super().__init__(f"[{provider}] {message}")


class ProviderAuthError(ProviderError):
    """Провайдер отклонил ключ (401/403) — конфигурация, а не сбой сети."""

    def __init__(self, provider: str) -> None:
        super().__init__(provider, "неверный или отсутствующий API-ключ")


class ProviderTimeoutError(ProviderError):
    """Провайдер не ответил за отведённое время (request_timeout_seconds)."""

    def __init__(self, provider: str) -> None:
        super().__init__(provider, "провайдер не ответил вовремя (timeout)")


class ProviderHTTPError(ProviderError):
    """Провайдер вернул не-2xx HTTP-статус."""

    def __init__(self, provider: str, status_code: int, body: str) -> None:
        self.status_code = status_code
        super().__init__(provider, f"HTTP {status_code}: {body}")


class ProviderEmptyResponseError(ProviderError):
    """Провайдер ответил 200, но без текста — для нас это тоже ошибка."""

    def __init__(self, provider: str) -> None:
        super().__init__(provider, "пустой ответ от модели")
