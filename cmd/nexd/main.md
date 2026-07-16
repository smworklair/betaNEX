# cmd/nexd/main.go

Это точка входа и «композиционный корень» всего бэкенда NEX: единственное место, где читается конфигурация, создаются все конкретные реализации (Postgres или память, HTTP-сервер, планировщик и т.д.) и связываются друг с другом. Всё остальное в кодовой базе получает свои зависимости явно через параметры — нигде глубже в дереве вызовов нет обращений к глобальным переменным или `os.Getenv`.

## Ключевое

- `main()` — вызывает `run()`, при ошибке печатает её в stderr и завершает процесс кодом 1. Единственное место, вызывающее `os.Exit`.
- `run() error` — разбирает подкоманду (`serve`, `migrate` [`up`/`down`], `tenant`, `user`) и запускает соответствующую ветку; настраивает контекст, отменяемый по SIGINT/SIGTERM.
- `serve(ctx, cfg, log) error` — главная функция; сама читается как оглавление — последовательно вызывает helper'ы ниже и передаёт их результаты дальше в `httpapi.NewRouter`/`httpapi.New`/`runServers`. Само тело сборки живёт в helper'ах, а не в `serve`.
- `setupMetrics() (*metrics.Registry, observeFunc)` — реестр Prometheus-метрик (`/metrics`) и функция наблюдения за HTTP-запросами.
- `setupCache(cfg, log) ([]httpapi.ReadinessCheck, cleanup, error)` — backend кэша: memory по умолчанию, Redis при `NEX_CACHE_BACKEND=redis` (с проверкой соединения в `/readyz`).
- `buildPolicy() *authz.Policy` — RBAC-политика: единственное место, где роли (`admin`, `teacher`, `accountant`, `student`) получают права (`Perm*`-константы модулей).
- `infra` (тип) + `setupInfra(...) (infra, []httpapi.ReadinessCheck, cleanup, error)` — выбор хранилища: PostgreSQL (с миграциями, аудитом, идемпотентностью, файлами, аутентификацией, outbox) при заданном `NEX_DATABASE_URL`, иначе in-memory fallback для быстрых локальных прогонов без БД.
- `buildMounts(...) ([]func(*http.ServeMux), error)` — регистрирует команды и HTTP-маршруты finance/files всегда, а кампус/уведомления/задачи/терминал (через `buildPostgresModules`) — только когда доступен Postgres (`infra.pgDB != nil`).
- `postgresModules` (тип) + `buildPostgresModules(...) (postgresModules, error)` — кампус, уведомления, задачи и AI-терминал «Администратор · альфа»; здесь же собираются адаптеры (`terminal.Deps`) поверх конкретных репозиториев других модулей.
- `runServers(ctx, server, sched, outboxWorker) error` — HTTP-сервер, планировщик и outbox-воркер параллельно через `errgroup` до отмены `ctx`.
- `subcommand() string` — возвращает первый аргумент командной строки или `"serve"` по умолчанию.
- `sameSiteMode(v string) http.SameSite` — переводит строковое значение конфига (`lax`/`strict`/`none`) в тип `http.SameSite`.
- `taskNotifier` — маленький адаптер, который связывает модуль `tasks` с модулем `notifications`, переводя ошибку `notifications.ErrUserNotFound` в `tasks.ErrRecipientNotFound`. Существует, чтобы модули `tasks` и `notifications` не знали друг о друге напрямую.
- `tenantCmd(ctx, cfg, args) error` — CLI-подкоманда `nexd tenant create <slug> <имя>`, регистрирует новую организацию (tenant) в БД.
- `userCmd(ctx, cfg, args) error` — CLI-подкоманда `nexd user create --tenant ... --email ...`, создаёт пользователя с хэшированным паролем (генерирует случайный, если `NEX_USER_PASSWORD` не задан).

## Как это работает

`serve` последовательно вызывает helper'ы, каждый из которых отвечает за один шаг сборки: (1) `setupMetrics`/`setupCache` настраивают метрики Prometheus и backend кэша; (2) `buildPolicy` строит RBAC-политику `authz.Policy`, вручную прописывая, какая роль какие права получает — единственное на весь бэкенд место, где роли раздаются правам; (3) `setupInfra` в зависимости от `NEX_DATABASE_URL` либо подключается к Postgres и мигрирует схему, либо работает в памяти (только для быстрых локальных прогонов без БД), возвращая связку `infra{...}` и cleanup-функцию для `defer`; (4) `serve` создаёт `command.MemoryBus` — единственный путь изменения данных — и регистрирует хендлеры команд finance; (5) `buildMounts` (и внутри него `buildPostgresModules`) собирают HTTP-роуты каждого модуля в общий список `mounts`, который `serve` передаёт в `httpapi.NewRouter`; (6) `runServers` запускает HTTP-сервер, планировщик и outbox-воркер параллельно через `errgroup`, ожидая либо ошибки, либо отмены контекста (грациозное завершение по сигналу).

## Связи

Зависит практически от всего дерева: `internal/config`, весь `internal/kernel/*` (audit, auth, authz, command, tenancy), все `internal/module/*` (campus, files, finance, notifications, tasks, terminal), весь `internal/platform/*` (blob, cron, httpapi, logging, metrics, outbox, postgres) и `api` (embed OpenAPI). Ничто в проекте не зависит от `main.go` — это лист графа зависимостей, композиционный корень.

## На что обратить внимание

Модуль `terminal` (AI-консоль администратора) не имеет собственного знания о других модулях — все адаптеры (`Deps`) для доступа к задачам, пользователям, аудиту, группам/студентам, финансам собираются именно здесь, в `main.go`, через замыкания поверх конкретных репозиториев. Это сознательное архитектурное решение: терминал читает данные напрямую через репозитории других модулей, но любые мутации всё равно идут через `bus.Dispatch`, то есть проходят авторизацию и попадают в аудит наравне с обычными HTTP-запросами.
