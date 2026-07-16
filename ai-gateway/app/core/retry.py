"""
Retry с экспоненциальной задержкой — для транзиентных сбоев сети между
gateway и провайдером (таймаут, HTTP 5xx). Ошибки конфигурации (401/403,
4xx) НЕ ретраятся — повторный запрос с тем же неверным ключом никогда не
станет успешным, только зря потратит время и бюджет тенанта.

Используется всеми провайдерами (openai_compat, gemini, gigachat,
yandexgpt) вокруг одного HTTP-вызова — не вокруг всего стрима, потому что
для потока повторить можно только "запрос ещё не начал отдавать чанки",
а не "часть текста уже ушла клиенту".
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import TypeVar

from app.providers.exceptions import ProviderHTTPError, ProviderTimeoutError

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Ошибки, при которых имеет смысл повторить попытку: сетевой таймаут и
# 5xx (проблема на стороне провайдера, а не в нашем запросе).
_RETRYABLE = (ProviderTimeoutError,)


def _is_retryable(exc: Exception) -> bool:
    if isinstance(exc, _RETRYABLE):
        return True
    if isinstance(exc, ProviderHTTPError) and exc.status_code >= 500:
        return True
    return False


async def with_retries(
    fn: Callable[[], Awaitable[T]],
    *,
    attempts: int = 3,
    base_delay: float = 0.5,
) -> T:
    """
    Вызывает fn() до attempts раз с задержкой base_delay * 2**попытка
    между повторами. Последняя неудача пробрасывается как есть — вызывающий
    код (ai_service.py) уже умеет превращать ProviderError в HTTP-ответ.
    """
    last_exc: Exception | None = None
    for attempt in range(attempts):
        try:
            return await fn()
        except Exception as exc:  # noqa: BLE001 — решаем ретраить ли ниже, по типу
            if not _is_retryable(exc) or attempt == attempts - 1:
                raise
            delay = base_delay * (2**attempt)
            logger.warning(
                "retry %d/%d после %s: %s (пауза %.1fs)", attempt + 1, attempts, type(exc).__name__, exc, delay
            )
            last_exc = exc
            await asyncio.sleep(delay)
    # Недостижимо: цикл либо возвращает результат, либо пробрасывает
    # исключение на последней попытке.
    assert last_exc is not None
    raise last_exc
