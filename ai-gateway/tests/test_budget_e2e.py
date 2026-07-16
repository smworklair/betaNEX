"""
End-to-end тест бюджета через реальный HTTP-стек: FastAPI TestClient →
роутер → Depends(enforce_budget) → BudgetService → провайдер (GigaChat в
GIGACHAT_MOCK-режиме, без сети) — проверяем, что при исчерпании лимита
клиент реально получает HTTP 429, а не просто что BudgetService.check()
бросает исключение (это уже покрыто в test_budget_service.py на уровне
одного класса, без роутера/exception-handler'а).

GIGACHAT_MOCK — не про экономию сети как таковую, а про детерминизм:
реальный провайдер отвечал бы разной длины текстом, и рассчитать заранее
точное число токенов для проверки лимита было бы нельзя.
"""

from __future__ import annotations

from starlette.testclient import TestClient

from app.config import Settings
from app.main import create_app


def _client_with_daily_token_limit(monkeypatch, limit: int) -> TestClient:
    settings = Settings(
        gigachat_mock=True,
        budget_default_daily_tokens=limit,
        tenant_budgets_file="no-such-tenants-file.json",
    )
    monkeypatch.setattr("app.main.get_settings", lambda: settings)
    return TestClient(create_app())


def test_ask_returns_429_after_daily_token_budget_exhausted(monkeypatch) -> None:
    # Лимит в 1 токен — мок-ответ GigaChat заведомо длиннее одного токена
    # (см. app/providers/gigachat.py:_MOCK_REPLY), поэтому уже ПЕРВЫЙ
    # успешный ответ гарантированно выводит потребление тенанта за лимит,
    # а второй запрос отклоняется до обращения к провайдеру.
    client = _client_with_daily_token_limit(monkeypatch, limit=1)

    first = client.post("/api/v1/ai/ask", json={"message": "привет"})
    assert first.status_code == 200
    assert first.json()["usage"]["total_tokens"] >= 1

    second = client.post("/api/v1/ai/ask", json={"message": "привет ещё раз"})
    assert second.status_code == 429
    assert second.headers["content-type"] == "application/problem+json"
    body = second.json()
    assert body["title"] == "tenant budget exceeded"
    assert body["tenant_id"] == "default"  # X-Tenant-Id не передан — синтетический тенант
    assert body["period"] == "day"
    assert body["limit_kind"] == "tokens"
    assert body["limit"] == 1


def test_ask_succeeds_while_within_budget(monkeypatch) -> None:
    # Достаточно щедрый лимит — бюджет не должен мешать обычной работе;
    # заодно проверка, что 429-тест выше не может пройти "случайно" из-за
    # отдельной причины (например, сломанного мока).
    client = _client_with_daily_token_limit(monkeypatch, limit=1_000_000)

    for _ in range(3):
        res = client.post("/api/v1/ai/ask", json={"message": "привет"})
        assert res.status_code == 200


def test_stream_returns_429_before_first_byte_when_budget_exhausted(monkeypatch) -> None:
    # /stream — самый чувствительный случай: бюджет обязан быть проверен
    # ДО того, как клиенту уйдёт HTTP 200 и начнётся тело
    # StreamingResponse (см. app/deps.py:enforce_budget, докстринг). Если
    # бы проверка была внутри генератора, клиент увидел бы 200 + SSE
    # event "error", а не 429 — это разные контракты для вызывающего кода.
    client = _client_with_daily_token_limit(monkeypatch, limit=1)
    client.post("/api/v1/ai/ask", json={"message": "привет"})  # тратим весь бюджет

    res = client.post("/api/v1/ai/stream", json={"message": "привет ещё раз"})
    assert res.status_code == 429
    assert res.headers["content-type"] == "application/problem+json"


def test_ask_returns_429_after_daily_cost_budget_exhausted(monkeypatch) -> None:
    # Денежный лимит (а не только токенный) — стал реально проверяемым
    # только после того, как GIGACHAT_PRICE_*_PER_1K_USD перестали быть
    # нулём по умолчанию (см. app/config.py). Мок-ответ GigaChat — 32
    # токена вывода по дефолтной цене ~0.00256$/1K, т.е. около $0.00008 —
    # лимит на порядок меньше гарантированно превышается первым же ответом.
    settings = Settings(
        gigachat_mock=True,
        budget_default_daily_cost_usd=0.00001,
        tenant_budgets_file="no-such-tenants-file.json",
    )
    monkeypatch.setattr("app.main.get_settings", lambda: settings)
    client = TestClient(create_app())

    first = client.post("/api/v1/ai/ask", json={"message": "привет"})
    assert first.status_code == 200

    second = client.post("/api/v1/ai/ask", json={"message": "привет ещё раз"})
    assert second.status_code == 429
    assert second.json()["limit_kind"] == "cost_usd"
