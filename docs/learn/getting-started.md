# Getting started: с чего начать практически

Практический онбординг — как поднять проект и потрогать его руками, а
не как он устроен внутри (за этим — [`backend-go.md`](backend-go.md),
[`frontend-web.md`](frontend-web.md), [`ai-stack.md`](ai-stack.md)).
Все команды проверены по актуальным `README.md`, `Makefile`,
`compose.yaml` и `.env.example` файлам репозитория.

## 0. Выбор пути

Два способа поднять проект — выберите один в зависимости от того, что
у вас уже установлено:

| Путь | Нужно на машине | Когда выбрать |
|---|---|---|
| **A. Всё в Docker** (`make stack`) | только Docker | быстрее всего начать, не хочется ставить Go/Node/Python локально |
| **B. Из исходников** (`make dev` + `make run`) | Go 1.25+, PostgreSQL (или Docker для него), Node 20 + pnpm, Python 3.11+ | пишете код и хотите hot-reload/дебаггер |

Не запускайте оба одновременно — `dev`+`run` и `stack` оба занимают
порт 8080.

## Путь A: всё в Docker (самый быстрый старт)

```sh
git clone <repo-url> nex && cd nex
make stack        # postgres + nexd + web (Vite dev) + ai-gateway
```

Через несколько секунд доступны:

- фронтенд — http://localhost:3000
- `nexd` — http://localhost:8080/healthz → `{"status":"ok"}`
- `ai-gateway` — http://localhost:8090/healthz (в контейнере в
  мок-режиме GigaChat/YandexGPT по умолчанию — без единого реального
  ключа провайдера, см. [`ai-stack.md`](ai-stack.md))

```sh
make stack-down    # остановить всё
```

Это оптимально для первого знакомства с UI, но неудобно для правки
Go-кода (нет hot-reload бэкенда) — для этого переходите к пути B.

## Путь B: из исходников (для разработки)

### 1. Бэкенд (nexd)

```sh
cp .env.example .env      # все переменные опциональны, дефолты разумны
make dev                  # поднимает только Postgres (docker compose)
make run                  # go run ./cmd/nexd — слушает :8080
```

Без `NEX_DATABASE_URL` `nexd` тоже запустится — в **in-memory режиме**
(данные теряются при перезапуске, удобно для быстрого взгляда, не для
разработки модулей с Postgres). Хотите hot-reload вместо `make run` —
`make watch` (нужен `air`, см. `../dev-tools.md`).

Первый tenant и админ (бэкенд не создаёт демо-данные сам):

```sh
go run ./cmd/nexd tenant create college-1 "Колледж №1"
NEX_USER_PASSWORD=demo12345 go run ./cmd/nexd user create \
  --tenant college-1 --email admin@example.ru --name "Админ" --role admin
```

Проверка:

```sh
curl http://localhost:8080/healthz    # {"status":"ok"}
curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"tenant":"college-1","email":"admin@example.ru","password":"demo12345"}' -i
```

Наполнить демо-данными через тот же API, которым пользуется UI:

```sh
python3 tools/seed_demo.py --groups 3 --students-per-group 5 --tasks 20
```

### 2. Фронтенд (web)

```sh
cd web
cp .env.example .env   # можно оставить пустым для локальной разработки
pnpm install
pnpm dev                # http://localhost:3000
```

С пустым `VITE_API_URL` Vite-прокси (`vite.config.ts`) сам направляет
`/api/*` на `http://localhost:8080` — CORS настраивать не нужно, фронт
и бэк работают как один origin в браузере. Без запущенного `nexd`
фронтенд тоже откроется — все экраны просто покажут встроенные моки
(демо-режим по умолчанию).

### 3. AI-gateway (опционально — нужен только для настоящих ответов ИИ)

```sh
cd ai-gateway
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env
# впишите хотя бы один ключ (GEMINI_API_KEY/OPENAI_API_KEY/...)
# или для запуска без ключей: echo "GIGACHAT_MOCK=true" >> .env
uvicorn app.main:app --reload --port 8090
```

Чтобы фронтенд реально пошёл в `ai-gateway` (через `nexd`), а не в
локальный мок-движок, дозаполните оба `.env`:

```sh
# .env (корень, для nexd) — раскомментировать:
NEX_AI_GATEWAY_URL=http://localhost:8090

# web/.env:
VITE_AI_ENABLED=1
```

и перезапустите `nexd`. Без этих двух строк всё продолжает работать —
ИИ просто отвечает детерминированными моками (`nexbrain.ts`), сеть не
трогается.

## Переменные окружения — где что искать

| Файл | Что конфигурирует | Обязательно? |
|---|---|---|
| `.env` (корень, от `.env.example`) | `nexd`: адрес, БД, сессии, кэш, AI-прокси | нет — все переменные опциональны |
| `web/.env` (от `web/.env.example`) | Фронтенд: `VITE_API_URL`, `VITE_AI_ENABLED` | нет |
| `ai-gateway/.env` (от `ai-gateway/.env.example`) | Ключи провайдеров, бюджеты, rate-limit, `NEX_AI_GATEWAY_SECRET` | да, если хотите настоящие ответы ИИ |
| `deploy/.env` (от `deploy/.env.example`) | Прод-деплой (домен, пароль БД, секреты) | только для `deploy/README.md` |

Полная таблица переменных `nexd` с дефолтами — в корневом
[`../../README.md`](../../README.md), раздел «Configuration».

## 4. Тесты

```sh
# Go — юниты с race-детектором (без Postgres, интеграционные тесты честно скипаются)
make test

# Go — юниты + интеграционные против Postgres (нужен запущенный make dev)
make test-db

# Фронтенд — Vitest
cd web && pnpm test

# ai-gateway — pytest
cd ai-gateway && pip install -r requirements-dev.txt && pytest
```

`make lint` (golangci-lint, откатывается на `go vet` если не
установлен) и `make vuln` (govulncheck) — то же самое, что гоняет CI
(`.github/workflows/ci.yml`), полезно прогнать локально перед PR.

## 5. Полезные dev-утилиты

- **`tools/api_smoke.py`** (`make smoke-api`) — сквозной функциональный
  сценарий по API (создание, поиск, ошибки валидации); ненулевой код
  выхода при провале — можно вешать в CI поверх поднятого окружения.
- **`tools/nex_api.py`** — мини-клиент API с dev-авторизацией
  (`X-Dev-*` заголовки, работают только в `NEX_ENV=development`) —
  удобная основа для собственных скриптов.
- **`load/smoke.js`** (`make smoke-load`, нужен k6) — нагрузочный
  смоук-тест, см. `../../load/README.md`.
- **Bruno-коллекция** (`api/bruno/`) — запросы к API как файлы в
  репозитории (не облачный Postman) — открывается приложением Bruno.
- **`nexd migrate`** / `nexd migrate down` (или `make migrate`/
  `make migrate-down`) — применить/откатить SQL-миграции вручную,
  подробности — `../../migrations/README.md`.

## 6. Локальная наблюдаемость (по желанию)

```sh
curl -s http://localhost:8080/metrics    # метрики nexd (Prometheus-формат)
curl -s http://localhost:8090/metrics    # метрики ai-gateway
docker compose --profile observability up -d prometheus   # UI: http://localhost:9090
```

Подробнее — `../observability.md`.

## Частые проблемы на старте

- **`nexd` падает на старте с ошибкой БД** — проверьте, что
  `make dev` реально поднял Postgres (`docker compose ps`) и что
  `NEX_DATABASE_URL` совпадает с портом/паролем в `compose.yaml`
  (по умолчанию `postgres://nex:nex@localhost:5432/nex?sslmode=disable`).
- **Фронтенд показывает только моки, хотя `nexd` запущен** — это
  ожидаемо для большинства экранов (см. [`frontend-web.md`](frontend-web.md), §4) —
  реально подключены только вход, задачи, студенты/группы.
- **Ответы ИИ всегда одинаковые/шаблонные** — вероятно,
  `VITE_AI_ENABLED` не выставлен или `ai-gateway` не запущен: это
  штатный фолбэк на `nexbrain.ts`, не баг.
- **`401` при прямом `curl` на `/api/v1/ai/ask` через `nexd`** — прокси
  требует аутентифицированного актора (сессионную cookie); проверяйте
  через залогиненный фронтенд или сначала выполните `POST
  /api/v1/auth/login` и переиспользуйте cookie в `curl -c/-b`.

## Что дальше

Проект запущен и отвечает — самое время читать не наугад, а по
маршруту: [`how-to-read-and-learn.md`](how-to-read-and-learn.md).
