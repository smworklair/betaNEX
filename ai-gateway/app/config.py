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
    # 0 по умолчанию: без реальных цен сервис считает бюджет только по
    # токенам, cost_usd всегда будет 0 и лимиты по деньгам просто не
    # сработают (это не баг, а осознанный дефолт "без настройки цен").
    gemini_price_input_per_1k_usd: float = 0.0
    gemini_price_output_per_1k_usd: float = 0.0
    custom_price_input_per_1k_usd: float = 0.0
    custom_price_output_per_1k_usd: float = 0.0
    openai_price_input_per_1k_usd: float = 0.0
    openai_price_output_per_1k_usd: float = 0.0
    deepseek_price_input_per_1k_usd: float = 0.0
    deepseek_price_output_per_1k_usd: float = 0.0
    qwen_price_input_per_1k_usd: float = 0.0
    qwen_price_output_per_1k_usd: float = 0.0
    kimi_price_input_per_1k_usd: float = 0.0
    kimi_price_output_per_1k_usd: float = 0.0
    gigachat_price_input_per_1k_usd: float = 0.0
    gigachat_price_output_per_1k_usd: float = 0.0
    yandexgpt_price_input_per_1k_usd: float = 0.0
    yandexgpt_price_output_per_1k_usd: float = 0.0

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """Настройки читаются из окружения один раз и кешируются на процесс."""
    return Settings()
