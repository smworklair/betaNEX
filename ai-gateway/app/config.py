"""
Конфигурация сервиса — читается ТОЛЬКО из переменных окружения (+ файл
.env для локальной разработки, см. .env.example).

Почему так: секреты (ключи LLM-провайдеров) никогда не должны попадать
в код или в git — иначе они утекут при первом же публичном форке/PR.
Это то же правило 12-factor, что уже действует в Go-бэкенде NEX
(internal/config/config.go) — конфигурация приходит извне процесса,
а не хранится вшитой в бинарник.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Сервис ---
    host: str = "0.0.0.0"
    port: int = 8090
    log_level: str = "info"
    # Список через запятую: "http://localhost:5173,https://example.com".
    # Пусто = CORS вообще не включается (браузер с чужого origin не
    # сможет дёргать API) — самый безопасный вариант по умолчанию.
    cors_origins: str = ""

    # Секрет, общий с Go-бэкендом nexd (переменная называется одинаково
    # по обе стороны — NEX_AI_GATEWAY_SECRET, см. internal/config/config.go
    # и deploy/.env.example). Браузер этот секрет никогда не видит: он
    # ходит в ai-gateway ТОЛЬКО через nexd (internal/platform/aiproxy),
    # который сам подставляет и заголовок, и X-Tenant-Id из настоящей
    # аутентифицированной сессии — так X-Tenant-Id перестаёт быть
    # самопредставлением клиента (см. deps.py:verify_gateway_secret).
    #
    # Пусто (по умолчанию, локальная разработка без nexd-прокси) —
    # секрет не проверяется и X-Tenant-Id снова читается как есть, ровно
    # как было раньше: локальный `uvicorn app.main:app` без nexd рядом
    # не ломается.
    gateway_shared_secret: str = Field(default="", validation_alias="NEX_AI_GATEWAY_SECRET")

    # --- Какой провайдер использовать, если клиент явно не указал ---
    default_provider: Literal[
        "gemini", "custom", "openai", "deepseek", "qwen", "kimi", "gigachat", "yandexgpt"
    ] = "gemini"

    # --- Цепочка fallback между провайдерами (см. app/services/ai_service.py) ---
    # Через запятую, по приоритету: если первый провайдер недоступен/упал
    # с ошибкой (таймаут, 5xx, невалидный ответ), пробуем следующий, и так
    # далее. Работает только тогда, когда клиент НЕ указал provider явно в
    # запросе — явный выбор провайдера (например, ru-restricted маршрут для
    # ПДн, см. docs/ai/README.md §3) всегда уважается буквально, без
    # автопереключения на другой провайдер. Имена, для которых нет ключа
    # (провайдер не зарегистрирован в app/main.py:_build_service),
    # молча пропускаются — так дефолт работает и при частично заполненном
    # .env (например, настроен только Gemini).
    #
    # Дефолт — DeepSeek → Kimi → Gemini: два недорогих OpenAI-совместимых
    # провайдера первыми (дешевле для учебной нагрузки), затем Gemini как
    # более устойчивый запасной вариант с щедрым бесплатным тиром.
    provider_fallback_chain: str = "deepseek,kimi,gemini"

    # --- Gemini (Google generativelanguage API) ---
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"

    # --- custom: свободный слот под любой другой OpenAI-совместимый /chat/completions ---
    custom_api_key: str = ""
    custom_base_url: str = "https://llm-api.fun/v1"
    custom_model: str = "agent"

    # --- OpenAI (официальный API) ---
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"

    # --- DeepSeek (OpenAI-совместимый) ---
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    deepseek_model: str = "deepseek-chat"

    # --- Qwen / DashScope compatible-mode (OpenAI-совместимый) ---
    qwen_api_key: str = ""
    qwen_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    qwen_model: str = "qwen-plus"

    # --- Kimi / Moonshot (OpenAI-совместимый) ---
    kimi_api_key: str = ""
    kimi_base_url: str = "https://api.moonshot.cn/v1"
    kimi_model: str = "moonshot-v1-8k"

    # --- GigaChat (Сбер) — свой контракт: OAuth2 + сертификаты РФ ---
    # "Ключ авторизации" (Authorization key) из личного кабинета GigaChat
    # API — это уже готовый base64(client_id:client_secret), собирать его
    # вручную не нужно.
    gigachat_auth_key: str = ""
    gigachat_scope: Literal["GIGACHAT_API_PERS", "GIGACHAT_API_B2B", "GIGACHAT_API_CORP"] = "GIGACHAT_API_PERS"
    gigachat_oauth_url: str = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
    gigachat_base_url: str = "https://gigachat.devices.sberbank.ru/api/v1"
    gigachat_model: str = "GigaChat"
    # Путь к PEM-файлу с корневым сертификатом НУЦ Минцифры (нужен, чтобы
    # httpx доверял TLS-цепочке gigachat.devices.sberbank.ru). Пусто —
    # пробуем системное доверенное хранилище (обычно не сработает).
    gigachat_ca_bundle: str = ""
    # Только для локальной разработки/CI без настоящего сертификата —
    # ОТКЛЮЧАЕТ проверку TLS. Никогда не включайте в проде.
    gigachat_insecure_skip_verify: bool = False
    # Без реальных credentials Сбера сервис не сможет реально сходить в
    # GigaChat из этой среды — включите, чтобы получать детерминированный
    # ответ-заглушку вместо сетевого вызова (см. providers/gigachat.py).
    gigachat_mock: bool = False

    # --- YandexGPT (Yandex Cloud Foundation Models) — свой контракт ---
    yandexgpt_api_key: str = ""
    yandexgpt_folder_id: str = ""
    yandexgpt_base_url: str = "https://llm.api.cloud.yandex.net"
    yandexgpt_model: str = "yandexgpt-lite"
    # Аналогично gigachat_mock — заглушка без реального Api-Key/folder_id.
    yandexgpt_mock: bool = False

    # --- Безопасность и оптимизация ---
    request_timeout_seconds: float = 40.0   # против зависшего запроса к провайдеру
    max_output_tokens: int = 2048           # ограничение стоимости и размера ответа
    rate_limit_per_minute: int = 20         # простая защита от злоупотребления, см. core/ratelimit.py

    # --- Кэш ответов LLM (provider, tenant, system, messages) → ответ ---
    # См. app/core/response_cache.py и app/services/ai_service.py:
    # _cache_key. Экономит токены/деньги/задержку на повторных вопросах;
    # изолирован по тенантам (см. докстринг response_cache.py) — тенант A
    # никогда не получит ответ, закэшированный для промпта тенанта B.
    response_cache_enabled: bool = True
    response_cache_ttl_seconds: float = 300.0   # 5 минут — короткий TTL: правильнее для меняющихся данных
    response_cache_max_entries: int = 1000      # граница памяти для InMemoryResponseCache, см. её докстринг

    # --- Backend кэша ответов и rate-limiter'а ---
    # "memory" (по умолчанию) — оба живут в памяти процесса, как и было;
    # не общий между инстансами/воркерами (см. докстринги InMemoryRateLimiter/
    # InMemoryResponseCache). "redis" — общий Redis/Valkey (см.
    # core/ratelimit.py:RedisRateLimiter, core/response_cache.py:RedisResponseCache),
    # нужен, когда ai-gateway работает больше чем одним процессом. Тот же
    # переключатель и тот же принцип, что у Go-стороны NEX
    # (NEX_CACHE_BACKEND, internal/config/config.go) — можно указывать
    # один и тот же Redis/Valkey для обоих сервисов, ключи не пересекаются
    # (разные префиксы, см. докстринг RedisResponseCache).
    cache_backend: Literal["memory", "redis"] = "memory"
    redis_url: str = "redis://localhost:6379/0"

    # --- Бюджеты по тенантам (per-tenant budgets) ---
    # Путь к JSON-файлу с персональными лимитами по тенантам, см.
    # tenants.example.json. Если файла нет — все тенанты (включая
    # синтетического "default", см. app/deps.py:get_tenant_id) получают
    # лимит по умолчанию из полей ниже.
    tenant_budgets_file: str = "tenants.json"
    budget_default_daily_tokens: int = 20000
    budget_default_daily_cost_usd: float = 1.0
    budget_default_monthly_tokens: int = 400000
    budget_default_monthly_cost_usd: float = 20.0

    # --- Цена за 1000 токенов ($), для оценки стоимости в бюджете ---
    # Дефолты ниже — публичные прайс-листы провайдеров по состоянию на
    # июль 2026 (см. ai-gateway/README.md, раздел «Цены за токен» — там
    # же ссылки на источники и курс ₽/$, использованный для конвертации
    # рублёвых тарифов GigaChat/YandexGPT). Это ОРИЕНТИР для учебного
    # бюджетирования, не прайс-лист для реального биллинга: провайдеры
    # меняют цены без предупреждения, конкретная модель/тариф/скидка за
    # объём может отличаться — для продакшена сверяйте с официальной
    # страницей тарифов перед тем как полагаться на cost_usd в бюджете.
    # 0 (как было раньше) по-прежнему означает "не оценивать деньги для
    # этого провайдера" — годится и для custom (URL/цена неизвестны
    # заранее) и для явного отключения денежного лимита.
    gemini_price_input_per_1k_usd: float = 0.00015  # Gemini 2.5 Flash: $0.15 / 1M input
    gemini_price_output_per_1k_usd: float = 0.00125  # $1.25 / 1M output
    custom_price_input_per_1k_usd: float = 0.0  # свободный слот — цена зависит от того, что за URL подставили
    custom_price_output_per_1k_usd: float = 0.0
    openai_price_input_per_1k_usd: float = 0.00015  # gpt-4o-mini: $0.15 / 1M input
    openai_price_output_per_1k_usd: float = 0.0006  # $0.60 / 1M output
    deepseek_price_input_per_1k_usd: float = 0.00014  # deepseek-chat (cache-miss): $0.14 / 1M input
    deepseek_price_output_per_1k_usd: float = 0.00028  # $0.28 / 1M output
    qwen_price_input_per_1k_usd: float = 0.0004  # qwen-plus, нижний тариф: $0.40 / 1M input
    qwen_price_output_per_1k_usd: float = 0.0012  # $1.20 / 1M output
    kimi_price_input_per_1k_usd: float = 0.0002  # moonshot-v1-8k: $0.20 / 1M input
    kimi_price_output_per_1k_usd: float = 0.002  # $2.00 / 1M output
    gigachat_price_input_per_1k_usd: float = 0.00256  # GigaChat-2 Lite: ~0.2₽ / 1K токенов, курс ~78₽/$
    gigachat_price_output_per_1k_usd: float = 0.00256  # тариф не различает вход/выход — единая ставка за токен
    yandexgpt_price_input_per_1k_usd: float = 0.00256  # YandexGPT Lite: 0.2₽ / 1K input, курс ~78₽/$
    yandexgpt_price_output_per_1k_usd: float = 0.00513  # 0.4₽ / 1K output

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def provider_fallback_chain_list(self) -> list[str]:
        return [name.strip() for name in self.provider_fallback_chain.split(",") if name.strip()]


@lru_cache
def get_settings() -> Settings:
    """Настройки читаются из окружения один раз и кешируются на процесс."""
    return Settings()
