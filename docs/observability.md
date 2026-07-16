# Наблюдаемость: логи, request-id, метрики, кэш

Статус: базовый уровень наблюдаемости (M10 из `docs/roadmap.md` ещё не
закрыта целиком — здесь нет Grafana/Loki/алертов, только то, что описано
ниже). Ничего из этого не обязательно поднимать, чтобы `docker compose
up` продолжал работать как раньше — все опции ниже включаются отдельно.

## 1. Структурные логи и request-id

И `nexd`, и `ai-gateway` пишут логи в JSON, одна строка — один объект,
с обязательными полями `time`/`level`/`msg` и, для строк внутри
обработки запроса, — `request_id`.

Сквозной `request_id`:

1. Браузер отправляет запрос в `nexd` (без `X-Request-Id` — это
   внутренний идентификатор, наружу браузер его не знает).
2. `nexd` генерирует `request_id` (или берёт от апстрим-прокси, если он
   уже проставлен) — см. `internal/platform/httpapi/requestid.go`.
   Он попадает в каждую строку лога `nexd` для этого запроса
   (`requestLogger`, `recoverer`, `problem.go`) и в заголовок ответа
   клиенту.
3. Если запрос идёт дальше в `ai-gateway` (`/api/v1/ai/*`), `nexd`
   пробрасывает тот же `request_id` заголовком `X-Request-Id` —
   см. `internal/platform/httpapi/aiproxy.go`.
4. `ai-gateway` принимает этот `request_id` (`app/core/request_id.py`),
   использует его в своих логах и возвращает тем же заголовком.

Итог: один и тот же `request_id` в логах `nexd` и `ai-gateway` для
одного пользовательского запроса — инцидент ищется по нему в обеих
частях системы, не только по времени.

Логи не содержат секретов и ПДн: тело запроса, заголовки авторизации,
текст сообщений/промптов в лог не попадают — только маршрут, статус,
длительность, request_id и (для `ai-gateway`) tenant_id/имя провайдера.

Посмотреть локально:

```sh
docker compose up -d nexd ai-gateway
docker compose logs -f nexd ai-gateway
```

## 2. Метрики Prometheus

Оба сервиса отдают метрики в текстовом формате Prometheus без
дополнительной настройки:

```sh
curl -s http://localhost:8080/metrics   # nexd
curl -s http://localhost:8090/metrics   # ai-gateway
```

`nexd` (`internal/platform/metrics`, без внешних зависимостей):

- `nex_http_requests_total{route,status}`, `nex_http_request_duration_seconds{route,status}`;
- `nex_goroutines`, `nex_heap_alloc_bytes` (рантайм);
- `nex_db_pool_total_conns`/`nex_db_pool_idle_conns` (пул Postgres).

`ai-gateway` (`ai-gateway/app/core/metrics.py`, `prometheus_client`):

- `aigw_http_requests_total{route,status}`, `aigw_http_request_duration_seconds{route,status}`;
- `aigw_provider_requests_total{provider,outcome}` — `outcome`:
  `success` | `error` | `cache_hit` | `fallback` (успешный ответ не с
  первого провайдера цепочки помечается ОБОИМИ `success` и `fallback`);
- `aigw_provider_tokens_total{provider,kind}` — `kind`: `prompt` | `completion`;
- `aigw_provider_cost_usd_total{provider}` — оценочная стоимость (см.
  `BudgetService.estimate_cost`, те же цены, что и в бюджетах тенантов).

Ни одна метрика не размечена по `tenant_id` — это дало бы неограниченно
растущее число рядов с ростом числа тенантов.

### Локальный Prometheus (опционально)

```sh
docker compose --profile observability up -d prometheus
```

UI: http://localhost:9090 — таргеты `nexd`/`ai-gateway`,
`Status → Targets` должен показывать оба `UP`. Конфиг —
`observability/prometheus.yml`. Это не прод-стек наблюдаемости (тот —
отдельная веха, `docs/roadmap.md`, M10, с Grafana/Loki/алертами),
только локальный просмотр метрик через PromQL.

## 3. Кэш: memory / Redis

`internal/platform/cache` (Go) и `ai-gateway/app/core/{ratelimit,response_cache}.py`
(Python) по умолчанию работают в памяти процесса (см. ADR-008 в
`docs/decision-log.md`) — поведение не меняется, пока не включено явно.

Сетевой backend (Redis-совместимый — Valkey в `compose.yaml`, RESP-протокол
общий с Redis):

```sh
docker compose --profile cache up -d valkey
```

и в `.env` рядом с `compose.yaml`:

```sh
NEX_CACHE_BACKEND=redis
NEX_REDIS_URL=redis://valkey:6379/0
AI_CACHE_BACKEND=redis
AI_REDIS_URL=redis://valkey:6379/1
```

Проверка: `curl -s http://localhost:8080/readyz` — при
`NEX_CACHE_BACKEND=redis` и недоступном Redis `nexd` честно отдаёт `503`
с причиной (`redis: dial tcp ...`), а не молча деградирует.
