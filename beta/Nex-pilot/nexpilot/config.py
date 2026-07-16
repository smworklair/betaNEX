"""
Конфигурация Nex-pilot — простой dataclass поверх переменных окружения,
без pydantic-settings: проект маленький, и полезно один раз увидеть,
как конфигурация выглядит "руками". Принцип тот же 12-factor, что и в
ai-gateway/app/config.py и в Go-бэкенде NEX (docs/architecture-go.md,
§1) — секреты и настройки только из окружения, ничего не зашито в код.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# .../beta/Nex-pilot/nexpilot/config.py -> .../beta
_BETA_ROOT = Path(__file__).resolve().parent.parent.parent


@dataclass
class Config:
    # "frankai" (по умолчанию, локально) | "gateway" (через ai-gateway)
    backend: str = os.environ.get("NEXPILOT_BACKEND", "frankai")

    # --- FrankAI ---
    frankai_weights_path: str = os.environ.get(
        "FRANKAI_WEIGHTS_PATH", str(_BETA_ROOT / "FrankAI" / "weights" / "frankai_weights.npz")
    )
    frankai_corpus_path: str = os.environ.get(
        "FRANKAI_CORPUS_PATH", str(_BETA_ROOT / "FrankAI" / "frankai" / "data" / "sample_corpus.txt")
    )
    frankai_max_new_tokens: int = int(os.environ.get("FRANKAI_MAX_NEW_TOKENS", "200"))

    # --- ai-gateway (альтернативный backend) ---
    ai_gateway_url: str = os.environ.get("AI_GATEWAY_URL", "http://localhost:8090")
    ai_gateway_tenant_id: str | None = os.environ.get("AI_GATEWAY_TENANT_ID") or None
    # Общий секрет с ai-gateway (Settings.gateway_shared_secret /
    # NEX_AI_GATEWAY_SECRET на стороне ai-gateway, см. ai-gateway/app/
    # deps.py:verify_gateway_secret). Nex-pilot — не браузер и ходит в
    # ai-gateway напрямую, минуя nexd (см. докстринг GatewayBackend), но
    # это тот же trust-model, что и у nexd: без секрета ai-gateway,
    # если он настроен на прод-стенде, отклонит запрос ещё до чтения
    # X-Tenant-Id. Пусто (по умолчанию, локальный дев-стенд без секрета)
    # — заголовок X-Gateway-Secret не отправляется, совместимо с
    # ai-gateway без настроенного секрета.
    ai_gateway_secret: str | None = os.environ.get("AI_GATEWAY_SECRET") or None
    # Какой провайдер ai-gateway использовать (gemini/openai/deepseek/
    # qwen/kimi/gigachat/yandexgpt) — пусто значит "пусть шлюз выберет
    # сам" (DEFAULT_PROVIDER на стороне ai-gateway, с учётом его цепочки
    # fallback, см. ai-gateway/app/services/ai_service.py).
    ai_gateway_provider: str | None = os.environ.get("AI_GATEWAY_PROVIDER") or None


def load_config() -> Config:
    return Config()
