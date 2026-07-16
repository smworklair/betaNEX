# NEX AI Gateway — учебный AI-шлюз (Python)

Учебный микросервис на Python: показывает, как вынести вызовы LLM
(Gemini, OpenAI, DeepSeek, Qwen, Kimi, GigaChat, YandexGPT) из фронтенда
на бэкенд — то, что в
[`docs/ai/README.md`](../docs/ai/README.md) описано как план для
Go-версии NEX (`internal/platform/llm`, ещё не реализован). Здесь тот
же принцип реализован рабочим кодом на Python — для практики.

**Это отдельный процесс со своими зависимостями** (не участвует в
сборке/тестах Go-модуля) — но, в отличие от более ранней версии этого
документа, он больше не самостоятелен в рантайме: браузер обращается не
сюда, а к `nexd`, который проксирует `/api/v1/ai/*` по внутренней сети
(см. `internal/platform/httpapi/aiproxy.go` и раздел «Аутентификация»
ниже). Соответствие с реальным (Go) AI-планом NEX, где сам вызов
провайдеров тоже переехал бы в Go, — по-прежнему только концептуальное;
см. `docs/ai/README.md`, §5.

## Зачем это нужно (проблема, которую решает шлюз)

Сегодня в NEX ключи AI-провайдеров живут в `localStorage` браузера, а
`fetch()` к Gemini/OpenAI-совместимому API уходит прямо из React SPA
(`web/src/llm.ts`). У этого подхода два системных недостатка:

1. **Ключ есть у каждого клиента** — его нельзя ни спрятать, ни отозвать
   централизованно, ни ограничить по бюджету.
2. **Нет единой точки для лимитов, аудита и таймаутов** — каждый
   браузер сам решает, сколько запросов слать и как долго ждать.

Перенос вызовов на бэкенд (пусть даже учебный) снимает оба пункта: ключ
сервера никогда не покидает процесс, а сервис может централизованно
считать запросы, применять таймауты и (в реальном проекте) вести аудит.

## Архитектура

```
Клиент (curl напрямую, для отладки — ИЛИ nexd, для реального трафика браузера)
        │  POST /api/v1/ai/ask  или  /api/v1/ai/stream
        │  заголовок X-Tenant-Id + (если настроен NEX_AI_GATEWAY_SECRET) X-Gateway-Secret
        │  Браузер сюда напрямую НЕ ходит в проде — см. «Аутентификация» ниже.
        ▼
┌────────────────────┐
│  api/routes.py       │  ← только разбор запроса и формирование ответа
└──────────┬───────────┘
           │ Depends: rate-limit + ПРЕД-проверка бюджета тенанта
           │ (budget_service.check) — до входа в обработчик
           ▼
┌────────────────────┐
│  services/            │  ← выбор провайдера, системный промпт,
│   ai_service.py         │    после ответа: budget_service.record(usage)
└──────────┬───────────┘
           │ провайдер — через интерфейс LLMProvider
           │ (выбран по полю provider в запросе либо DEFAULT_PROVIDER)
           ▼                                    ┌─────────────────────────┐
┌────────────────────┐                        │  services/                 │
│ providers/*.py        │                        │   budget_service.py          │
│  gemini · openai_compat│                        │   лимиты, оценка стоимости,  │
│  (openai/deepseek/qwen/│                        │   check()/record()           │
│   kimi/custom) · gigachat│                      └────────────┬────────────┘
│   · yandexgpt            │                                    │ потребление — через
└────────────────────┘                                     │ интерфейс BudgetStore
                                                             ▼
                                              ┌─────────────────────────┐
                                              │  core/budget_store.py       │
                                              │   in-memory за интерфейсом, │
                                              │   точка замены на Redis     │
                                              └─────────────────────────┘
```

Роутер не знает про конкретных провайдеров, сервис не знает про HTTP —
каждый слой можно менять независимо. Добавление нового провайдера =
новый файл в `app/providers/` (или новый набор параметров поверх уже
существующего `OpenAICompatProvider`, если провайдер OpenAI-совместим),
реализующий `LLMProvider` (`app/providers/base.py`), без изменений в
`routes.py` и `ai_service.py` (см. раздел «Провайдеры» ниже).

Контекст страницы (какой раздел фронтенда открыл мини-чат) устроен
похожим слоистым образом: `AskRequest.context` → `context_registry.py`
превращает `page`/`facts` в фрагмент системного промпта → `ai_service.py`
подмешивает его к `DEFAULT_SYSTEM_PROMPT`. Подробности и мотивация — в
[`docs/ai/README.md`](../docs/ai/README.md).

## Установка и запуск

Требуется Python 3.11+.

```sh
cd ai-gateway
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
# или: pip install -e .   (через pyproject.toml)

cp .env.example .env
# откройте .env и впишите хотя бы один ключ (GEMINI_API_KEY, OPENAI_API_KEY, ...)
# либо включите GIGACHAT_MOCK=true/YANDEXGPT_MOCK=true для дев-режима без реальных РФ-credentials

uvicorn app.main:app --reload --port 8090
```

Либо без uvicorn CLI:

```sh
python -m app.main
```

Проверка, что сервис жив:

```sh
curl http://localhost:8090/healthz
# {"status":"ok"}
```

Интерактивная документация API (Swagger UI) — на `http://localhost:8090/docs`.

## Эндпоинты

### `POST /api/v1/ai/ask` — обычный запрос, ждём полный ответ

```sh
curl -s http://localhost:8090/api/v1/ai/ask \
  -H "Content-Type: application/json" \
  -d '{"message": "Объясни в двух предложениях, что такое RBAC"}' | python -m json.tool
```

Ответ:

```json
{
  "text": "...",
  "provider": "gemini",
  "model": "gemini-2.5-flash",
  "usage": {"prompt_tokens": 12, "completion_tokens": 40, "total_tokens": 52}
}
```

С историей диалога и явным выбором провайдера:

```sh
curl -s http://localhost:8090/api/v1/ai/ask \
  -H "Content-Type: application/json" \
  -d '{
        "message": "А теперь то же самое проще",
        "provider": "custom",
        "history": [
          {"role": "user", "content": "Что такое RBAC?"},
          {"role": "assistant", "content": "Ролевая модель разграничения доступа."}
        ]
      }'
```

С контекстом страницы (мини-чат на разделе «Финансы» фронтенда) —
вместо явного `system` фронтенд шлёт `context`, сервер сам собирает
системный промпт из `app/core/context_registry.py`:

```sh
curl -s http://localhost:8090/api/v1/ai/ask \
  -H "Content-Type: application/json" \
  -d '{
        "message": "Кого предупредить в первую очередь?",
        "context": {
          "page": "finance",
          "title": "Финансовый ИИ",
          "facts": ["Задолженность 248000 ₽", "8 должников", "3 аномальных платежа"]
        }
      }'
```

### `GET /api/v1/ai/providers` — какие провайдеры реально настроены

```sh
curl -s http://localhost:8090/api/v1/ai/providers
# {"providers": ["gemini", "custom"], "default": "gemini"}
```

Используется фронтендом (`web/src/pages/Settings.tsx`) для выбора
провайдера — без хранения или проверки каких-либо ключей на клиенте.

### `POST /api/v1/ai/stream` — потоковый ответ (Server-Sent Events)

```sh
curl -N http://localhost:8090/api/v1/ai/stream \
  -H "Content-Type: application/json" \
  -d '{"message": "Перечисли по шагам, как устроена шина команд в NEX"}'
```

`-N` отключает буферизацию curl, чтобы видеть события по мере
поступления. Формат событий:

```
event: delta
data: {"text": "Ко"}

event: delta
data: {"text": "манда"}

event: usage
data: {"prompt_tokens": 18, "completion_tokens": 64, "total_tokens": 82}
```

При ошибке посреди стрима (ключ отозван, провайдер упал и т.п.) придёт
`event: error` — HTTP-статус к этому моменту уже 200 (стрим начался),
поэтому ошибка сообщается событием, а не сменой статус-кода.

### Идентификация тенанта и бюджет

Оба эндпоинта принимают заголовок `X-Tenant-Id`:

```sh
curl -s http://localhost:8090/api/v1/ai/ask \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: acme-college" \
  -d '{"message": "Привет"}'
```

Если заголовок не передан, запрос учитывается на тенанта `"default"`.
Когда настроен `NEX_AI_GATEWAY_SECRET` (см. «Аутентификация nexd↔ai-gateway»
ниже), этот заголовок доверенный — его подставляет только `nexd` из
настоящей сессии; запрос без верного `X-Gateway-Secret` получит `401`
ещё раньше, до всякой проверки бюджета. Без секрета (локальная
разработка) заголовок по-прежнему принимается как есть — как curl выше.
При исчерпании бюджета оба эндпоинта отвечают `429` ещё до обращения к
провайдеру (подробнее — раздел «Бюджеты по тенантам» ниже):

```json
{
  "type": "about:blank",
  "title": "tenant budget exceeded",
  "status": 429,
  "detail": "тенант 'acme-college' исчерпал бюджет на сутки по токенов: использовано 20000 из лимита 20000",
  "tenant_id": "acme-college",
  "period": "day",
  "limit_kind": "tokens",
  "limit": 20000,
  "used": 20000
}
```

## Конфигурация (`.env`)

Все переменные и их назначение — в [`.env.example`](.env.example).
Коротко:

| Переменная | Назначение |
|---|---|
| `*_API_KEY` (`GEMINI_`, `CUSTOM_`, `OPENAI_`, `DEEPSEEK_`, `QWEN_`, `KIMI_`) | Ключи провайдеров. Нужен хотя бы один — сервис не стартует без ни одного настроенного провайдера (либо мок-режима GigaChat/YandexGPT). |
| `GIGACHAT_AUTH_KEY` / `GIGACHAT_MOCK` | GigaChat: ключ авторизации либо мок-режим без сети, см. раздел «Провайдеры». |
| `YANDEXGPT_API_KEY` + `YANDEXGPT_FOLDER_ID` / `YANDEXGPT_MOCK` | YandexGPT: Api-Key + folder_id либо мок-режим. |
| `DEFAULT_PROVIDER` | Какой провайдер использовать, если клиент не указал `provider` в запросе. |
| `REQUEST_TIMEOUT_SECONDS` | Таймаут HTTP-запроса к провайдеру — защита от зависшего вызова. |
| `MAX_OUTPUT_TOKENS` | Верхний предел длины ответа — ограничивает и стоимость, и время ответа. |
| `RATE_LIMIT_PER_MINUTE` | Простой лимит запросов на один IP в минуту, см. ниже. |
| `CORS_ORIGINS` | Пусто по умолчанию = CORS выключен (безопаснее). |
| `NEX_AI_GATEWAY_SECRET` | Секрет, общий с `nexd` (то же имя переменной по обе стороны). Пусто = не проверяется (см. «Аутентификация nexd↔ai-gateway»). |
| `TENANT_BUDGETS_FILE` | Путь к JSON с персональными лимитами по тенантам, см. `tenants.example.json`. |
| `BUDGET_DEFAULT_*` | Лимит по умолчанию для тенантов вне файла (в т.ч. `"default"`). |
| `*_PRICE_INPUT_PER_1K_USD` / `*_PRICE_OUTPUT_PER_1K_USD` | Цена за 1000 токенов на провайдера — для лимитов в деньгах. |

## Безопасность и оптимизация — что сделано и почему

Сервис учебный, но собран по тем же принципам, что описаны как план для
Go-версии в `docs/ai/README.md`, §3:

- **Ключи только из окружения.** Ни один секрет не зашит в код;
  `Settings` (`app/config.py`) читает их из `.env`/переменных процесса.
  `.env` в `.gitignore`, в репозитории — только `.env.example` с
  пустыми значениями.
- **Таймауты на каждый внешний вызов.** И `complete()`, и `stream()`
  используют `httpx` с явным таймаутом (`REQUEST_TIMEOUT_SECONDS`) —
  зависший провайдер не подвесит запрос клиента навсегда.
- **Единый вид ошибок провайдера.** `app/providers/exceptions.py`
  превращает любую ошибку конкретного API (401, таймаут, пустой ответ)
  в один из немногих известных типов — сервис не разбирает коды ошибок
  каждого провайдера отдельно.
- **Ошибки — RFC 9457 (`problem+json`)**, тем же форматом, что и
  Go-бэкенд NEX (`internal/platform/httpapi/problem.go`) — см.
  `app/core/errors.py`.
- **Простой rate-limit** (`app/core/ratelimit.py`) — fixed-window
  счётчик в памяти процесса по IP. Явно помечен как учебное решение:
  при нескольких инстансах сервиса лимит не общий (нужен Redis или
  аналог), но для одного процесса демонстрирует сам механизм.
- **Ограничение размера ответа** — `MAX_OUTPUT_TOKENS` ограничивает
  и стоимость запроса, и то, сколько данных сервис держит в памяти
  ради одного ответа.
- **CORS выключен по умолчанию** — включается только явным списком
  origin'ов в `.env`, а не `allow_origins=["*"]`.
- **Бюджеты по тенантам** — токен- и cost-лимиты на сутки/месяц,
  проверяются до вызова провайдера. Подробности — раздел «Бюджеты по
  тенантам» ниже.

### Аутентификация nexd↔ai-gateway

Раньше `X-Tenant-Id` был чистой самоидентификацией клиента: браузер
слал его сам (или не слал вовсе), и ничто не мешало вписать туда
чужого тенанта, чтобы кататься на его бюджете. Теперь браузер до
`ai-gateway` вообще не достаёт — он ходит в `nexd` (`/api/v1/ai/*`, та
же cookie-сессия, что и весь остальной API), а `nexd`:

1. требует аутентифицированного актора (`requireActor` — без сессии
   `401`, ещё до `ai-gateway`);
2. берёт `tenant_id` из уже проверенной сессии, а не из тела запроса
   браузера;
3. подписывает исходящий запрос заголовком `X-Gateway-Secret` —
   значением `NEX_AI_GATEWAY_SECRET`, общим с `ai-gateway`.

`ai-gateway` со своей стороны (`app/deps.py:verify_gateway_secret`)
отклоняет запрос без верного `X-Gateway-Secret` заголовком `401`, если
у него самого настроен `NEX_AI_GATEWAY_SECRET` — **до** того, как
`X-Tenant-Id` вообще прочитается. Если секрет не настроен ни там, ни
там (локальная разработка без `nexd` рядом, `.env.example`) — поведение
как раньше: заголовок читается как есть, curl-примеры выше продолжают
работать без изменений.

Код прокси — `internal/platform/httpapi/aiproxy.go` (Go-сторона) и
`app/deps.py:verify_gateway_secret` (эта сторона).

### Что здесь сознательно НЕ сделано (и почему)

Это учебный сервис, а не прод-система, поэтому в нём всё ещё **нет**:

- RBAC (какая именно роль имеет право звать AI, а не только «есть
  сессия вообще») и аудита (кто и что спросил) в самом `ai-gateway` —
  в реальном NEX это дал бы command bus (см. `docs/architecture-go.md`,
  §4, §6) и то, что `docs/ai/README.md` называет «AI как актор шины
  команд». Сегодня это `requireActor` в `nexd` — «есть валидная
  сессия», без разбора по ролям;
- анонимизации ПДн и ru-restricted маршрута — то, что 152-ФЗ требует
  от реального продукта с российскими персональными данными
  (`docs/ai/README.md`, §3).

Если захочется прочувствовать и эти механизмы — они и есть следующий
шаг практики поверх этого шлюза.

## Бюджеты по тенантам (per-tenant budgets)

Каждый запрос относится к тенанту (`X-Tenant-Id`, см. выше), и у
каждого тенанта есть лимит на **токены** и/или **стоимость в $**, на
**сутки** и на **месяц** — четыре независимых измерения, любое можно не
ограничивать (`null`/не указано в файле).

### Откуда берутся лимиты

1. **Персонально по тенанту** — файл `tenants.json` (путь через
   `TENANT_BUDGETS_FILE`), формат — см. `tenants.example.json`:

   ```json
   {
     "acme-college": {
       "daily_tokens": 50000,
       "daily_cost_usd": 3.0,
       "monthly_tokens": 1000000,
       "monthly_cost_usd": 40.0
     },
     "demo-tenant": { "daily_tokens": 2000, "daily_cost_usd": 0.2 }
   }
   ```

2. **По умолчанию** (`BUDGET_DEFAULT_*` в `.env`) — для любого тенанта,
   которого в файле нет, включая синтетического `"default"` (запросы
   без заголовка `X-Tenant-Id`).

Если файла нет вовсе — все тенанты получают лимит по умолчанию из
`.env`; сервис не падает и не требует файла, чтобы просто запуститься.

### Как считается стоимость

`used_cost = prompt_tokens/1000 × price_in + completion_tokens/1000 × price_out`,
где цены — из `.env` (`GEMINI_PRICE_INPUT_PER_1K_USD` и т.п.), отдельно
для каждого провайдера. Если цены не заданы (по умолчанию — 0), деньги
всегда 0 и лимиты `*_cost_usd` не срабатывают — работают только
токен-лимиты. Это осознанный дефолт: реальные цены у каждого провайдера
свои и часто меняются, вписывать их «правильные» значения в код было
бы либо неверно, либо быстро устареет.

### Когда и как проверяется лимит

`BudgetService.check()` (`app/services/budget_service.py`) вызывается
через FastAPI `Depends` (`app/deps.py:enforce_budget`) **до** входа в
обработчик `/ask`/`/stream` — если лимит уже достигнут, провайдер вообще
не вызывается (экономит и деньги, и время). Проверяется уже
накопленное потребление, а не прогноз стоимости предстоящего запроса —
для LLM заранее не известно, сколько токенов уйдёт на ответ, поэтому
конкретный запрос может увести потребление немного за лимит; отклонён
будет уже следующий. `BudgetService.record()` вызывается из
`AIService` сразу после успешного ответа провайдера — там, где известен
настоящий `usage`.

### Сброс окна (день/месяц)

Не таймером и не фоновой задачей — лениво, при каждом обращении:
ключ текущего окна (`"2026-07-16"` для суток, `"2026-07"` для месяца)
сравнивается с сохранённым; если он изменился, счётчик этого окна
просто перезаводится с нуля. Значения за прошлые окна нигде не
сохраняются — для отчётности по расходам во времени нужна была бы
отдельная история, это уже вне рамок учебного сервиса.

### Хранилище потребления — абстракция, а не жёстко "in-memory"

`BudgetStore` (`app/core/budget_store.py`) — абстрактный интерфейс из
двух методов (`get_usage`, `add_usage`); `InMemoryBudgetStore` — его
единственная реализация, dict в памяти процесса с `asyncio.Lock` на
каждого тенанта. Это сознательно вынесено за интерфейс: для учебных
целей памяти процесса достаточно, но у неё есть жёсткая граница — при
нескольких инстансах сервиса за балансировщиком **или** при
`uvicorn --workers N` (несколько ОС-процессов на одной машине!) счётчик
не будет общим: у каждого процесса своя память, и тенант сможет
потратить N-кратный лимит, просто попадая на разные реплики/воркеры.
Прод-реализация — Redis (`INCRBYFLOAT` на ключ `"{tenant}:{window}"` +
`EXPIRE`) или БД; ей достаточно реализовать тот же протокол
`BudgetStore`, ничего в `BudgetService`/`AIService`/роутере менять не
придётся.

`asyncio.Lock` на тенанта защищает от гонки внутри одного процесса
(конкурентные `await`-корутины одного event loop), но НЕ от гонки между
процессами — то же ограничение, что и у `core/ratelimit.py`.

### Ручная проверка исчерпания лимита

```sh
# .env: BUDGET_DEFAULT_DAILY_TOKENS=50 — сознательно маленький лимит для теста
curl -s http://localhost:8090/api/v1/ai/ask -H "Content-Type: application/json" \
  -d '{"message": "привет"}'
# первые несколько запросов — 200 (пока не превышен лимит в 50 токенов)

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8090/api/v1/ai/ask \
  -H "Content-Type: application/json" -d '{"message": "привет ещё раз"}'
# 429, тело — problem+json с tenant_id/period/limit_kind/limit/used
```

## Провайдеры

| `provider` | Тип контракта | Auth | Обязательные переменные | Живьём проверено? |
|---|---|---|---|---|
| `gemini` | Google generativelanguage | заголовок `x-goog-api-key` | `GEMINI_API_KEY` | ✅ (штатный путь проекта) |
| `custom` | OpenAI-совместимый (свободный слот) | `Bearer` | `CUSTOM_API_KEY` | ✅ |
| `openai` | OpenAI-совместимый | `Bearer` | `OPENAI_API_KEY` | ⚠️ реализация стандартная, но не прогонялась с реальным ключом в этой среде |
| `deepseek` | OpenAI-совместимый | `Bearer` | `DEEPSEEK_API_KEY` | ⚠️ то же самое |
| `qwen` | OpenAI-совместимый (DashScope compatible-mode) | `Bearer` | `QWEN_API_KEY` | ⚠️ то же самое |
| `kimi` | OpenAI-совместимый (Moonshot) | `Bearer` | `KIMI_API_KEY` | ⚠️ то же самое |
| `gigachat` | **свой контракт**: OAuth2 client credentials + `/chat/completions` | `Authorization: Basic <auth key>` → токен → `Bearer` | `GIGACHAT_AUTH_KEY` (+ TLS-сертификат НУЦ Минцифры, см. ниже) | ❌ нет сети/реальных credentials в этой среде — реализовано строго по документации, покрыто тестами с замоканным httpx (`tests/test_provider_gigachat.py`) |
| `yandexgpt` | **свой контракт**: `foundationModels/v1/completion` | `Authorization: Api-Key <ключ>` + `x-folder-id` | `YANDEXGPT_API_KEY`, `YANDEXGPT_FOLDER_ID` | ❌ то же самое — см. `tests/test_provider_yandexgpt.py` |

`openai`/`deepseek`/`qwen`/`kimi`/`custom` — все конфигурации одного и
того же класса `OpenAICompatProvider` (`app/providers/openai_compat.py`)
с разными `base_url`/моделью/env-переменными — они OpenAI-совместимы, и
заводить отдельный класс на каждый не было смысла.

`gigachat` и `yandexgpt` — честно НЕ проверены живым вызовом (в этой
среде разработки нет сети до `ngw.devices.sberbank.ru` /
`llm.api.cloud.yandex.net` и реальных production-credentials). Контракт
реализован по официальной документации, юнит-тесты мокают HTTP на
транспортном уровне (`respx`) — проверяют URL/заголовки/тело запроса и
разбор ответа, но не гарантируют, что реальный API не изменился с
момента написания. Перед боевым использованием — прогнать вручную с
настоящими credentials.

**Мок-режим без реальных credentials.** `GIGACHAT_MOCK=true` /
`YANDEXGPT_MOCK=true` в `.env` регистрируют провайдер даже без ключей и
возвращают детерминированный текст-заглушку без единого сетевого
вызова — удобно, чтобы продемонстрировать выбор провайдера в UI без
доступа к реальным РФ-сервисам.

**TLS-сертификат GigaChat.** Сбер использует цепочку НУЦ Минцифры,
которой обычно нет в системном доверенном хранилище — без
`GIGACHAT_CA_BUNDLE` (путь к PEM корневого сертификата, публикуется на
Госуслугах) реальные вызовы будут падать с ошибкой TLS. `GIGACHAT_INSECURE_SKIP_VERIFY=true`
отключает проверку сертификата — только для дев-стенда, никогда не для прода.

### Добавить ещё одного провайдера

1. Если провайдер OpenAI-совместим — просто завести под него новый
   набор полей в `app/config.py` (`my_provider_api_key`, `_base_url`,
   `_model`) и создать в `app/main.py:_build_service()` ещё один
   экземпляр `OpenAICompatProvider(name="my_provider", ...)`.
2. Если контракт свой (как GigaChat/YandexGPT) — создать
   `app/providers/my_provider.py`, реализовать класс, наследующий
   `LLMProvider` (`app/providers/base.py`): методы `complete()` и
   `stream()`, плюс атрибут `name`.
3. В обоих случаях: добавить ключ в `ProviderName` (`app/api/schemas.py`)
   и зарегистрировать провайдер в `app/main.py:_build_service()` — если
   для него задан ключ (или включён мок-режим).

Роутер и сервис менять не нужно.

## Тесты

```sh
pip install -r requirements-dev.txt
pytest
```

Тесты не используют pytest-asyncio: `def test_...()` сами вызывают
`asyncio.run(...)` внутри — так не нужна лишняя зависимость ради
нескольких тестов (см. пояснение в шапке `tests/test_budget_service.py`).

| Файл | Что проверяет |
|---|---|
| `test_budget_service.py` | исчерпание лимита по токенам и по деньгам, сброс дневного/месячного окна, тенант без персонального лимита, параллельные `record()` |
| `test_provider_openai_compat.py` | общий контракт `openai`/`deepseek`/`qwen`/`kimi`/`custom`: успешный ответ, 401→ProviderAuthError, пустой ответ, retry на 5xx (и НЕ retry на 4xx) |
| `test_provider_gigachat.py` | OAuth-флоу и кэширование токена, обновление токена перед истечением, 403 на OAuth, мок-режим без сети |
| `test_provider_yandexgpt.py` | контракт запроса (modelUri/заголовки), пустой ответ, **стриминг с накопленным текстом → корректные дельты**, мок-режим |
| `test_context_registry.py` | сборка системного промпта из `PageContext`: известный/неизвестный раздел, факты, состояние экрана |
| `test_ai_service_system_prompt.py` | приоритет явного `system` над `context`, фолбэк на `DEFAULT_SYSTEM_PROMPT` |

Тесты провайдеров мокают `httpx` на транспортном уровне через
[`respx`](https://lundberg.github.io/respx/) (см. `requirements-dev.txt`) —
проверяется реальный HTTP-контракт (URL, заголовки, тело запроса), а не
переписанный под тест клиент.

## Структура файлов

```
ai-gateway/
├── app/
│   ├── main.py                 # сборка FastAPI-приложения, регистрация провайдеров и бюджетов
│   ├── config.py                # Settings — конфиг из переменных окружения
│   ├── deps.py                   # Depends: сервис, rate-limiter, тенант, пред-проверка бюджета
│   ├── api/
│   │   ├── routes.py              # /api/v1/ai/ask, /api/v1/ai/stream, /api/v1/ai/providers, /healthz
│   │   └── schemas.py             # Pydantic-модели запроса/ответа, включая PageContext
│   ├── services/
│   │   ├── ai_service.py           # выбор провайдера, системный промпт (+ context), ошибки, запись usage
│   │   └── budget_service.py        # лимиты по тенантам: проверка и учёт потребления
│   ├── providers/
│   │   ├── base.py                  # интерфейс LLMProvider + общие типы
│   │   ├── gemini.py                # клиент к Gemini
│   │   ├── openai_compat.py         # клиент к OpenAI-совместимому API (openai/deepseek/qwen/kimi/custom)
│   │   ├── gigachat.py              # клиент к GigaChat: OAuth2 + сертификаты РФ
│   │   ├── yandexgpt.py             # клиент к YandexGPT: Api-Key + folder_id
│   │   └── exceptions.py            # единые ошибки провайдера
│   └── core/
│       ├── ratelimit.py              # fixed-window rate-limit
│       ├── retry.py                   # retry с экспоненциальной задержкой для транзиентных сбоев
│       ├── context_registry.py        # реестр системных промптов по разделам фронтенда
│       ├── budget_store.py            # хранилище потребления: интерфейс + in-memory реализация
│       ├── errors.py                 # problem+json обработчики ошибок
│       └── logging.py                # настройка логов
├── tests/
│   ├── test_budget_service.py           # юнит-тесты бюджетов
│   ├── test_provider_openai_compat.py    # openai/deepseek/qwen/kimi/custom
│   ├── test_provider_gigachat.py         # GigaChat: OAuth, кэш токена, мок-режим
│   ├── test_provider_yandexgpt.py        # YandexGPT: контракт, стриминг-дельты, мок-режим
│   ├── test_context_registry.py          # сборка системного промпта из PageContext
│   └── test_ai_service_system_prompt.py  # приоритет system над context
├── .env.example
├── .gitignore
├── pyproject.toml
├── requirements.txt
├── requirements-dev.txt
├── tenants.example.json         # пример персональных лимитов по тенантам
└── README.md
```

## Связанные документы

- [`docs/ai/README.md`](../docs/ai/README.md) — текущее (frontend-only)
  и планируемое (Go) состояние AI-архитектуры NEX; этот сервис — учебная
  реализация того же плана на Python.
- [`docs/architecture-go.md`](../docs/architecture-go.md) — архитектура
  Go-бэкенда NEX, включая раздел про безопасность (§6), с которым
  сознательно перекликается формат ошибок этого сервиса.
- [`web/src/llm.ts`](../web/src/llm.ts) — фронтенд-код, чьи HTTP-вызовы
  к Gemini/OpenAI-совместимому API этот сервис повторяет на бэкенде.
