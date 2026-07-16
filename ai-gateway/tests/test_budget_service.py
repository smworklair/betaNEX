"""
Юнит-тесты BudgetService: исчерпание лимита, сброс окна день/месяц,
безопасность параллельных обновлений.

Без pytest-asyncio: тесты обычные (def, не async def), а внутри сами
управляют event loop через asyncio.run(). Так не нужна лишняя
зависимость ради нескольких тестов — тот же принцип "лишний
зависимость только через явное решение", что и в Go-части NEX
(docs/architecture-go.md, §7: "stdlib-first").
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.core.budget_store import InMemoryBudgetStore
from app.providers.base import Usage
from app.services.budget_service import BudgetExceededError, BudgetService, TenantBudget


def _service(now_holder: list[datetime], **budget_kwargs) -> BudgetService:
    return BudgetService(
        store=InMemoryBudgetStore(),
        budgets={"acme": TenantBudget(**budget_kwargs)},
        default_budget=TenantBudget(),  # для тестов "неизвестный" тенант не ограничен
        pricing={"gemini": (0.0, 0.0)},
        now=lambda: now_holder[0],
    )


def test_exhaust_daily_token_budget() -> None:
    now_holder = [datetime(2026, 7, 16, 8, 0, tzinfo=timezone.utc)]
    service = _service(now_holder, daily_tokens=100)

    async def scenario() -> None:
        # Пока ничего не потрачено — проверка проходит без исключения.
        await service.check("acme")

        # Тратим почти весь бюджет одним запросом (90 из 100).
        await service.record("acme", "gemini", Usage(prompt_tokens=60, completion_tokens=30))
        await service.check("acme")  # ещё можно

        # Следующий запрос выводит потребление за лимит.
        await service.record("acme", "gemini", Usage(prompt_tokens=5, completion_tokens=10))
        with pytest.raises(BudgetExceededError) as exc_info:
            await service.check("acme")

        assert exc_info.value.tenant_id == "acme"
        assert exc_info.value.period == "day"
        assert exc_info.value.kind == "tokens"
        assert exc_info.value.used == 105

    asyncio.run(scenario())


def test_daily_window_resets_next_day_but_month_keeps_accumulating() -> None:
    now_holder = [datetime(2026, 7, 16, 23, 55, tzinfo=timezone.utc)]
    service = _service(now_holder, daily_tokens=100, monthly_tokens=1000)

    async def scenario() -> None:
        await service.record("acme", "gemini", Usage(prompt_tokens=90, completion_tokens=10))
        with pytest.raises(BudgetExceededError) as exc_info:
            await service.check("acme")
        assert exc_info.value.period == "day"

        # Наступили новые сутки — дневной счётчик обнуляется.
        now_holder[0] += timedelta(minutes=10)
        await service.check("acme")  # больше не бросает исключение

        # А вот месячный счётчик — тот же месяц, потребление сохранилось.
        usage = await service.usage_for("acme")
        assert usage.month.tokens == 100

    asyncio.run(scenario())


def test_monthly_window_resets_on_new_month() -> None:
    now_holder = [datetime(2026, 7, 31, 23, 0, tzinfo=timezone.utc)]
    service = _service(now_holder, monthly_tokens=100)

    async def scenario() -> None:
        await service.record("acme", "gemini", Usage(prompt_tokens=90, completion_tokens=10))
        with pytest.raises(BudgetExceededError) as exc_info:
            await service.check("acme")
        assert exc_info.value.period == "month"

        now_holder[0] = datetime(2026, 8, 1, 0, 5, tzinfo=timezone.utc)
        await service.check("acme")  # новый месяц — лимит снова не достигнут

    asyncio.run(scenario())


def test_unknown_tenant_falls_back_to_default_budget() -> None:
    now_holder = [datetime(2026, 7, 16, 8, 0, tzinfo=timezone.utc)]
    service = BudgetService(
        store=InMemoryBudgetStore(),
        budgets={},  # у "unknown-tenant" нет персонального лимита
        default_budget=TenantBudget(daily_tokens=10),
        pricing={},
        now=lambda: now_holder[0],
    )

    async def scenario() -> None:
        await service.record("unknown-tenant", "gemini", Usage(prompt_tokens=8, completion_tokens=5))
        with pytest.raises(BudgetExceededError):
            await service.check("unknown-tenant")

    asyncio.run(scenario())


def test_cost_budget_uses_provider_pricing() -> None:
    now_holder = [datetime(2026, 7, 16, 8, 0, tzinfo=timezone.utc)]
    service = BudgetService(
        store=InMemoryBudgetStore(),
        budgets={"acme": TenantBudget(daily_cost_usd=1.0)},
        default_budget=TenantBudget(),
        # $10 за 1K входных токенов, $20 за 1K выходных — намеренно дорого,
        # чтобы уложиться в лимит одним небольшим запросом.
        pricing={"gemini": (10.0, 20.0)},
        now=lambda: now_holder[0],
    )

    async def scenario() -> None:
        # 50 токенов на входе и 10 на выходе: 0.05*10 + 0.01*20 = 0.7$
        await service.record("acme", "gemini", Usage(prompt_tokens=50, completion_tokens=10))
        await service.check("acme")  # 0.7 из 1.0 — ещё можно

        # Ещё один такой же запрос: 1.4$ суммарно — лимит по деньгам превышен.
        await service.record("acme", "gemini", Usage(prompt_tokens=50, completion_tokens=10))
        with pytest.raises(BudgetExceededError) as exc_info:
            await service.check("acme")
        assert exc_info.value.kind == "cost_usd"

    asyncio.run(scenario())


def test_concurrent_record_calls_do_not_lose_increments() -> None:
    """
    Проверка потокобезопасности (в терминах asyncio — coroutine-safety):
    50 параллельных record() не должны терять инкременты. В asyncio нет
    настоящего параллелизма внутри одного процесса, но без Lock в
    InMemoryBudgetStore гонка всё равно была бы возможна, если бы между
    чтением и записью счётчика случилась точка await — Lock в сторе
    как раз это предотвращает (см. app/core/budget_store.py).
    """
    now_holder = [datetime(2026, 7, 16, 8, 0, tzinfo=timezone.utc)]
    service = _service(now_holder, daily_tokens=10_000_000)

    async def scenario() -> None:
        await asyncio.gather(
            *[
                service.record("acme", "gemini", Usage(prompt_tokens=1, completion_tokens=1))
                for _ in range(50)
            ]
        )
        usage = await service.usage_for("acme")
        assert usage.day.tokens == 100  # 50 запросов * 2 токена

    asyncio.run(scenario())
