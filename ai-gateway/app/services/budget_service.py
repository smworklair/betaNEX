"""
Учёт и проверка бюджета по тенантам (per-tenant budgets).

Место в архитектуре: концептуально то же самое, что декоратор "Budget"
из цепочки провайдера, описанной для Go-версии в docs/ai/README.md,
§2.4 (Router → Budget → Cache → RateLimit → Fallback → OpenAICompat) —
"Budget проверяет лимит tenant'а до запроса (429 при исчерпании)". Здесь
бюджет не обёрнут вокруг провайдера декоратором, а живёт в сервисном
слое (AIService, см. ai_service.py) — потому что здесь, в отличие от
провайдера, tenant_id известен per-request (из заголовка запроса), а не
фиксирован на одном экземпляре объекта, созданном при старте процесса.

Кто чем занимается:
- проверка лимита (check) вызывается на уровне FastAPI Depends
  (app/deps.py:enforce_budget) ДО входа в обработчик — это важно
  именно для /stream: как только начинается тело StreamingResponse,
  клиенту уже ушёл HTTP-статус 200, и сменить его на "бюджет исчерпан"
  нельзя. Проверка на уровне Depends гарантирует нормальный 429 вместо
  SSE-события error после уже отправленного 200.
- запись фактического потребления (record) вызывается из AIService
  сразу после успешного ответа провайдера — там, где известен настоящий
  usage. check() внутри AIService намеренно не дублируется: одно место
  принятия решения "уложился ли тенант в лимит" проще рассуждать и
  тестировать, чем два асинхронных источника истины.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from app.core.budget_store import BudgetStore, TenantUsage
from app.providers.base import Usage

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class TenantBudget:
    """
    Лимиты одного тенанта. Значение None по любому полю означает, что
    это измерение не ограничено (например, лимит только по деньгам, без
    отдельного ограничения по числу токенов).
    """

    daily_tokens: int | None = None
    daily_cost_usd: float | None = None
    monthly_tokens: int | None = None
    monthly_cost_usd: float | None = None


class BudgetExceededError(Exception):
    """Тенант исчерпал лимит — бросается ДО обращения к провайдеру."""

    def __init__(self, tenant_id: str, period: str, kind: str, limit: float, used: float) -> None:
        self.tenant_id = tenant_id
        self.period = period  # "day" | "month"
        self.kind = kind  # "tokens" | "cost_usd"
        self.limit = limit
        self.used = used
        period_ru = "сутки" if period == "day" else "месяц"
        kind_ru = "токенов" if kind == "tokens" else "долларов"
        super().__init__(
            f"тенант {tenant_id!r} исчерпал бюджет на {period_ru} по {kind_ru}: "
            f"использовано {used:g} из лимита {limit:g}"
        )


class BudgetService:
    def __init__(
        self,
        store: BudgetStore,
        budgets: dict[str, TenantBudget],
        default_budget: TenantBudget,
        pricing: dict[str, tuple[float, float]],
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._store = store
        self._budgets = budgets
        self._default_budget = default_budget
        self._pricing = pricing  # provider name -> (цена входных $/1K, цена выходных $/1K)
        # Инъекция "часов" — нужна для юнит-тестов сброса окна (день/
        # месяц) без реального ожидания. В проде — обычное время в UTC;
        # UTC, а не локальное время сервера, чтобы сутки/месяц не
        # "плавали" при переносе процесса между часовыми поясами.
        self._now = now or (lambda: datetime.now(timezone.utc))

    def budget_for(self, tenant_id: str) -> TenantBudget:
        return self._budgets.get(tenant_id, self._default_budget)

    def estimate_cost(self, provider: str, usage: Usage) -> float:
        price_in, price_out = self._pricing.get(provider, (0.0, 0.0))
        return (usage.prompt_tokens / 1000) * price_in + (usage.completion_tokens / 1000) * price_out

    def _window_keys(self) -> tuple[str, str]:
        now = self._now()
        return now.strftime("%Y-%m-%d"), now.strftime("%Y-%m")

    async def check(self, tenant_id: str) -> None:
        """
        Бросает BudgetExceededError, если по любому из четырёх измерений
        (сутки/месяц × токены/деньги) лимит уже достигнут.

        Проверяется уже накопленное потребление, а не прогноз стоимости
        предстоящего запроса — для LLM заранее не известно, сколько
        токенов уйдёт на ответ, поэтому конкретный запрос может увести
        потребление немного за лимит; отклонён будет уже следующий. Для
        учебного сервиса такая простая модель осознанно достаточна.
        """
        budget = self.budget_for(tenant_id)
        day_key, month_key = self._window_keys()
        usage = await self._store.get_usage(tenant_id, day_key=day_key, month_key=month_key)

        _check_limit(tenant_id, "day", "tokens", budget.daily_tokens, usage.day.tokens)
        _check_limit(tenant_id, "day", "cost_usd", budget.daily_cost_usd, usage.day.cost_usd)
        _check_limit(tenant_id, "month", "tokens", budget.monthly_tokens, usage.month.tokens)
        _check_limit(tenant_id, "month", "cost_usd", budget.monthly_cost_usd, usage.month.cost_usd)

    async def record(self, tenant_id: str, provider: str, usage: Usage) -> None:
        """Добавить фактическое потребление — вызывается ПОСЛЕ успешного ответа провайдера."""
        cost = self.estimate_cost(provider, usage)
        day_key, month_key = self._window_keys()
        await self._store.add_usage(
            tenant_id, day_key=day_key, month_key=month_key, tokens=usage.total_tokens, cost_usd=cost
        )
        logger.info(
            "budget: tenant=%s provider=%s tokens=%d cost_usd=%.4f",
            tenant_id,
            provider,
            usage.total_tokens,
            cost,
        )

    async def usage_for(self, tenant_id: str) -> TenantUsage:
        """Текущее потребление тенанта за оба окна — для отладки/мониторинга и тестов."""
        day_key, month_key = self._window_keys()
        return await self._store.get_usage(tenant_id, day_key=day_key, month_key=month_key)


def _check_limit(tenant_id: str, period: str, kind: str, limit: float | None, used: float) -> None:
    if limit is not None and used >= limit:
        raise BudgetExceededError(tenant_id, period, kind, limit, used)
