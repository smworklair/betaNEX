"""
Абстракция хранилища потребления бюджета (per-tenant usage store).

Зачем отдельный интерфейс, а не просто dict внутри BudgetService: для
учебных целей достаточно памяти процесса (InMemoryBudgetStore ниже), но
у этого способа есть жёсткая граница — при нескольких инстансах
ai-gateway за балансировщиком (или при `uvicorn --workers N`, что даёт
несколько ОС-процессов) счётчик НЕ будет общим: у каждого процесса своя
память, и тенант сможет потратить N-кратный лимит, просто попадая
на разные реплики/воркеры. Прод-реализация — Redis (INCRBYFLOAT на ключ
"{tenant}:{window}" + EXPIRE) или БД; ей достаточно реализовать этот же
протокол BudgetStore, ничего в BudgetService/AIService менять не
придётся. Тот же приём и та же граница уже есть у core/ratelimit.py, и
та же логика "in-process → общий стор при масштабировании", что у
Go-плана NEX (docs/architecture-go.md, §7: "Valkey только когда
появится вторая реплика").
"""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from collections import defaultdict
from dataclasses import dataclass


@dataclass(slots=True)
class WindowUsage:
    """Потребление за одно окно (одни сутки либо один месяц)."""

    window_key: str
    tokens: int = 0
    cost_usd: float = 0.0


@dataclass(slots=True)
class TenantUsage:
    day: WindowUsage
    month: WindowUsage


class BudgetStore(ABC):
    @abstractmethod
    async def get_usage(self, tenant_id: str, *, day_key: str, month_key: str) -> TenantUsage:
        """Текущее потребление тенанта; окна с устаревшим ключом обнуляются."""

    @abstractmethod
    async def add_usage(
        self, tenant_id: str, *, day_key: str, month_key: str, tokens: int, cost_usd: float
    ) -> None:
        """Прибавить потребление к текущим окнам (дню и месяцу одновременно)."""


class InMemoryBudgetStore(BudgetStore):
    """Потребление в памяти процесса — см. пояснение и его границы в шапке файла."""

    def __init__(self) -> None:
        self._usage: dict[str, TenantUsage] = {}
        # Лок на каждого тенанта отдельно, а не один общий: параллельные
        # запросы разных тенантов не блокируют друг друга. Сам dict с
        # локами (defaultdict) можно наполнять без доп. синхронизации —
        # в asyncio весь код между await-точками выполняется атомарно
        # (кооперативная многозадачность в одном OS-потоке, а не
        # настоящий параллелизм), поэтому создание нового Lock() при
        # первом обращении к новому тенанту не может быть прервано
        # другой корутиной на середине.
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    def _get_or_reset_locked(self, tenant_id: str, day_key: str, month_key: str) -> TenantUsage:
        usage = self._usage.get(tenant_id)
        if usage is None:
            usage = TenantUsage(day=WindowUsage(day_key), month=WindowUsage(month_key))
            self._usage[tenant_id] = usage
        # "Сброс" бюджета — не таймер и не фоновая задача, а ленивая
        # проверка при каждом обращении: если ключ периода изменился
        # (наступили новые сутки/новый месяц), счётчик этого окна
        # просто перезаводится с нуля. Значения за прошлые окна нигде
        # не сохраняются — для учебного сервиса это ожидаемо; для
        # реальной отчётности по расходам нужна отдельная история
        # (запись в БД в момент смены окна), это уже вне рамок BudgetStore.
        if usage.day.window_key != day_key:
            usage.day = WindowUsage(day_key)
        if usage.month.window_key != month_key:
            usage.month = WindowUsage(month_key)
        return usage

    async def get_usage(self, tenant_id: str, *, day_key: str, month_key: str) -> TenantUsage:
        async with self._locks[tenant_id]:
            return self._get_or_reset_locked(tenant_id, day_key, month_key)

    async def add_usage(
        self, tenant_id: str, *, day_key: str, month_key: str, tokens: int, cost_usd: float
    ) -> None:
        async with self._locks[tenant_id]:
            usage = self._get_or_reset_locked(tenant_id, day_key, month_key)
            usage.day.tokens += tokens
            usage.day.cost_usd += cost_usd
            usage.month.tokens += tokens
            usage.month.cost_usd += cost_usd
