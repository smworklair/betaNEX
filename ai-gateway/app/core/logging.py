"""Настройка логирования — единый формат на весь процесс сервиса."""

from __future__ import annotations

import logging


def setup_logging(level: str) -> None:
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
