"""
Настройка логирования — единый JSON-формат на весь процесс, с
поддержкой сквозного request_id (см. core/request_id.py).

Формат симметричен JSON-логам nexd (internal/platform/logging/logging.go,
slog.NewJSONHandler): один JSON-объект на строку, обязательные поля
time/level/msg, плюс request_id и любые дополнительные атрибуты вызова
(через logging.Logger.info(..., extra={...})) — так лог обеих частей
системы можно смотреть и парсить одним и тем же инструментом (jq,
Loki и т.п.), не переключаясь между текстом и JSON.

Что НЕ должно попадать в лог: содержимое message/history/system (текст
пользователя и промптов — см. запрет в docs/ai/README.md), ключи
провайдеров, секрет X-Gateway-Secret. Существующие вызовы логгера в
проекте и так передают только метаданные (tenant_id, имя провайдера,
маршрут, статус) — это соглашение продолжает действовать и для новых
вызовов.
"""

from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from datetime import UTC, datetime

# Текущий request_id запроса — заполняется RequestIDMiddleware
# (core/request_id.py) на входе в обработку запроса и читается
# _RequestIDFilter ниже при форматировании каждой строки лога, попавшей
# в это окно выполнения (contextvars корректно живут внутри одной
# asyncio-задачи, включая await-точки).
request_id_var: ContextVar[str] = ContextVar("request_id", default="")

# Стандартные атрибуты logging.LogRecord — не дублируем их как "лишние"
# поля при сериализации extra-словаря (см. JSONFormatter.format).
_RESERVED_RECORD_ATTRS = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "message", "taskName", "request_id",
}


class _RequestIDFilter(logging.Filter):
    """Проставляет request_id из contextvar в каждую запись лога."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class JSONFormatter(logging.Formatter):
    """Одна строка JSON на запись лога."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "time": datetime.fromtimestamp(record.created, tz=UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "msg": record.getMessage(),
            "logger": record.name,
        }
        request_id = getattr(record, "request_id", "")
        if request_id:
            payload["request_id"] = request_id
        # Любые дополнительные поля из logger.info(..., extra={...}) —
        # тот же приём, что и у slog.LogAttrs в Go: структурные пары
        # ключ-значение вместо форматирования их в текст сообщения.
        for key, value in record.__dict__.items():
            if key not in _RESERVED_RECORD_ATTRS and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def setup_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JSONFormatter())
    handler.addFilter(_RequestIDFilter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())

    # uvicorn настраивает логгеры "uvicorn"/"uvicorn.error"/"uvicorn.access"
    # своими хендлерами независимо от root (см. uvicorn.config.LOGGING_CONFIG) —
    # без этого шага стартовые строки uvicorn ("Application startup
    # complete" и т.п.) остались бы в его собственном текстовом формате,
    # а не в едином JSON. access-лог uvicorn отдельно всё равно отключён
    # (--no-access-log / access_log=False, см. Dockerfile и __main__ ниже
    # в main.py) — он дублировал бы RequestIDMiddleware без request_id и
    # в другом формате.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uv_logger = logging.getLogger(name)
        uv_logger.handlers = []
        uv_logger.propagate = True
