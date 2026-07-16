"""
Точка входа сервиса ai-gateway.

Учебный аналог того, как AI-часть NEX могла бы выглядеть на бэкенде —
см. docs/ai/README.md, раздел "roadmap": там этот же принцип описан для
Go (пакет internal/platform/llm, который пока не реализован). Здесь —
рабочая реализация того же самого на Python: роутер → сервис → клиент
провайдера, ключи только из окружения, ни одного секрета в коде.

Сервис НЕ подключён к Go-бэкенду nexd — это самостоятельный процесс на
отдельном порту, специально вынесенный в свою папку (ai-gateway/), чтобы
не мешать основному проекту.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

if TYPE_CHECKING:
    from redis.asyncio import Redis

from app.api.routes import router
from app.config import Settings, get_settings
from app.core.budget_store import InMemoryBudgetStore
from app.core.errors import (
    RateLimitExceeded,
    ai_service_error_handler,
    budget_exceeded_handler,
    rate_limit_error_handler,
)
from app.core.limits import MaxBodySizeMiddleware
from app.core.logging import setup_logging
from app.core.metrics import MetricsMiddleware
from app.core.ratelimit import InMemoryRateLimiter, RateLimiter, RedisRateLimiter
from app.core.request_id import RequestIDMiddleware
from app.core.response_cache import InMemoryResponseCache, RedisResponseCache, ResponseCache
from app.providers.base import LLMProvider
from app.providers.gemini import GeminiProvider
from app.providers.gigachat import GigaChatProvider
from app.providers.openai_compat import OpenAICompatProvider
from app.providers.yandexgpt import YandexGPTProvider
from app.services.ai_service import AIService, AIServiceError
from app.services.budget_service import BudgetExceededError, BudgetService, TenantBudget

logger = logging.getLogger(__name__)


def _load_tenant_budgets(settings: Settings) -> tuple[dict[str, TenantBudget], TenantBudget]:
    """
    Персональные лимиты тенантов — из JSON-файла (см.
    tenants.example.json); лимит по умолчанию — из .env, применяется к
    любому тенанту, которого в файле нет (в том числе "default").

    Почему файл, а не только переменные окружения: перечислять много
    тенантов через TENANT_1_ID=..., TENANT_2_ID=... неудобно и плохо
    читается при росте их числа. Отдельный JSON — такая же по духу
    "конфигурация, а не код", как OpenAPI-контракт или SQL-миграции в
    Go-части NEX, только без боли с экранированием JSON внутри одной
    строки .env.

    Загрузка (как и вся остальная сборка сервиса) — в композиционном
    корне (main.py), а не где-то во "внутренних" слоях: тот же принцип,
    что в Go-версии — "всё собирается в cmd/nexd/main.go, а не в
    глубине пакетов" (docs/architecture-go.md, §1).
    """
    default_budget = TenantBudget(
        daily_tokens=settings.budget_default_daily_tokens,
        daily_cost_usd=settings.budget_default_daily_cost_usd,
        monthly_tokens=settings.budget_default_monthly_tokens,
        monthly_cost_usd=settings.budget_default_monthly_cost_usd,
    )

    path = Path(settings.tenant_budgets_file)
    if not path.is_file():
        logger.info("файл лимитов %s не найден — все тенанты получат лимит по умолчанию", path)
        return {}, default_budget

    raw = json.loads(path.read_text(encoding="utf-8"))
    budgets = {
        tenant_id: TenantBudget(
            daily_tokens=limits.get("daily_tokens"),
            daily_cost_usd=limits.get("daily_cost_usd"),
            monthly_tokens=limits.get("monthly_tokens"),
            monthly_cost_usd=limits.get("monthly_cost_usd"),
        )
        for tenant_id, limits in raw.items()
        # ключи вида "_comment" — это комментарий внутри JSON (сам
        # формат их не поддерживает), пропускаем всё, что не похоже на
        # запись тенанта, чтобы tenants.example.json можно было
        # скопировать в tenants.json как есть, не вычищая пояснения.
        if not tenant_id.startswith("_") and isinstance(limits, dict)
    }
    logger.info("загружены персональные лимиты для %d тенантов из %s", len(budgets), path)
    return budgets, default_budget


def _build_budget_service(settings: Settings) -> BudgetService:
    budgets, default_budget = _load_tenant_budgets(settings)
    pricing = {
        "gemini": (settings.gemini_price_input_per_1k_usd, settings.gemini_price_output_per_1k_usd),
        "custom": (settings.custom_price_input_per_1k_usd, settings.custom_price_output_per_1k_usd),
        "openai": (settings.openai_price_input_per_1k_usd, settings.openai_price_output_per_1k_usd),
        "deepseek": (settings.deepseek_price_input_per_1k_usd, settings.deepseek_price_output_per_1k_usd),
        "qwen": (settings.qwen_price_input_per_1k_usd, settings.qwen_price_output_per_1k_usd),
        "kimi": (settings.kimi_price_input_per_1k_usd, settings.kimi_price_output_per_1k_usd),
        "gigachat": (settings.gigachat_price_input_per_1k_usd, settings.gigachat_price_output_per_1k_usd),
        "yandexgpt": (settings.yandexgpt_price_input_per_1k_usd, settings.yandexgpt_price_output_per_1k_usd),
    }
    return BudgetService(
        store=InMemoryBudgetStore(), budgets=budgets, default_budget=default_budget, pricing=pricing
    )


def _build_cache_backend(settings: Settings) -> tuple[ResponseCache | None, RateLimiter, "Redis | None"]:
    """
    Response cache и rate limiter выбираются одним переключателем
    (settings.cache_backend, см. app/config.py) и при backend=redis
    делят один и тот же клиент — они обращаются к разным префиксам
    ключей ("llmcache:"/"ratelimit:", см. докстринги реализаций), так
    что общий клиент не создаёт коллизий, а лишний TCP-коннекшн на
    процесс не нужен.

    Третий элемент кортежа — сам клиент (нужен только для того, чтобы
    composition root мог его закрыть/убедиться, что он создан), либо
    None при backend=memory.
    """
    if settings.cache_backend == "redis":
        from redis.asyncio import Redis

        redis_client = Redis.from_url(settings.redis_url)
        cache: ResponseCache | None = RedisResponseCache(redis_client) if settings.response_cache_enabled else None
        rate_limiter: RateLimiter = RedisRateLimiter(redis_client, settings.rate_limit_per_minute)
        return cache, rate_limiter, redis_client

    cache = InMemoryResponseCache(max_entries=settings.response_cache_max_entries) if settings.response_cache_enabled else None
    rate_limiter = InMemoryRateLimiter(settings.rate_limit_per_minute)
    return cache, rate_limiter, None


def _build_service(settings: Settings, budget_service: BudgetService, cache: ResponseCache | None) -> AIService:
    providers: dict[str, LLMProvider] = {}
    # Провайдер регистрируется, только если для него задан ключ — так
    # сервис стартует даже с одним настроенным провайдером, а не падает
    # из-за отсутствия ключа у остальных, которые никто не собирался
    # использовать. Для GigaChat/YandexGPT регистрация происходит и в
    # "мок"-режиме (без ключа) — см. GIGACHAT_MOCK/YANDEXGPT_MOCK ниже.
    if settings.gemini_api_key:
        providers["gemini"] = GeminiProvider(
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            base_url=settings.gemini_base_url,
            timeout=settings.request_timeout_seconds,
            max_output_tokens=settings.max_output_tokens,
        )
    if settings.custom_api_key:
        providers["custom"] = OpenAICompatProvider(
            name="custom",
            api_key=settings.custom_api_key,
            base_url=settings.custom_base_url,
            model=settings.custom_model,
            timeout=settings.request_timeout_seconds,
            max_output_tokens=settings.max_output_tokens,
        )
    if settings.openai_api_key:
        providers["openai"] = OpenAICompatProvider(
            name="openai",
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
            model=settings.openai_model,
            timeout=settings.request_timeout_seconds,
            max_output_tokens=settings.max_output_tokens,
        )
    if settings.deepseek_api_key:
        providers["deepseek"] = OpenAICompatProvider(
            name="deepseek",
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            model=settings.deepseek_model,
            timeout=settings.request_timeout_seconds,
            max_output_tokens=settings.max_output_tokens,
        )
    if settings.qwen_api_key:
        providers["qwen"] = OpenAICompatProvider(
            name="qwen",
            api_key=settings.qwen_api_key,
            base_url=settings.qwen_base_url,
            model=settings.qwen_model,
            timeout=settings.request_timeout_seconds,
            max_output_tokens=settings.max_output_tokens,
        )
    if settings.kimi_api_key:
        providers["kimi"] = OpenAICompatProvider(
            name="kimi",
            api_key=settings.kimi_api_key,
            base_url=settings.kimi_base_url,
            model=settings.kimi_model,
            timeout=settings.request_timeout_seconds,
            max_output_tokens=settings.max_output_tokens,
        )
    if settings.gigachat_auth_key or settings.gigachat_mock:
        providers["gigachat"] = GigaChatProvider(
            auth_key=settings.gigachat_auth_key,
            scope=settings.gigachat_scope,
            oauth_url=settings.gigachat_oauth_url,
            base_url=settings.gigachat_base_url,
            model=settings.gigachat_model,
            timeout=settings.request_timeout_seconds,
            max_output_tokens=settings.max_output_tokens,
            ca_bundle=settings.gigachat_ca_bundle or None,
            insecure_skip_verify=settings.gigachat_insecure_skip_verify,
            mock=settings.gigachat_mock,
        )
    if (settings.yandexgpt_api_key and settings.yandexgpt_folder_id) or settings.yandexgpt_mock:
        providers["yandexgpt"] = YandexGPTProvider(
            api_key=settings.yandexgpt_api_key,
            folder_id=settings.yandexgpt_folder_id,
            model=settings.yandexgpt_model,
            base_url=settings.yandexgpt_base_url,
            timeout=settings.request_timeout_seconds,
            max_output_tokens=settings.max_output_tokens,
            mock=settings.yandexgpt_mock,
        )
    if not providers:
        raise RuntimeError(
            "не настроен ни один провайдер — задайте хотя бы один *_API_KEY "
            "(см. .env.example) либо GIGACHAT_MOCK/YANDEXGPT_MOCK=true для дев-режима"
        )
    default = settings.default_provider if settings.default_provider in providers else next(iter(providers))

    # Цепочка fallback — только реально зарегистрированные провайдеры, в
    # заданном порядке (см. Settings.provider_fallback_chain). Если после
    # фильтрации ничего не осталось (например, в PROVIDER_FALLBACK_CHAIN
    # опечатка или там только незарегистрированные провайдеры) — не
    # оставляем сервис вообще без маршрута, откатываемся на [default].
    fallback_chain = [name for name in settings.provider_fallback_chain_list if name in providers]
    if not fallback_chain:
        fallback_chain = [default]
    elif default not in fallback_chain:
        # default_provider должен быть достижим даже если его забыли
        # вписать в цепочку явно — иначе поведение "провайдер не указан
        # клиентом" неожиданно перестало бы совпадать с DEFAULT_PROVIDER.
        fallback_chain = [default, *fallback_chain]

    return AIService(
        providers=providers,
        default_provider=default,
        budget_service=budget_service,
        fallback_chain=fallback_chain,
        cache=cache,
        cache_ttl_seconds=settings.response_cache_ttl_seconds,
    )


def create_app() -> FastAPI:
    settings = get_settings()
    setup_logging(settings.log_level)

    app = FastAPI(
        title="NEX AI Gateway (учебный)",
        description="Учебный AI-шлюз к LLM-провайдерам: выносит AI-вызовы из фронтенда на бэкенд.",
        version="0.1.0",
    )

    app.add_middleware(MaxBodySizeMiddleware)

    # CORS выключен по умолчанию (пустой список origins) — самый
    # безопасный вариант для учебного сервиса без публичного фронтенда.
    if settings.cors_origins_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins_list,
            allow_credentials=False,
            allow_methods=["POST", "GET"],
            allow_headers=["Content-Type"],
        )

    # MetricsMiddleware — те же aigw_http_requests_total/duration_seconds,
    # что видит эксплуатация в /metrics (см. app/core/metrics.py).
    app.add_middleware(MetricsMiddleware)

    # Добавлен последним — в Starlette последний добавленный middleware
    # становится самым внешним слоем (см. docstring RequestIDMiddleware):
    # request_id проставляется раньше любой другой обработки и виден в
    # логе итоговый статус ответа, включая ответы MaxBodySizeMiddleware
    # и обработчиков исключений (они — внутренние слои относительно него).
    app.add_middleware(RequestIDMiddleware)

    # cache/rate_limiter — оба переключаются одним CACHE_BACKEND (см.
    # _build_cache_backend); redis_client, если он создан, живёт до конца
    # процесса — отдельного шага очистки нет: uvicorn останавливает
    # процесс по сигналу, ОС закрывает сокет, а у сервиса и так нет
    # другой lifecycle-инфраструктуры, которую стоило бы заводить ради
    # этого одного клиента.
    cache, rate_limiter, redis_client = _build_cache_backend(settings)
    if redis_client is not None:
        app.state.redis_client = redis_client
        logger.info("cache backend: redis")
    else:
        logger.info("cache backend: memory")

    budget_service = _build_budget_service(settings)
    app.state.budget_service = budget_service
    app.state.ai_service = _build_service(settings, budget_service, cache)
    app.state.rate_limiter = rate_limiter

    app.include_router(router)
    # Starlette типизирует add_exception_handler инвариантно по Exception —
    # обработчик, типизированный под конкретное исключение (как здесь),
    # формально не подходит по mypy, хотя это ровно официальный паттерн
    # FastAPI/Starlette (регистрация по типу исключения). Подавляем точечно.
    app.add_exception_handler(AIServiceError, ai_service_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, rate_limit_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(BudgetExceededError, budget_exceeded_handler)  # type: ignore[arg-type]

    logger.info(
        "ai-gateway готов: провайдеры=%s, по умолчанию=%s, fallback-цепочка=%s",
        app.state.ai_service.provider_names,
        app.state.ai_service.default_provider,
        app.state.ai_service.fallback_chain,
    )
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    _settings = get_settings()
    # access_log=False: RequestIDMiddleware уже логирует каждый запрос в
    # едином JSON-формате с request_id (см. core/request_id.py) —
    # встроенный access-лог uvicorn дублировал бы её в своём формате.
    uvicorn.run("app.main:app", host=_settings.host, port=_settings.port, reload=False, access_log=False)
