"""
Метрики Prometheus — эндпоинт `GET /metrics` в текстовом формате
Prometheus, через штатную клиентскую библиотеку `prometheus_client`
(тот же принцип, что и на Go-стороне — internal/platform/metrics/
metrics.go: минимум зависимостей, никакого тяжёлого стека; поднимать ли
рядом сам Prometheus/Grafana — решение эксплуатации, не кода, см.
compose.yaml, профиль `observability`).

Что считаем:
- HTTP-запросы (число, латентность) по маршруту и статусу — общая
  наблюдаемость сервиса, симметрично nexd
  (nex_http_requests_total/nex_http_request_duration_seconds).
- Провайдерские метрики — то, что не видно из общих HTTP-метрик: КАКОЙ
  провайдер обслужил запрос, сработал ли fallback на резервный
  провайдер, был ли кэш-хит, сколько токенов и денег это стоило.

Кардинальность меток нарочно низкая: route/status/provider/outcome/kind —
конечные, известные заранее множества значений. tenant_id НИГДЕ не
используется как метка — с ростом числа тенантов он дал бы
неограниченно растущее число рядов метрики (то же правило, что и в
route-метках Go-стороны, см. httpapi/observe.go).
"""

from __future__ import annotations

import time

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

HTTP_REQUESTS_TOTAL = Counter(
    "aigw_http_requests_total", "Число HTTP-запросов к ai-gateway.", ["route", "status"]
)
HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "aigw_http_request_duration_seconds", "Латентность HTTP-запросов к ai-gateway, секунды.", ["route", "status"]
)

# outcome: success | error | cache_hit | fallback (fallback может идти
# ВМЕСТЕ с success для того же провайдера — это не взаимоисключающие
# исходы, а два разных вопроса: "обслужил ли провайдер запрос успешно"
# и "было ли это обращение к нему через автопереключение с другого".
PROVIDER_REQUESTS_TOTAL = Counter(
    "aigw_provider_requests_total", "Число обращений к провайдеру LLM по исходу.", ["provider", "outcome"]
)
# kind: prompt | completion
PROVIDER_TOKENS_TOTAL = Counter(
    "aigw_provider_tokens_total", "Число токенов по провайдеру и виду.", ["provider", "kind"]
)
PROVIDER_COST_USD_TOTAL = Counter(
    "aigw_provider_cost_usd_total", "Оценочная стоимость запросов по провайдеру, $.", ["provider"]
)


def observe_http_request(route: str, status: int, duration_seconds: float) -> None:
    status_label = str(status)
    HTTP_REQUESTS_TOTAL.labels(route=route, status=status_label).inc()
    HTTP_REQUEST_DURATION_SECONDS.labels(route=route, status=status_label).observe(duration_seconds)


def record_provider_outcome(provider: str, outcome: str) -> None:
    PROVIDER_REQUESTS_TOTAL.labels(provider=provider, outcome=outcome).inc()


def record_provider_usage(provider: str, prompt_tokens: int, completion_tokens: int, cost_usd: float) -> None:
    if prompt_tokens:
        PROVIDER_TOKENS_TOTAL.labels(provider=provider, kind="prompt").inc(prompt_tokens)
    if completion_tokens:
        PROVIDER_TOKENS_TOTAL.labels(provider=provider, kind="completion").inc(completion_tokens)
    if cost_usd:
        PROVIDER_COST_USD_TOTAL.labels(provider=provider).inc(cost_usd)


def metrics_response() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


class MetricsMiddleware(BaseHTTPMiddleware):
    """Пишет aigw_http_requests_total/aigw_http_request_duration_seconds на каждый запрос.

    Маршруты в этом сервисе статичны (без ID в пути, см. api/routes.py) —
    в отличие от Go-стороны, шаблон маршрута не нужно доставать из
    роутера отдельно, request.url.path и есть шаблон.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        start = time.monotonic()
        response = await call_next(request)
        observe_http_request(request.url.path, response.status_code, time.monotonic() - start)
        return response
