# load/ — нагрузочные смоук-тесты (k6)

Дополняет `tools/api_smoke.py`: тот проверяет поведение (команды, статусы
ошибок), `smoke.js` меряет латентность и долю ошибок под умеренной
нагрузкой — на `/healthz` и на реальных бизнес-эндпоинтах (задачи,
студенты, группы, финансовые счета, непрочитанные уведомления).

Нужен [k6](https://k6.io/docs/get-started/installation/).

## Подготовка

```sh
make dev && make run                          # Postgres + nexd
go run ./cmd/nexd tenant create college-1 "Колледж №1"
make seed                                      # необязательно: непустые ответы GET
```

## Запуск

Два режима аутентификации — `AUTH_MODE` (подробности и обоснование см. в
шапке `smoke.js`):

```sh
# dev-режим (по умолчанию) — заголовки X-Dev-*, требует NEX_ENV=development
# на сервере (умолчание `make run`). Без создания реального пользователя.
make smoke-load
# или напрямую:
k6 run load/smoke.js

# session-режим — настоящий вход POST /api/v1/auth/login, для окружений
# без DevAuth (staging и т.п.). Нужен реальный пользователь:
go run ./cmd/nexd user create --tenant college-1 --email demo@college-1.test --role admin

BASE_URL=https://staging.example.com \
AUTH_MODE=session NEX_TENANT=college-1 \
NEX_EMAIL=demo@college-1.test NEX_PASSWORD=<пароль из user create> \
  k6 run load/smoke.js
```

Пороги (`options.thresholds` в `smoke.js`): `/healthz` — p95 < 100мс (без
обращения к БД); бизнес-эндпоинты — p95 < 400мс (ходят в Postgres);
доля HTTP-ошибок — < 1% в обоих случаях.
