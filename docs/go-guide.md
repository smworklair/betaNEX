# Go в NEX: инженерное руководство

Это рабочая документация по языку Go применительно к этому проекту. Не учебник Go — учебные ссылки в `learning/resources.md`. Здесь — как мы пишем NEX: решения, паттерны и код, который **уже работает в репозитории**. Всё согласовано с `docs/decision-log.md` (ADR-001…021) и реальной кодовой базой (`internal/kernel`, `internal/module/finance`, `internal/platform/*`).

**Правило чтения:** если код в этом гайде расходится с кодом в репозитории — прав репозиторий, а гайд надо поправить PR'ом.

**Состояние на момент этой редакции:** вехи M0–M3 реализованы. Postgres-слой, транзакционная шина команд с аудитом, RLS с негативными тестами и настоящая аутентификация — это не планы, а код в `main`. Разделы про River, AI, pgvector, госинтеграции и филиалы — по-прежнему проектные (roadmap), они помечены.

## Оглавление

1. [Философия](#1-философия)
2. [Архитектура проекта](#2-архитектура-проекта)
3. [Структура модуля](#3-структура-модуля)
4. [HTTP-стек](#4-http-стек)
5. [Библиотеки](#5-библиотеки)
6. [PostgreSQL: pgx + sqlc + goose](#6-postgresql)
7. [Мультитенантность: от заголовка до строки таблицы](#7-мультитенантность)
8. [Шина команд и транзакционный аудит](#8-шина-команд-и-транзакционный-аудит)
9. [Аутентификация и сессии](#9-аутентификация-и-сессии)
10. [pgvector: embeddings и RAG *(roadmap)*](#10-pgvector-roadmap)
11. [Кэш: in-process → Valkey *(roadmap)*](#11-кэш-roadmap)
12. [Конфигурация](#12-конфигурация)
13. [Логирование (slog)](#13-логирование)
14. [Ошибки](#14-ошибки)
15. [Конкурентность и контексты](#15-конкурентность-и-контексты)
16. [Тестирование](#16-тестирование)
17. [Очереди и фоновые задачи: River *(roadmap)*](#17-river-roadmap)
18. [AI-интеграция: LLM не как чатик *(roadmap)*](#18-ai-интеграция-roadmap)
19. [Стриминг (SSE) *(roadmap)*](#19-стриминг-roadmap)
20. [Безопасность](#20-безопасность)
21. [Observability](#21-observability)
22. [Производительность](#22-производительность)
23. [Масштабирование](#23-масштабирование)
24. [Docker / Kubernetes](#24-docker--kubernetes)
25. [CI/CD](#25-cicd)
26. [Чек-лист «прежде чем открыть PR»](#26-чек-лист)
27. [Оптимизация под слабое железо](#27-оптимизация-под-слабое-железо)
28. [Миграция с 1С и Битрикс *(roadmap)*](#28-миграция-с-1с-roadmap)
29. [Дорожная карта модулей](#29-дорожная-карта-модулей)
30. [Интеграции с госсистемами *(roadmap)*](#30-госинтеграции-roadmap)
31. [Отчётность и печатные формы *(roadmap)*](#31-отчётность-roadmap)
32. [Филиалы и offline-режим *(roadmap)*](#32-филиалы-и-offline-roadmap)
33. [Экономика внедрения (TCO)](#33-экономика-внедрения-tco)

---

## 1. Философия

**Почему Go (ADR-001).** NEX — модульный монолит: один статический бинарник `nexd`, встроенная конкурентность, быстрая компиляция, обратная совместимость Go 1.x на годы вперёд. Для долгоживущего ядра КИС это важнее «выразительности».

**Как мы пишем — четыре правила, из которых следует всё остальное:**

1. **stdlib-first.** Зависимость добавляется, только когда stdlib реально не хватает, и это фиксируется в ADR. `net/http`, `log/slog`, `context`, `errors`, `testing`, `encoding/json` покрывают 80% проекта. Текущий список прямых зависимостей — ровно три: `pgx/v5` (драйвер БД), `goose/v3` (миграции), `x/crypto` (argon2id). Всё.
2. **Зависимости направлены внутрь.** `cmd → module → kernel`; kernel не импортирует ничего из проекта выше себя. Модули не импортируют друг друга. Нарушение — ошибка архитектуры, а не стиля.
3. **Интерфейсы объявляет потребитель, а не поставщик.** `command.Authorizer` объявлен в пакете `command`, реализован в `authz` — поэтому `command` не зависит от `authz`. Тот же приём: `command.TxRunner` объявлен в `command`, реализован `postgres.DB`; `auth.Store` объявлен в `kernel/auth`, реализован `postgres.AuthStore`. Это ключевой механизм удержания зависимостей внутрь.
4. **Явное лучше неявного.** Никаких глобалей, `init()`-магии, скрытых синглтонов. Всё конструируется в композиционном корне (`cmd/nexd/main.go`) и передаётся вниз явно.

**Форматирование и стиль:** gofumpt (строже gofmt), golangci-lint (конфиг `.golangci.yml`; линт обязан быть зелёным — ноль замечаний, включая revive и gosec). Именование — по Go Code Review Comments и Google Go Style Guide. Комментарии в новых пакетах — на русском (правило проекта, см. CONTRIBUTING); package-комментарий обязан начинаться с `Package <имя>` — этого требует revive, дальше текст свободный.

**Go-версия:** объявлена в `go.mod` (`go 1.25.7`). Старший тулчейн докачивается автоматически (`GOTOOLCHAIN=auto`) — разработчику с Go 1.24+ ничего делать не надо. CI берёт версию из `go.mod` (`setup-go` с `go-version-file`). Обновление версии — отдельный PR: свежие pgx/goose подняли требование до 1.25, это зафиксировано в истории.

## 2. Архитектура проекта

**Почему модульный монолит, а не микросервисы и не 1С-клиент-сервер.** Целевой заказчик — колледж с одним админом и сервером уровня «школьная серверная» (4–8 ГБ RAM, 2–4 vCPU). Из этого следует всё:

- **Не микросервисы.** Микросервисы платят за независимое масштабирование сетевыми вызовами, распределёнными транзакциями, отдельными деплоями и наблюдаемостью каждого сервиса. У колледжа нет нагрузки, которая это оправдывает. Аргумент в операционной простоте: монолит — один файл `nexd`, один сервис systemd, один лог, один порт, один бэкап БД. Обновление — заменить файл и перезапустить. Диагностика — `journalctl -u nexd` и `/healthz`. Это уровень, сопровождаемый силами одного невыделенного человека.
- **Не 1С-клиент-сервер.** 1С требует лицензий, толстого клиента, Windows-сервера и «одинэсника». NEX — web-first: клиент это браузер, сервер это один статический бинарник Go под Linux на дешёвом VPS.
- **Но модульный** — границы модулей проведены тремя правилами (модуль зависит только от kernel/platform; модули не импортируют друг друга; межмодульная связь — только через доменные события), поэтому вынос модуля в отдельный процесс — смена транспорта событий и новый композиционный корень, а не переписывание.

**Три уровня, зависимости строго внутрь:**

```
cmd/nexd/            композиционный корень + CLI-подкоманды
  main.go            ← единственное место, где всё «склеивается»
migrations/          SQL-миграции goose, embed в бинарник
internal/kernel/     доменно-независимое ядро
  identity/          кто актор (Actor в контексте)
  tenancy/           в каком tenant'е (TenantID в контексте)
  authz/             что разрешено (RBAC-политика + PolicyAuthorizer)
  auth/              аутентификация: argon2id, сессии, Store-интерфейс
  command/           шина: Validate → Authorize → [Tx: Handle → Audit]
  event/             доменные события
  audit/             append-only журнал (Recorder-интерфейс)
internal/module/     доменные модули (finance; позже campus/admissions/…)
internal/platform/   адаптеры инфраструктуры
  httpapi/           HTTP-транспорт: роутер, middleware, auth-endpoints, problem+json
  logging/           конструирование slog
  postgres/          пул pgx, tenant-транзакции, миграции, sqlc-код (db/), Store'ы
```

**Композиционный корень — сердце архитектуры.** Всё живёт в `run()` (не в `main()`, чтобы возвращать ошибку, а не `os.Exit`). Реальный `cmd/nexd/main.go` сегодня выглядит так (сокращено):

```go
func serve(ctx context.Context, cfg config.Config, log *slog.Logger) error {
    // RBAC-политика: модули объявляют права, корень раздаёт их ролям.
    policy := authz.NewPolicy()
    for _, perm := range []string{finance.PermAccountsWrite, finance.PermEntriesPost} {
        policy.Grant("admin", perm)
        policy.Grant("accountant", perm)
    }

    // Хранилище: Postgres, если задан NEX_DATABASE_URL, иначе память процесса.
    var (
        financeRepo   finance.Repository
        readiness     []httpapi.ReadinessCheck
        resolveTenant func(ctx context.Context, v string) (string, error)
        recorder      audit.Recorder
        busOpts       []command.Option
        authCfg       *httpapi.AuthConfig
    )
    if cfg.DB.URL != "" {
        pg, err := postgres.Connect(ctx, cfg.DB.URL)
        if err != nil { return err }
        defer pg.Close()
        if err := postgres.Migrate(ctx, cfg.DB.URL); err != nil { return err }

        financeRepo = finance.NewPostgresRepository(pg)
        readiness = append(readiness, httpapi.ReadinessCheck{Name: "postgres", Check: pg.Ready})
        resolveTenant = pg.ResolveTenant // в dev: pg.EnsureTenant (автосоздание по slug)

        recorder = postgres.NewAuditRecorder(pg, httpapi.RequestIDFrom)
        busOpts = append(busOpts, command.WithTxRunner(pg)) // хендлер+аудит в одной tx
        authCfg = &httpapi.AuthConfig{
            Service:       auth.NewService(postgres.NewAuthStore(pg), cfg.Auth.SessionTTL),
            TTL:           cfg.Auth.SessionTTL,
            ResolveTenant: resolveTenant,
            SecureCookie:  cfg.Env == config.EnvProduction,
            Audit:         recorder,
        }
    } else {
        log.Warn("NEX_DATABASE_URL is empty: running with in-memory storage")
        financeRepo = finance.NewMemoryRepository()
        recorder = audit.NewSlogRecorder(log)
    }

    bus := command.NewMemoryBus(authz.NewPolicyAuthorizer(policy), recorder, busOpts...)
    if err := finance.RegisterCommands(bus, financeRepo); err != nil { return err }

    router := httpapi.NewRouter(log, httpapi.RouterConfig{
        Readiness:     readiness,
        DevAuth:       cfg.Env == config.EnvDevelopment,
        ResolveTenant: resolveTenant,
        Auth:          authCfg,
        Mount:         []func(*http.ServeMux){finance.Routes(bus, financeRepo)},
    })
    // ... httpapi.New(router, opts).Run(ctx)
}
```

Добавить новый модуль = добавить блок «репозиторий → RegisterCommands → Routes» сюда. Ни один существующий файл не меняется, кроме этого.

**CLI-подкоманды.** `nexd` — не только сервер:

```
nexd [serve]                      запустить сервис (по умолчанию)
nexd migrate                      применить миграции и выйти
nexd tenant create <slug> <имя>   зарегистрировать организацию
nexd user create --tenant <slug> --email <e> [--name <имя>] [--role admin]
                                  создать пользователя; пароль из NEX_USER_PASSWORD
                                  или генерируется и печатается один раз
```

Это осознанный выбор вместо HTTP-эндпоинтов администрирования: bootstrap первого tenant'а и первого админа не должен требовать уже работающей аутентификации (проблема курицы и яйца), а CLI автоматически работает под теми же миграциями и тем же кодом Store'ов.

**Спайн Commands → Events → Audit.** Единственный путь изменения данных. Хендлеры не пишут в БД напрямую — они отправляют команду в шину, которая делает валидацию, авторизацию, исполнение и аудит одним проходом, **в одной транзакции** (§8). Это даёт бесплатно: единую точку RBAC, полный аудит «кто что сделал», транзакционность. AI встраивается сюда как ещё один актор — см. §18.

## 3. Структура модуля

**Канонический модуль** (эталон — `internal/module/finance`). Файлы по ответственности, не по типам:

```
internal/module/<name>/
  doc.go          package-комментарий: границы домена (по-русски)
  <entity>.go     доменные типы и инварианты (finance: ledger.go)
  commands.go     типы команд: Name() / Permission() / Validate()
  handlers.go     HandlerFunc'и + RegisterCommands(bus, repo)
  events.go       доменные события (реализуют event.Event)
  repo.go         интерфейс Repository + sentinel-ошибки
  pgrepo.go       Postgres-реализация (sqlc + InTenantTx) — БОЕВАЯ
  memrepo.go      in-memory реализация — только dev-режим и юнит-тесты
  http.go         Routes(bus, repo) + DTO + маппинг ошибок в HTTP
  *_test.go       рядом с кодом; pgrepo_test.go — интеграционные (§16)
```

**Команда — это намерение изменить состояние.** Минимальный контракт (`kernel/command/command.go`):

```go
type Command interface {
    Name() string       // "finance.entry.post" — стабильно, попадает в аудит
    Permission() string // "finance:entries:post" — проверяет authz
    Validate() error    // инварианты входа ДО обращения к БД
}
```

Реальный пример с главным доменным инвариантом (баланс дебет=кредит):

```go
func (c PostEntry) Validate() error {
    if len(c.Lines) < 2 {
        return errors.New("finance: entry needs at least two lines")
    }
    var debit, credit int64
    for i, l := range c.Lines {
        if l.Amount <= 0 {
            return fmt.Errorf("finance: line %d: amount must be positive", i)
        }
        switch l.Side {
        case Debit:  debit += l.Amount
        case Credit: credit += l.Amount
        default:     return fmt.Errorf("finance: line %d: unknown side %q", i, l.Side)
        }
    }
    if debit != credit {
        return fmt.Errorf("%w: debit %d != credit %d", ErrUnbalanced, debit, credit)
    }
    return nil
}
```

Этот же инвариант продублирован на уровне БД отложенным constraint-триггером (`migrations/00002_finance.sql`): второй рубеж на случай, если кто-то однажды запишет строки мимо команды. Валидация в Go — первая линия (быстрый понятный отказ), триггер — страховка на COMMIT.

**Два репозитория — роли строго разделены:**

- `pgrepo.go` — **боевое хранилище**. Работает через `postgres.InTenantTx` (§7): фильтров по `tenant_id` в SQL нет, границу проводит RLS. Ошибки БД переводятся в доменные: нарушение уникальности (SQLSTATE 23505) → `ErrDuplicateCode`, `pgx.ErrNoRows` → `ErrAccountNotFound`, tenant-ошибки платформы → `ErrNoTenant`. ID генерирует БД (`gen_random_uuid()`), а не Go.
- `memrepo.go` — скетч для запуска без БД (`NEX_DATABASE_URL` пуст) и полигон для юнит-тестов чистой доменной логики. Он не эмулирует транзакции, RLS и уникальные индексы — тесты, проверяющие поведение БД, обязаны идти против реального Postgres (§16). В production-конфигурации композиционный корень его не монтирует.

**Правила модуля** (полный список — `docs/how-to-write-a-module.md`): зависит только от kernel/platform; изменения данных только через шину; каждая таблица несёт `tenant_id` + RLS-политику с `FORCE`; деньги — `int64` в минорных единицах, никогда float; именование `модуль.сущность.глагол` / `модуль:сущность:действие`.

## 4. HTTP-стек

**Без фреймворка (ADR-002):** `net/http` + `ServeMux`. С Go 1.22 роутер stdlib умеет методы и path-параметры — 90% ценности chi бесплатно, ноль зависимостей в самом критичном слое.

**Роутер собирается из RouterConfig** — httpapi не знает о конкретных модулях, всё решает композиционный корень:

```go
type RouterConfig struct {
    Readiness     []ReadinessCheck   // проверки зависимостей для /readyz
    DevAuth       bool               // X-Dev-* заголовки (только development)
    ResolveTenant func(ctx context.Context, v string) (string, error) // slug → UUID
    Auth          *AuthConfig        // настоящая аутентификация (§9); nil = без неё
    Mount         []func(mux *http.ServeMux) // маршруты модулей
}
```

**Middleware — обычные `func(http.Handler) http.Handler`.** Актуальный порядок (внешний → внутренний):

```
requestID → requestLogger → recoverer → sessionIdentity → devIdentity → tenantResolver → mux
```

Обоснование порядка: `requestID` снаружи — каждая строка лога и записи аудита несёт один идентификатор; `requestLogger` видит итоговый статус, включая 500 от `recoverer`; `recoverer` стоит выше всех «содержательных» слоёв — паника в session/devauth/резолвере тоже превратится в 500, а не уронит процесс; `sessionIdentity` аутентифицирует первым (cookie → актор + tenant); `devIdentity` может подменить актора только в development; `tenantResolver` нормализует то, что положили предыдущие слои (slug → UUID, §7). Цепочка собирается функцией `chain` — первый в списке становится внешним.

**Ответы — единые хелперы** (`platform/httpapi/problem.go`), ошибки в формате RFC 9457 (ADR-003):

```go
httpapi.WriteJSON(w, http.StatusCreated, resp)
httpapi.WriteProblem(w, http.StatusForbidden, "Доступ запрещён", err.Error())
// Content-Type: application/problem+json
```

**HTTP-хендлер модуля тонкий:** распарсить → собрать команду → `bus.Dispatch` → замапить ошибку. Никакой логики в хендлере. Маппинг ошибок ядра в статусы (`finance/http.go`):

```go
func writeCommandError(w http.ResponseWriter, err error) {
    switch {
    case errors.Is(err, authz.ErrDenied):
        httpapi.WriteProblem(w, http.StatusForbidden, "Доступ запрещён", err.Error())
    case errors.Is(err, ErrNoTenant):
        httpapi.WriteProblem(w, http.StatusBadRequest, "Не указан tenant", err.Error())
    case errors.Is(err, ErrAccountNotFound):
        httpapi.WriteProblem(w, http.StatusNotFound, "Счёт не найден", err.Error())
    case errors.Is(err, ErrDuplicateCode):
        httpapi.WriteProblem(w, http.StatusConflict, "Код счёта занят", err.Error())
    case errors.Is(err, ErrCurrencyMismatch), errors.Is(err, ErrUnbalanced):
        httpapi.WriteProblem(w, http.StatusUnprocessableEntity, "Проводка отклонена", err.Error())
    default:
        httpapi.WriteProblem(w, http.StatusInternalServerError, "Внутренняя ошибка", err.Error())
    }
}
```

**Декодирование тела — безопасно по умолчанию:** лимит размера + запрет неизвестных полей.

```go
r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 МБ
dec := json.NewDecoder(r.Body)
dec.DisallowUnknownFields()
if err := dec.Decode(dst); err != nil { /* 400 */ }
```

**Сервер — с таймаутами всегда** (`platform/httpapi/server.go`, значения из конфига): ReadTimeout, WriteTimeout, IdleTimeout и graceful shutdown по контексту. Сервер без таймаутов — открытая дверь для медленных клиентов (Slowloris).

**Когда добавить chi:** если понадобятся вложенные группы роутов с общими middleware и их станет больно писать на stdlib — chi совместим с `net/http` и добавляется без переписывания. Не раньше.

**Требование латентности: < 500 мс на 3G.** Региональные колледжи сидят на плохом интернете. Бюджет — p95 TTFB отдельного `/api/v1/*` запроса заведомо ниже 500 мс, чтобы сетевой RTT 3G съедал остаток. Следствия для Go-кода: отдавать мало байт (пагинация, не «все проводки разом»); один round-trip к БД, не N (§6, N+1); стриминг для долгого (§19); тяжёлое — в фон (§17). Смотрим p95/p99, не среднее. `encoding/json` не вставляет лишних пробелов — «компактность» решают короткие имена полей DTO, `omitempty` и `json.NewEncoder(w).Encode` прямо в поток. Бинарные форматы не берём: экономия байт не окупает потерю отлаживаемости curl'ом.

## 5. Библиотеки

**Принцип: каждая внешняя зависимость — это ADR.** Ниже — утверждённый список. Всё, чего здесь нет, обсуждается до добавления.

| Область | Берём | Статус | НЕ берём и почему |
|---|---|---|---|
| HTTP | stdlib `net/http` | **в коде** | gin/echo/fiber — свои типы контекста, привязка |
| Роутинг | stdlib `ServeMux` | **в коде** | chi — при реальной необходимости |
| БД-драйвер | `jackc/pgx/v5` | **в коде** | lib/pq (режим поддержки), database/sql тоньше по фичам |
| Запросы | sqlc (кодоген) | **в коде** | GORM/ent — скрывают SQL; squirrel — теряется проверяемость |
| Миграции | `pressly/goose` | **в коде** | golang-migrate тоже ок; goose — SQL-файлы + embed |
| Пароли | `golang.org/x/crypto/argon2` | **в коде** | bcrypt слабее к GPU-перебору (OWASP рекомендует argon2id) |
| Векторы | `pgvector/pgvector-go` | roadmap | отдельная vector DB — лишний сервис |
| Очередь | `riverqueue/river` | roadmap | asynq (нужен Redis), самопис |
| LLM SDK | `sashabaranov/go-openai` | roadmap | langchaingo (170+ зависимостей) |
| Логи | stdlib `log/slog` | **в коде** | zap/zerolog — быстрее, но stdlib хватает |
| Метрики | `prometheus/client_golang` | roadmap | — |
| Трейсы | `go.opentelemetry.io/otel` | roadmap | — |
| Rate limit | своя реализация (~70 строк, `httpapi/ratelimit.go`) | **в коде** | `x/time/rate` — возьмём, когда понадобится token bucket, а не окно |
| UUID | `gen_random_uuid()` на стороне PG | **в коде** | google/uuid — пока не нужен: ID генерирует БД |
| Тест-БД | реальный Postgres через `NEX_TEST_DATABASE_URL` (§16) | **в коде** | моки PG врут о поведении; testcontainers — опция на будущее |
| Конфиг | stdlib `os.LookupEnv` (свой лоадер) | **в коде** | viper — тяжёл для 12-factor env |
| Валидация | ручная в `Validate()` + генерация из OpenAPI (M5) | **в коде** | reflect-валидаторы прячут логику |

**sqlc — не зависимость бинарника, а инструмент сборки.** Он не попадает в `go.mod`: генерация идёт закреплённой версией через `go run` (`make sqlc` → `go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.29.0 generate`). Версия зафиксирована в Makefile — воспроизводимо у всех разработчиков и в CI без установки бинарников.

**Гигиена зависимостей:** `go mod tidy` перед каждым PR; `govulncheck ./...` в CI; Dependabot присылает обновления; новая прямая зависимость → строчка в decision-log.

## 6. PostgreSQL

**pgx/v5 + sqlc + goose, без ORM (ADR-006).** sqlc генерирует типобезопасный Go из настоящего SQL — вся мощь Postgres без слоя абстракции.

**Подключение** (`platform/postgres/postgres.go`) — пул с пингом на старте, чтобы ошибка конфигурации проявилась при запуске процесса, а не на первом запросе пользователя:

```go
func Connect(ctx context.Context, dsn string) (*DB, error) {
    cfg, err := pgxpool.ParseConfig(dsn)
    if err != nil { return nil, fmt.Errorf("postgres: parse dsn: %w", err) }
    pool, err := pgxpool.NewWithConfig(ctx, cfg)
    if err != nil { return nil, fmt.Errorf("postgres: create pool: %w", err) }
    pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    if err := pool.Ping(pingCtx); err != nil {
        pool.Close()
        return nil, fmt.Errorf("postgres: ping: %w", err)
    }
    return &DB{pool: pool}, nil
}
```

`DB.Ready` — readiness-проверка, которую композиционный корень отдаёт в `/readyz`.

**Запросы sqlc** (`platform/postgres/queries/*.sql`, конфиг `sqlc.yaml`). Пишешь SQL с аннотацией — получаешь типизированную Go-функцию:

```sql
-- name: CreateFinanceAccount :one
INSERT INTO finance_accounts (tenant_id, code, name, type, currency)
VALUES ($1, $2, $3, $4, $5) RETURNING *;
```

`make sqlc` → `db.CreateFinanceAccount(ctx, params) (FinanceAccount, error)` в `platform/postgres/db/`. Сгенерированный код коммитится в репозиторий: ревьюится, не строится в рантайме, работает без установленного sqlc.

**Миграции goose** (`migrations/NNNNN_*.sql`) встроены в бинарник (`migrations/embed.go`, `//go:embed *.sql`) и применяются:

- автоматически при старте `nexd serve` в Postgres-режиме — для монолита в один инстанс это безопасно (goose идемпотентен и быстр) и убирает отдельный шаг деплоя;
- явно командой `nexd migrate` (или `make migrate`) — для сценариев, где миграции хотят прогонять до перезапуска сервиса.

Миграция после merge не редактируется — только новая поверх. Многооператорные блоки (функции, DO-блоки) оборачиваются в `-- +goose StatementBegin / StatementEnd`.

**Деньги и время:** суммы — `int64` в копейках (никогда float); время — `timestamptz`, в Go `time.Time` в UTC; идентификаторы — `uuid`, генерирует БД (`gen_random_uuid()`).

**Проблема N+1** (критична из-за §4): не «взять список, потом в цикле догружать по каждому». Один запрос с JOIN или `WHERE id = ANY($1::uuid[])` — так `pgrepo.PostEntry` проверяет существование всех счетов проводки одним запросом. sqlc это не прячет — SQL на виду, N+1 видно в ревью.

**Настройка PostgreSQL под слабое железо.** Минимальное целевое железо — 4 ГБ RAM (§27), и на нём Postgres делит память с nexd, Caddy и ОС:

```
# postgresql.conf — общая машина 4 ГБ (БД получает НЕ всю память)
shared_buffers = 512MB            # ~12% общей RAM; 25% — только для выделенного сервера БД
effective_cache_size = 1536MB     # реалистичная оценка кэша, доступного БД
work_mem = 8MB                    # формула ниже; поднимать точечно SET LOCAL в тяжёлом отчёте
max_connections = 50              # приложение ходит через пул pgx, сотни соединений не нужны
maintenance_work_mem = 256MB      # VACUUM и CREATE INDEX
```

Формула безопасности `work_mem ≈ (RAM_доступная_БД − shared_buffers) / max_connections / 2` — делитель 2 это запас на несколько сортировок в одном запросе. Чем замерять: `pg_stat_statements` (первое, что включаем), `EXPLAIN (ANALYZE, BUFFERS)`, pgbench для «до/после». Правило: менять по одному параметру, замерять минимум сутки.

## 7. Мультитенантность

Изоляция организаций — сквозная, «от заголовка до строки таблицы». Реализована полностью, с негативными тестами. Путь tenant'а через систему:

```
запрос → sessionIdentity (tenant из сессии) или X-Dev-Tenant (dev)
       → tenantResolver: slug → UUID по реестру tenants
       → контекст запроса (tenancy.WithTenant)
       → InTenantTx: транзакция с app.tenant_id
       → RLS-политики Postgres отсекают чужие строки
```

**Контекст как транспорт tenant'а** (`kernel/tenancy`) — типобезопасно, через неэкспортируемый ключ:

```go
ctx = tenancy.WithTenant(ctx, tenantID)   // кладёт middleware
tenant, ok := tenancy.TenantFrom(ctx)     // достают шина и репозитории
```

**Реестр tenant'ов и резолвинг.** Таблица `tenants` (uuid PK, уникальный slug) — точка входа в изоляцию, сама без RLS. Внутри системы tenant всегда UUID; человекочитаемый slug (`college-1`) переводится в UUID middleware'ом `tenantResolver` до того, как запрос дойдёт до команд и SQL. Запрос с неизвестным slug обрывается 400. В development неизвестный slug создаёт tenant на лету (`pg.EnsureTenant`) — локальная разработка не начинается с ручной регистрации; в production — только `pg.ResolveTenant` (существующие).

**Каждый SQL-запрос — в транзакции с tenant'ом** (`platform/postgres/tx.go`):

```go
// InTenantTx: fn исполняется в транзакции, у которой app.tenant_id взят из
// контекста. Если транзакция уже открыта выше по стеку (шиной команд, §8),
// fn присоединяется к ней. Запрос на «голом» пуле не имеет app.tenant_id,
// и RLS не вернёт ему ни строки — поэтому мимо InTenantTx ходить некуда.
err := d.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
    rows, err := q.ListFinanceAccountsWithBalances(ctx)
    // ...
})
```

Внутри — важная техническая деталь, на которой спотыкаются: **`SET LOCAL` не принимает параметры запроса**. `tx.Exec(ctx, "SET LOCAL app.tenant_id = $1", tenant)` — нерабочий SQL. Правильно — параметризованный `set_config` (третий аргумент `true` = действует до конца транзакции, эквивалент SET LOCAL):

```go
tx.Exec(ctx, "SELECT set_config('app.tenant_id', $1, true)", tenant)
```

UUID tenant'а валидируется в Go до запроса (`pgtype.UUID.Scan`) — мусор в контексте даёт понятную ошибку `ErrInvalidTenant`, а не ошибку каста в глубине СУБД.

**RLS — второй рубеж, и у него два обязательных условия.** Наивное `ENABLE ROW LEVEL SECURITY` + политика — недостаточно, и это была реальная дыра в ранних черновиках схемы:

```sql
ALTER TABLE finance_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_accounts FORCE ROW LEVEL SECURITY;   -- (1) без FORCE владелец
                                                          -- таблиц обходит политики МОЛЧА

CREATE POLICY tenant_isolation_fin_accounts ON finance_accounts
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
    --                 ^(2) missing_ok=true + NULLIF: без установленной переменной
    --                  политика видит NULL и возвращает ноль строк,
    --                  а не роняет запрос ошибкой каста
```

1. Приложение подключается ролью-владельцем таблиц, а владелец по умолчанию **не подпадает** под свои политики. `FORCE` включает их и для него.
2. `current_setting('app.tenant_id')` без `missing_ok` бросает ошибку, если переменная не установлена; с `true` возвращает NULL/пустую строку. `NULLIF(..., '')::uuid` превращает оба случая в NULL → сравнение ложно → ноль строк. «Забыли установить tenant» деградирует в «ничего не видно», а не в 500.

**В самих запросах фильтра по tenant_id нет** — намеренно. Граница проводится один раз в политике, а не размазывается по каждому SELECT, где её можно забыть. INSERT передаёт `tenant_id` параметром, и политика (`USING` действует как `WITH CHECK`) отклонит попытку вставить строку чужого tenant'а — SQLSTATE 42501.

**Негативные тесты обязательны** (`platform/postgres/postgres_test.go`, реальный Postgres):

- запрос на «голом» пуле без `app.tenant_id` → ноль строк;
- транзакция tenant2 не видит строк tenant1;
- вставка строки tenant1 из транзакции tenant2 → 42501;
- невалидный tenant в контексте до БД не доходит.

**Изоляция тестов — через сами tenant'ы:** каждый интеграционный тест создаёт свежий tenant со случайным slug'ом и работает только в нём. База не чистится между тестами, пакеты могут гоняться параллельно — RLS изолирует их так же, как изолирует колледжи.

## 8. Шина команд и транзакционный аудит

Спайн Commands → Audit реализован полностью. Цикл `Dispatch` (`kernel/command/bus.go`):

```
Dispatch(ctx, cmd):
  1. handler найден?          нет → аудит(error) → ErrUnknownCommand
  2. cmd.Validate()           ошибка → аудит(error) → 400 на границе HTTP
  3. authz.Authorize(ctx,cmd) отказ → аудит(denied) → 403
  4. RunTx: ┌ handler(ctx, cmd)      ← изменения данных
            └ audit.Record(ctx, ok)  ← та же транзакция!
     ошибка любого шага → откат всего → аудит(error) отдельной транзакцией
```

**Ключевой инвариант: изменение данных и его след в журнале коммитятся атомарно.** Это достигается двумя решениями:

1. **`command.TxRunner`** — интерфейс, объявленный потребителем (пакетом `command`), реализованный `postgres.DB.RunTx`. Шина оборачивает хендлер и запись аудита в одну транзакцию; открытая транзакция едет в контексте, и всё, что внутри вызывает `InTenantTx` (репозитории, рекордер аудита), **присоединяется** к ней, а не открывает свою. Без TxRunner (in-memory режим, юнит-тесты) шина работает как раньше — контракт `Dispatch` не меняется.
2. **`audit.Recorder.Record` возвращает ошибку.** Не смог записать журнал — откатилась и команда. Журнал не может разойтись с данными ни в какую сторону.

**Тонкость, которую легко упустить:** записи об исходах `denied`/`error` пишутся **после** отката, отдельной короткой транзакцией — внутри откатившейся они исчезли бы вместе с изменениями. Это best-effort: основная ошибка уже возвращается вызывающему.

**Журнал append-only на уровне БД.** У `audit_log` есть RLS-политики только на SELECT (свой tenant) и INSERT (свой tenant или NULL для системных событий). Политик UPDATE/DELETE нет — под `FORCE ROW LEVEL SECURITY` это означает, что даже роль приложения физически не может отредактировать или удалить запись. Для КИС это не деталь, а требование: «кто изменил оценку/проводку» должно быть неизменяемой историей.

**Что несёт запись:** команда, исход (`ok|denied|error`), актор (непрозрачная строка — пользователь, система, будущий AI-актор), tenant (NULL для событий вне организации), detail, `trace_id` (= X-Request-Id запроса, §21) и момент времени. `actor_id` — text, не uuid с FK: ядро не диктует, что актор обязан быть строкой в `users`.

**Проверено тестом** (`finance/pgrepo_test.go`, `TestPGTransactionalAudit`): успешная команда оставляет `ok`; хендлер, который изменил данные и упал, — данные откатились, след `error` остался.

**События (`kernel/event`)** — контракт объявлен (`Name()`, `OccurredAt()`), модуль finance декларирует `EntryPosted`, но доставка (outbox → River) — веха M2+ из роадмапа, ещё не реализована. Когда появится — события будут писаться в той же транзакции шины, рядом с аудитом.

## 9. Аутентификация и сессии

Реализована по ADR-004: **собственные server-side сессии + argon2id**. Никаких JWT-как-сессии (нельзя отозвать), никаких внешних identity-провайдеров (данные студентов у третьей стороны). Код: `kernel/auth` (логика), `platform/postgres/authstore.go` (хранилище), `platform/httpapi/auth.go` (транспорт).

**Пароли — argon2id в формате PHC** (`kernel/auth/password.go`), параметры по OWASP Password Storage Cheat Sheet: 19 МиБ памяти, t=2, p=1:

```
$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
```

Параметры зашиты в строку хэша — стоимость хэширования можно поднять в новом коде, старые хэши продолжат проверяться со своими параметрами, без миграции данных. Сравнение — `subtle.ConstantTimeCompare`.

**Сессии — opaque-токены.** 256 бит из `crypto/rand`, клиенту уходит base64url, в БД — только sha256-хэш: утечка БД не раскрывает действующих сессий. Отзыв мгновенный (`revoked_at`), logout идемпотентен.

**Три решения против типовых атак:**

- **Одна ошибка на все причины отказа.** `ErrInvalidCredentials` возвращается и на «нет пользователя», и на «неверный пароль», и на «отключён» — ответ не раскрывает, какая часть пары неверна. Неизвестный tenant при логине — тот же 401: не раскрываем список организаций.
- **Выравнивание времени.** Когда пользователь не найден, argon2 всё равно прогоняется по дежурному хэшу — время ответа не выдаёт, существует ли email.
- **Rate limiting.** 10 неудачных попыток за 5 минут на пару IP+email → 429 (`httpapi/ratelimit.go`, фиксированное окно, ~70 строк без зависимостей). Успешный вход сбрасывает счётчик. Отказ по лимиту попадает в аудит как `denied`.

**Cookie:** `nex_session`, httpOnly, SameSite=Lax, `Secure` в production, MaxAge = `NEX_SESSION_TTL` (совпадает с TTL сессии в БД).

**Endpoints:**

```
POST /api/v1/auth/login   {"tenant": "<slug>", "email": "...", "password": "..."}
                          → 200 + Set-Cookie nex_session; 401; 429
GET  /api/v1/auth/me      → 200 {id, email, display_name, roles, tenant}; 401
POST /api/v1/auth/logout  → 204 (идемпотентен, cookie гасится всегда)
```

**Session-middleware** (`sessionIdentity`) превращает валидную cookie в актора и tenant запроса (`identity.WithActor` + `tenancy.WithTenant`). Невалидная сессия **не обрывает запрос** — он идёт дальше анонимным, и его остановит авторизация команд (403). Так публичные маршруты (`/healthz`) не зависят от состояния cookie.

**Хитрость с RLS и порядком поиска.** Таблица `users` — под `FORCE RLS`, но сессию ищут по токену **до того**, как tenant известен. Поэтому `sessions` — сознательно без RLS (наружу таблица не видна, токены захэшированы) и несёт `tenant_id`: шаг 1 — найти живую сессию по хэшу токена, шаг 2 — установить tenant из неё и уже под RLS прочитать пользователя.

**Аудит входов:** `auth.login` / `auth.logout` с исходами ok/denied пишутся в тот же append-only журнал с `trace_id` — попытки перебора видны там же, где вся история действий.

**Bootstrap без курицы и яйца:** первый tenant и первый администратор заводятся CLI-подкомандами (`nexd tenant create`, `nexd user create`) — им не нужна работающая аутентификация. Пароль берётся из `NEX_USER_PASSWORD` или генерируется и печатается один раз.

**Роли.** Сейчас поддерживается одна осмысленная роль — `admin` (хранится в `users.roles text[]`); политика в композиционном корне выдаёт ей права модулей. Полноценный RBAC per-tenant (роли преподавателя/студента, настраиваемые права, матрица «роль × команда») — веха M4; хранение ролей на пользователе — осознанная простота до неё.

**Dev-режим:** заголовки `X-Dev-Actor` / `X-Dev-Roles` / `X-Dev-Tenant` (`devauth.go`) продолжают работать в development рядом с настоящими сессиями — удобно для curl и тестов. В production middleware не устанавливается вовсе; с вехой M4 файл будет удалён.

## 10. pgvector *(roadmap)*

**Зачем в NEX:** RAG для AI-слоя (§18) — семантический поиск по документам колледжа (приказы, договоры, регламенты). Отдельная vector DB (Qdrant/Milvus) не нужна: у колледжа тысячи документов, pgvector с HNSW-индексом держит миллионы. Одна БД — один бэкап, одна транзакция, ноль новых сервисов.

Расширение и таблица (будущая миграция `0000N_ai.sql`):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE ai_chunks (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants (id),
    document_id uuid NOT NULL REFERENCES ai_documents (id),
    seq         int  NOT NULL,
    text        text NOT NULL,
    embedding   vector(1024)              -- размерность модели эмбеддингов
);
CREATE INDEX ai_chunks_embedding_idx ON ai_chunks
    USING hnsw (embedding vector_cosine_ops);
ALTER TABLE ai_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chunks FORCE ROW LEVEL SECURITY;          -- как во всех tenant-таблицах (§7)
CREATE POLICY tenant_isolation ON ai_chunks
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
```

Поиск k ближайших чанков (`pgvector/pgvector-go`, tenant отфильтрует RLS):

```go
const q = `SELECT text FROM ai_chunks ORDER BY embedding <=> $1 LIMIT $2`
rows, err := tx.Query(ctx, q, pgvector.NewVector(queryEmbedding), k)
```

**Версионирование размерности — не «одна колонка навсегда».** `vector(1024)` жёстко привязан к модели эмбеддингов (BGE-M3 — 1024, text-embedding-3-small — 1536). Стратегия смены модели без downtime: колонка на модель (`embedding_bge_m3`, при миграции добавляется `embedding_e5 vector(1536)` новой миграцией); River-воркер пересчитывает корпус в новую колонку фоном; поиск переключается, старая колонка дропается отдельной миграцией. Активная модель фиксируется в конфиге и в `ai_documents.embedding_model`.

**HNSW на больших корпусах строится через `CREATE INDEX CONCURRENTLY`** — не блокирует запись (дольше, но не роняет доступность). Параметры (m, ef_construction) — тюнинг под замеренную задержку, не заранее.

**RLS обязателен** — иначе векторный поиск утечёт документы между колледжами: поиск по эмбеддингам игнорирует tenant, если политика не наложена.

## 11. Кэш *(roadmap)*

**Сначала in-process, Valkey — по необходимости (ADR-008).** Монолит в один инстанс не нуждается в сетевом кэше; преждевременный Redis — лишний компонент и класс багов (инвалидация).

Интерфейс закладывается до реализации, чтобы апгрейд не трогал вызывающий код:

```go
type Cache interface {
    Get(ctx context.Context, key string) ([]byte, bool)
    Set(ctx context.Context, key string, val []byte, ttl time.Duration)
}
```

Этап 1 — in-process TTL-кэш. Этап 2 (второй инстанс приложения) — Valkey (open-source форк Redis; не Redis — лицензия RSAL), клиент `valkey-io/valkey-go`. Триггер апгрейда явный: второй инстанс nexd за балансировщиком ИЛИ кэш должен переживать рестарт.

**Где кэш понадобится:** ответы LLM с temperature=0 (§18); горячие справочники (план счетов, роли); rate-limit счётчики при переходе на Valkey (сейчас — in-process, `httpapi/ratelimit.go`). Ключи кэша сегментируются по tenant — иначе утечка между колледжами.

**Экономика кэша LLM — измеряется, не декларируется.** Процент экономии равен доле повторяющихся запросов и зависит от профиля колледжа. Метрика — cache hit rate (§21); экономия = hit_rate × стоимость_без_кэша. Кэш префиксов на стороне провайдера (DeepSeek и другие) — опция конкретного провайдера, сверяется с его актуальной документацией, а не предполагается по умолчанию.

## 12. Конфигурация

**Env-переменные, 12-factor, свой лоадер поверх `os.LookupEnv` — без viper.** Реальный `internal/config/config.go`: типизированная структура, значения по умолчанию, валидация при старте — все ошибки конфигурации сообщаются разом, а не по одной.

Актуальный набор переменных:

| Переменная | Дефолт | Что делает |
|---|---|---|
| `NEX_ENV` | `development` | окружение; влияет на формат логов, dev-auth, Secure-cookie |
| `NEX_HTTP_ADDR` | `:8080` | адрес HTTP-сервера |
| `NEX_HTTP_READ_TIMEOUT` | `10s` | таймауты сервера (+WRITE/IDLE/SHUTDOWN) |
| `NEX_LOG_LEVEL` | `info` | debug / info / warn / error |
| `NEX_LOG_FORMAT` | по env | text в dev, json в prod |
| `NEX_DATABASE_URL` | *(пусто)* | DSN Postgres; пусто = in-memory режим без персистентности |
| `NEX_SESSION_TTL` | `24h` | время жизни сессии и cookie |

Правила: каждая переменная опциональна и имеет разумный дефолт; валидация падает громко при старте, а не тихо в рантайме; секреты (DSN с паролем, будущие ключи LLM) — только из env, никогда в git; `.env` в `.gitignore`, шаблон — `.env.example`; префикс всех переменных — `NEX_`. Конфиг читается ровно один раз (`config.Load()`), дальше передаётся явно — никто в глубине не зовёт `os.Getenv`.

## 13. Логирование

**`log/slog` из stdlib (ADR-010).** text в dev, JSON в prod (`platform/logging`).

```go
log.LogAttrs(ctx, slog.LevelInfo, "http request",
    slog.String("method", r.Method),
    slog.Int("status", rec.status),
    slog.Duration("duration", time.Since(start)))
```

Правила NEX:

- **Структурные атрибуты, не форматирование.** `slog.Int("status", 404)`, не `fmt.Sprintf`. JSON-логи в prod парсятся Loki.
- **`LogAttrs` в горячем пути** (лог на каждый запрос) — избегает боксинга аргументов в `any`. В остальных местах `Info` читаемее и достаточно.
- **`request_id` в каждой записи** (middleware `requestID`) — связывает логи, аудит и ответ клиенту; тот же идентификатор уходит в `audit_log.trace_id`.
- **Секреты и ПДн не попадают в логи — механизмом, а не дисциплиной.** slog сам не защищает: `slog.Any("user", u)` выгрузит структуру целиком. Доменные типы, которые могут попасть в лог (Actor, User), обязаны реализовать `slog.LogValuer` и отдавать только безопасные поля:

```go
func (a Actor) LogValue() slog.Value {
    return slog.GroupValue(
        slog.String("id", a.ID),
        slog.Int("roles", len(a.Roles)),
    )
}
```

- **Уровни:** debug — детали разработки; info — бизнес-события; warn — аномалии без потери функции; error — требует внимания человека.
- **Логгер передаётся явно сверху вниз, не глобальный.**

Аудит — не логирование. `audit.SlogRecorder` (журнал в лог) — только для in-memory режима; в Postgres-режиме журнал пишется в таблицу транзакционно (§8). Лог можно потерять при ротации — журнал аудита нельзя.

## 14. Ошибки

**Ошибки — значения**, оборачиваем `%w`, проверяем `errors.Is/As`. Никаких паник в бизнес-логике (паника — только для «этого не может быть»: `crypto/rand` отказал).

**Sentinel-ошибки на границах пакета** (`finance/repo.go`):

```go
var (
    ErrNoTenant        = errors.New("finance: no tenant in context")
    ErrAccountNotFound = errors.New("finance: account not found")
    ErrDuplicateCode   = errors.New("finance: account code already exists")
)
```

Оборачивание с контекстом сохраняет цепочку для `errors.Is`:

```go
return fmt.Errorf("%w: %s", ErrAccountNotFound, id)
```

**Перевод ошибок между слоями — на границе слоя.** Три работающих примера из кода:

- `pgrepo.mapTenantErr`: платформенные `postgres.ErrNoTenant/ErrInvalidTenant` → доменная `finance.ErrNoTenant`. Вызывающие видят единый словарь ошибок модуля, не зная о платформе.
- нарушение уникальности БД: `pgconn.PgError` с кодом 23505 → `ErrDuplicateCode`. SQLSTATE-коды не утекают выше репозитория.
- `auth`: `ErrNoUser` из Store сервис переводит в `ErrInvalidCredentials` — наружу уходит один ответ на все причины отказа (§9).

Прочие правила: префикс пакета в тексте (`"finance: ..."`) — видно источник в логе; ошибку либо обрабатывают, либо оборачивают и возвращают — не логируют и пробрасывают одновременно (двойной лог); граница HTTP — единственное место, где ошибка превращается в статус (`writeCommandError`); шина фиксирует любой исход в аудите независимо от того, как его обработает HTTP.

## 15. Конкурентность и контексты

**`context.Context` — первый аргумент всего, что делает I/O.** Он несёт дедлайн, отмену и (в NEX) актора + tenant + request_id + открытую транзакцию (§8).

**Контекст как транспорт идентичности** (`kernel/identity`, `kernel/tenancy`) — типобезопасно, через неэкспортируемые ключи:

```go
ctx = identity.WithActor(ctx, identity.Actor{ID: "u1", Roles: []string{"admin"}})
actor, ok := identity.ActorFrom(ctx)
```

Правила конкурентности:

- **Отмена пробрасывается.** SQL-запрос, HTTP-вызов, будущий LLM-стрим принимают ctx и прерываются по нему. Запрос без дедлайна = подвешенная горутина.
- **Горутина должна уметь завершиться.** Каждая `go func()` слушает `ctx.Done()` или пишет в канал, который кто-то читает. Утечка горутины — баг.
- **Разделяемое состояние — под мьютексом или через каналы.** `MemoryBus.handlers`, `MemoryRepository`, `rateLimiter.buckets` защищены `sync.Mutex/RWMutex`. Гонки ловит `go test -race` (в CI обязателен).
- **Ограничение параллелизма — семафор на канале:**

```go
sem := make(chan struct{}, maxConcurrent)
select {
case sem <- struct{}{}:
    defer func() { <-sem }()
case <-ctx.Done():
    return ctx.Err()
}
```

- **`errgroup.WithContext`** для параллельных под-задач одного запроса: первая ошибка отменяет ctx, остальные горутины видят отмену, `Wait()` возвращает первую ошибку.
- **Graceful shutdown фоновых циклов:** собственный периодический цикл обязан слушать отмену и досчитаться в лимит shutdown; финальный флаш — через `context.WithoutCancel(ctx)`.

## 16. Тестирование

**Пирамида:** unit (`go test -race`) → интеграционные против реального Postgres → e2e (Playwright, фронт, M8) → нагрузочное (k6, M8). Всё стандартной библиотекой `testing`, table-driven.

**Интеграция с реальным Postgres — через `NEX_TEST_DATABASE_URL`.** Так это работает сегодня (вместо testcontainers, которым нужен Docker):

```go
func pgTestDB(t *testing.T) *postgres.DB {
    dsn := os.Getenv("NEX_TEST_DATABASE_URL")
    if dsn == "" {
        t.Skip("NEX_TEST_DATABASE_URL не задан — пропускаю интеграционный тест")
    }
    // Migrate + Connect; t.Cleanup(d.Close)
}
```

Свойства подхода:

- **`go test ./...` без переменной работает везде** — интеграционные тесты честно скипаются, юниты бегут за секунды.
- **`make test-db`** гоняет всё против локального Postgres (compose или системный).
- **В CI Postgres — сервис-контейнер** GitHub Actions (`services: postgres:17-alpine`), переменная выставлена — интеграционные тесты обязательны для merge.
- **Изоляция — свежий tenant на тест** со случайным slug (§7): база не чистится, тесты и пакеты параллелятся, RLS изолирует. Никаких TRUNCATE между тестами.

testcontainers остаётся опцией на будущее (если понадобится матрица версий PG), но текущая схема проще и быстрее.

**Table-driven — стандарт** (`finance/commands_test.go`): кейсы структурой, `t.Run(tc.name, ...)`, негативные случаи обязательны.

**Тест через шину — как в проде** (`finance/module_test.go`, `finance/pgrepo_test.go`): собираем настоящую шину с политикой и репозиторием, диспатчим команды, проверяем результат, аудит и изоляцию tenant'ов. Один и тот же набор сценариев гоняется и на memrepo (юнит), и на Postgres (интеграция) — репозитории обязаны вести себя одинаково с точки зрения домена.

**HTTP-тест через httptest** (`finance/http_test.go`, `httpapi/auth_pg_test.go`): полный роутер как в проде. Обязательные негативные кейсы: 403 без роли, 400 на кривой JSON, 401 на неверный пароль, 429 на перебор, 401 после logout.

**Что тестируется всегда:**

- негативная изоляция tenant'ов (chужой tenant не видит и не пишет — §7);
- транзакционность аудита (откат данных при ошибке, след остаётся — §8);
- полный auth-флоу через HTTP (§9).

**Про метрику покрытия — честно.** «≥ 80% строк» — слабый ориентир: набивается на `if err != nil`. Важнее покрытие ветвлений доменной логики (стороны проводки, исходы команд, ветки authz). Мутационное тестирование ядра (go-mutesting) — периодически, не на каждый PR.

Прочие правила: тесты рядом с кодом; внешний тест-пакет (`package finance_test`) для публичного API; `go test -race ./...` — гейт merge; fuzzing (`testing.F`) — для парсеров.

## 17. River *(roadmap)*

**River — очередь поверх Postgres (ADR-009).** Транзакционный enqueue: задача ставится в той же транзакции, что и бизнес-операция — не теряется и не выполняется до коммита. Идеально ложится на транзакционную шину (§8): `riverClient.InsertTx(ctx, tx, args, nil)` внутри той же `RunTx`, где исполнился хендлер. Никакого нового инфраструктурного компонента (Redis не нужен).

**Зачем:** отправка писем/уведомлений, пересчёт отчётных витрин, импорт ростера (§28), асинхронные AI-задачи (индексация документов для RAG, классификация аномальных платежей), batch-запросы к LLM по сниженному тарифу.

```go
type IndexDocumentArgs struct {
    DocumentID string `json:"document_id"`
}
func (IndexDocumentArgs) Kind() string { return "ai.index_document" }

func (w *IndexDocumentWorker) Work(ctx context.Context, job *river.Job[IndexDocumentArgs]) error {
    // чанкинг → эмбеддинги → запись в ai_chunks; идемпотентно по DocumentID
    return w.repo.IndexDocument(ctx, job.Args.DocumentID)
}
```

Правила: воркеры идемпотентны (River гарантирует at-least-once); ретраи с экспонентой встроены; долгие задачи уважают ctx; изменения данных из воркера — через ту же шину (актор `system`/`ai:*`), чтобы не терять аудит. Воркеры запускаются в том же процессе nexd — отдельного деплоя нет до вехи масштабирования.

## 18. AI-интеграция *(roadmap)*

Полная стратегия — `docs/ai/` и `docs/research/ai-core.md`. Здесь — как это ляжет на уже построенное ядро.

**Главный принцип: AI — это актор шины команд, а не отдельный контур.** LLM не пишет в БД напрямую и не «отвечает в чат». Он: (1) читает данные через те же читающие пути, что и человек; (2) когда нужно действие — отправляет обычную команду от актора `ai:*` с ролью, ограниченной политикой authz. Отсюда бесплатно: RBAC, аудит, tenancy, транзакционность — **вся эта инфраструктура уже работает** (§7–8), AI-слою остаётся только ей воспользоваться. Именно это отличает «AI-native» от «прикрутили чатик».

**Конкретные образовательные сценарии** (функции внутри страниц КИС, не «ассистент вообще»):

- **Проверка документов абитуриентов:** фоновая задача извлекает поля пакета на поступление, сверяет комплектность, флагует расхождения. Модель извлекает — человек утверждает. Команда `admissions.application.flag` от актора `ai:*`.
- **Черновик расписания:** модель предлагает вариант; результат — не текст, а структурированное предложение, которое проходит `Validate()` (нет коллизий аудиторий/преподавателей) и создаётся командой `schedule.draft.create`. Модель как решатель, ядро как контролёр корректности.
- **Проверка ВКР через RAG** (§10): чанкование → сверка по векторному индексу → отчёт о совпадениях. Не вердикт, а материал для комиссии.
- **Пояснительные записки к бюджету:** по данным finance модель составляет черновик (дешёвая модель → сильная редактура важного). Бухгалтер правит и утверждает; проводки не трогаются.

**Три уровня встраивания:** действия в контексте страницы (кнопка «Разобрать» собирает промпт из структурированных данных — пользователь не пишет промпт); AI как исполнитель команд (function calling → аргументы десериализуются в тип команды → `Validate()` + authz + аудит — модель предлагает, ядро решает); фоновая аналитика (River-задачи по batch-тарифу).

**Тонкий gateway-слой `internal/platform/llm`** — единый интерфейс, все провайдеры OpenAI-совместимы (меняется base URL):

```go
type Client interface {
    Complete(ctx context.Context, req Request) (Response, error)
    Stream(ctx context.Context, req Request) (<-chan Chunk, error)
}
type Usage struct {
    PromptTokens, CompletionTokens int
    CostMicroUSD                   int64 // без usage нет бюджетов и cost-оптимизации
}
```

Цепочка декораторов (каждый — отдельный Client, оборачивает следующий): `Router → Budget → Cache → RateLimit → Fallback → OpenAICompat(provider)`. Budget проверяет лимит tenant'а до запроса (429 при исчерпании); Fallback: DeepSeek → Kimi → Gemini; для ПДн — только ru-restricted маршрут (GigaChat/YandexGPT, §20).

**Function calling = команды шины — механизм:** JSON Schema инструмента генерируется из типа команды (`go:generate` — схема как артефакт в репозитории, ревьюится); AI-слой отдаёт модели только подмножество команд, разрешённое роли `ai:*` политикой authz; `tool_call` десериализуется в тип команды → `bus.Dispatch` → обычный путь Validate/authz/аудит. Модель физически не может обойти проверки: она только предлагает аргументы, решает шина.

**RAG вместо «запихнуть всё в контекст»** (§10): векторный поиск релевантных чанков → компактный промпт. **Промпты — код:** файлы в `prompts/`, `go:embed`, версия в git, ревью в PR.

## 19. Стриминг *(roadmap)*

**SSE, не WebSocket.** Трафик AI-ответа односторонний (сервер→клиент), SSE проще, проходит через Caddy без апгрейда соединения, отлаживается curl. WebSocket — для будущего мессенджера.

```go
func (h *aiHandler) ask(w http.ResponseWriter, r *http.Request) {
    flusher, ok := w.(http.Flusher)
    if !ok { httpapi.WriteProblem(w, 500, "streaming unsupported", ""); return }
    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    // ctx запроса: клиент закрыл вкладку → стрим LLM отменяется → токены не жгутся
    chunks, err := h.llm.Stream(r.Context(), req)
    // for chunk := range chunks { fmt.Fprintf(w, "event: delta\ndata: %s\n\n", ...); flusher.Flush() }
}
```

SSE-контракт: `event: delta` (кусок текста), `event: usage` (финальная стоимость), `event: error` (problem+json). Правила: каждый Fprintf + `Flush()`; отдельный длинный WriteTimeout для SSE-роутов (`http.ResponseController.SetWriteDeadline`); heartbeat-комментарий раз в ~15с против таймаутов прокси.

## 20. Безопасность

Глубокий разбор — `docs/research/security.md`. Здесь — что делает Go-код. Статус: периметр, аутентификация, RLS и аудит — **реализованы**; AI-специфика — проектная.

**Периметр приложения (в коде):**

- таймауты сервера всегда (§4) — против Slowloris;
- `MaxBytesReader` + `DisallowUnknownFields` на каждом теле (§4);
- секреты только из env, никогда в логи/git (§12, §13);
- заголовки безопасности (HSTS/X-Content-Type-Options/X-Frame-Options/
  Referrer-Policy/Permissions-Policy/CSP) ставит и Caddy на проде, и сам
  `nexd` (`securityHeaders` middleware, `internal/platform/httpapi/middleware.go`)
  — так прямое обращение к `nexd` в обход прокси (docker-сеть, дев,
  неверная настройка прокси) тоже их получает; CORS — минимально
  необходимый (`internal/platform/httpapi/cors.go`);
- 5xx-ответы не отдают клиенту сырые внутренние ошибки (тексты pgx с
  именами таблиц/колонок и т.п.) — `WriteProblem` логирует полную
  причину server-side и возвращает generic detail
  (`internal/platform/httpapi/problem.go`);
- общий rate-limit на все мутирующие запросы (`mutationRateLimit`,
  `internal/platform/httpapi/ratelimit.go`) поверх отдельного, более
  строгого лимитера на `/auth/login` — раньше защиту имел только логин.

**Аутентификация (в коде, §9):** argon2id, opaque-сессии как sha256-хэш, httpOnly+Secure cookie, мгновенный отзыв, rate limiting, выравнивание времени ответа, единый 401. JWT как сессии не используем — нельзя отозвать.

**Авторизация (в коде):** RBAC в шине команд, не в HTTP-хендлерах — каждая команда объявляет `Permission()`, authz проверяет до исполнения, решение (allow/deny) в аудите. Запрос без актора отклоняется всегда.

**Изоляция данных (в коде, §7):** RLS с `FORCE` + tenant-транзакции + негативные тесты. Журнал аудита append-only на уровне БД (§8).

**AI-шлюз (в коде, `ai-gateway/` + `internal/platform/httpapi/aiproxy.go`):** браузер обращается только к `nexd`, не к `ai-gateway` напрямую — `nexd` берёт `tenant_id` из аутентифицированной сессии (не из заголовка, присланного клиентом) и подписывает исходящий запрос секретом, общим с `ai-gateway` (`NEX_AI_GATEWAY_SECRET`, проверяется `ai-gateway/app/deps.py:verify_gateway_secret`). Размер `system`/`history`/`context.facts` и тела запроса целиком ограничен (`ai-gateway/app/api/schemas.py`, `ai-gateway/app/core/limits.py`). Подробнее — `docs/ai/README.md`, §1.

**AI-специфика (проект, §18):** AI-актор получает минимальную роль (на старте только читающие команды); вывод модели, влияющий на действие, валидируется как недоверенный ввод (тот же `Validate()`); текст из БД/документов в промпте — недоверенный, системная инструкция и данные разделены; «lethal trifecta» (приватные данные + недоверенный ввод + внешняя коммуникация в одном контексте) — запрещена, пункт ревью.

**Инструменты:** `govulncheck ./...` (уязвимости зависимостей — в CI и локально через `make vuln`); gosec в golangci-lint; `go test -race` (гонки — баги безопасности); Dependabot следит за gomod/github-actions/npm(web)/pip(ai-gateway)/docker(корень и ai-gateway). Прогон OWASP ASVS L1→L2 — веха M11.

**152-ФЗ — не опция, а закон.** NEX обрабатывает ПДн студентов и сотрудников. Оговорка: это инженерные требования, не юридическая консультация; формулировки сверять по publication.pravo.gov.ru, при внедрении привлекать юриста. Технические следствия, встроенные в архитектуру:

- **Локализация (ст. 18 ч. 5):** первичные запись/хранение ПДн граждан РФ — только в БД на территории РФ. Prod-Postgres хостится в РФ; зарубежные AI-API не получают ПДн — только ru-restricted маршрут (GigaChat/YandexGPT) или анонимизация (ФИО → токен до промпта, обратная подстановка после).
- **Классификация:** public | internal | personal; personal включает ограничения маршрутизации и минимизации.
- **Прослеживаемость:** кто, когда и что изменил — append-only журнал с trace_id (§8), записи не удаляются и не редактируются даже ролью приложения.
- **ПДн не попадают в логи** — механизм `LogValuer` (§13).

Штрафы за нарушение локализации (ст. 13.11 КоАП) для юрлиц — миллионы рублей; вывод для инженерии один независимо от точной цифры: ПДн граждан РФ — на серверах в РФ, зарубежным моделям не передаём.

## 21. Observability

Три столпа, всё self-hosted (ADR-010, ADR-020): логи (slog→Loki), метрики (Prometheus), трейсы (OpenTelemetry). Плюс **аудит через шину — четвёртый, NEX-специфичный, уже работает** (§8).

**Что есть сейчас:** структурные логи с request_id на каждый запрос; `/healthz` (liveness, без зависимостей) и `/readyz` (readiness = БД отвечает); журнал аудита с trace_id — «кто, что, когда, исход» для каждой команды. Инцидент уже сегодня ищется по одному идентификатору в логах и журнале.

**Метрики Prometheus (M10):** `nex_http_request_duration_seconds` (гистограмма латентности по route/method/status), `nex_command_total{command,outcome}`, пул БД (`pgxpool.Stat()`), очередь River, AI-специфичные (`ai_cost_microusd_total{tenant,model}`, `ai_tokens_total`).

**Трейсы OTel (M10):** trace_id через весь запрос HTTP → command → SQL → LLM/job; тот же id, что request_id в логах и trace_id в аудите — инцидент ищется во всех системах сразу.

**Алерты (M10):** расход tenant'а > 80% AI-бюджета; error-rate провайдера LLM; p95 латентности > порога; `/readyz` красный. Ошибки — GlitchTip (Sentry-совместимый).

**Правило:** новый эндпоинт/команда → сразу метрика и запись аудита. Observability не прикручивают потом (аудит это правило уже выполняет: запись создаётся шиной автоматически для любой команды).

## 22. Производительность

**Правило №1: сначала измерь.** Go даёт профилирование из коробки — не угадывай.

- **pprof** (в dev за флагом): `import _ "net/http/pprof"` → `go tool pprof http://localhost:8080/debug/pprof/profile?seconds=30`.
- **Бенчмарки** для горячего кода: `for b.Loop() { ... }` (Go 1.24+), `go test -bench=. -benchmem`.

Практики NEX:

- `LogAttrs`, не `Info` в горячем пути (§13).
- `sync.Pool` — только если профиль показал аллокации узким местом, не заранее.
- Пул БД настроен, соединение не открывается на запрос.
- Стриминг больших ответов, не буферизация в память (§19).
- `-race` в тестах, но не в проде — замедляет в разы.
- **Индексы в PG важнее микрооптимизаций Go** — медленный запрос перевесит любую экономию в коде. `EXPLAIN ANALYZE` — первый инструмент при медленном эндпоинте.
- Не оптимизируй преждевременно: читаемый код по умолчанию; оптимизация — только с профилем на руках и бенчмарком до/после.

## 23. Масштабирование

**Философия: вертикально, пока хватает; горизонтально — когда осознанно понадобится.** Масштаб КИС-колледжа — один-два сервера.

**Ориентир: до ~5000 студентов на одном инстансе (2 vCPU) — гипотеза, не измеренный факт**; проверяется нагрузочным тестом (M8). Рассуждение: КИС — не соцсеть, 5000 студентов дают редкие всплески (запись на дисциплины, публикация сессии), а не постоянный поток. Первым упрётся Postgres (тяжёлые запросы), не Go-рантайм. k6-сценарий пика — `ramping-vus` до 200 одновременных студентов с порогами `p95<500, p99<1000` (профиль «первый день записи», не ровный поток).

**Read-реплики: read-your-writes обязателен.** Наивное «читаем из реплики» ломается: бухгалтер создал проводку, открыл список — реплика отстала, проводки нет. На реплику уходит только заведомо не-свежее чтение (аналитика, отчёты за прошлые периоды, RAG-поиск); чтение после записи — в мастер. По умолчанию — мастер; на реплику переносим осознанно и точечно. Пока один инстанс — проблемы нет вообще.

**Что уже готово к горизонтали:** stateless HTTP-слой (состояние в Postgres, сессии тоже); интерфейсы кэша и rate-limit абстрагируемы (при втором инстансе — в Valkey); River координируется через Postgres. **Что держит на одном инстансе сейчас:** in-process rate limiter (§9) и in-process кэш — оба переезжают в Valkey при втором инстансе, интерфейсы уже позволяют.

**Порядок роста:** вертикально → read-реплики для тяжёлого чтения → несколько nexd за балансировщиком + Valkey → вынос River-воркеров отдельным процессом (тот же бинарник, флаг) → разделение модулей на сервисы (только если конкретный модуль этого требует; границы §2 уже позволяют).

## 24. Docker / Kubernetes

**Docker сейчас, Kubernetes — почти наверняка никогда (ADR-018).** Масштаб не оправдывает операционную стоимость k8s.

Multi-stage Dockerfile: сборка в `golang:alpine` (версия из go.mod), рантайм в `distroless/static:nonroot` — нет shell, пакетного менеджера, лишней поверхности атаки, процесс не от root:

```dockerfile
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download           # слой кэшируется, пока go.mod/go.sum не менялись
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/nexd ./cmd/nexd

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/nexd /nexd
USER nonroot
ENTRYPOINT ["/nexd"]
```

`CGO_ENABLED=0` → статический бинарник; `-trimpath -ldflags="-s -w"` → меньше размер, нет путей сборки. Миграции встроены в бинарник (§6) — образу не нужны файлы рядом.

**Dev** — Docker Compose (`compose.yaml`): Postgres 17. `make dev` поднимает окружение. **Prod** — Compose + Caddy (авто-TLS, статика фронта) + Postgres, включается на M9.

Если k8s всё-таки понадобится: образ уже есть, `/healthz` (liveness) и `/readyz` (readiness) уже реализованы под пробы — миграция это конфиг, не переписывание.

## 25. CI/CD

**GitHub Actions** (`.github/workflows/ci.yml`, ADR-019). Пайплайн на каждый PR и push в main — **с реальным Postgres для интеграционных тестов**:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    env: { POSTGRES_USER: nex, POSTGRES_PASSWORD: nex, POSTGRES_DB: nex }
    ports: ["5432:5432"]
    options: >-
      --health-cmd "pg_isready -U nex -d nex" --health-interval 5s ...

steps:
  - uses: actions/setup-go@v5
    with: { go-version-file: go.mod }   # версия из go.mod, один источник истины
  - uses: golangci/golangci-lint-action@v8
  - name: Tests (race + Postgres)
    env: { NEX_TEST_DATABASE_URL: "postgres://nex:nex@localhost:5432/nex?sslmode=disable" }
    run: go test -race ./...
  - run: go build ./...
  - run: govulncheck ./...
```

**Гейты merge:** зелёный CI обязателен — линт (ноль замечаний), race-тесты вместе с интеграционными против Postgres, сборка, govulncheck.

**CD (M9):** сборка образа → GHCR → деплой по git-тегу на staging, затем prod. Rollout AI-фич за флагом: staging → пилотный tenant → все. Dependabot автоматизирует обновления зависимостей.

## 26. Чек-лист

Прежде чем открыть PR:

- [ ] `make lint` и `make test` (с `-race`) зелёные локально; перед пушем — `make test-db` против локального Postgres
- [ ] Изменения данных идут через шину команд, не прямым SQL из хендлера
- [ ] Новая команда: `Name()` стабильно, `Permission()` объявлено, `Validate()` покрывает инварианты
- [ ] Каждая доменная таблица несёт `tenant_id` + RLS-политику **с FORCE и NULLIF-паттерном** (§7)
- [ ] Новые SQL-запросы — в `platform/postgres/queries/`, прогнан `make sqlc`, сгенерированный код закоммичен
- [ ] Запросы к tenant-таблицам ходят через `InTenantTx`, не через голый пул
- [ ] Изменения API начались со спеки `api/openapi.yaml` (M5)
- [ ] Тесты на новое поведение, включая негативные и изоляцию tenant'ов
- [ ] Деньги — `int64` в минорных единицах; время — UTC `timestamptz`; ID генерирует БД
- [ ] Ошибки обёрнуты `%w`, проверяются `errors.Is`, на границе HTTP → problem+json
- [ ] I/O принимает и уважает `context.Context`; горутины умеют завершаться
- [ ] Секреты и ПДн не попадают в логи (LogValuer для новых типов с ПДн)
- [ ] Новая прямая зависимость → строка в `decision-log.md`
- [ ] Новый эндпоинт/команда → запись аудита (шина делает сама) и метрика (M10)
- [ ] AI-код: вывод модели валидируется как недоверенный ввод; недоверенный текст не смешан с системной инструкцией

## 27. Оптимизация под слабое железо

**Целевое железо — VPS $20–50/мес: 2 vCPU, 4 ГБ RAM, SSD.** Из этого выводятся жёсткие бюджеты: бинарник < 50 МБ, старт < 1 сек, локальные LLM не держим — AI только через внешние API.

**Go runtime под ограниченную память.** Главная угроза на 4 ГБ — OOM-killer. GC Go по умолчанию не знает о лимите памяти машины. Лечится `GOMEMLIMIT` (soft limit, стабилен с Go 1.19) — и обязательно **вторым, жёстким уровнем**:

- **Мягкий:** `GOMEMLIMIT=1300MiB` (через env или `debug.SetMemoryLimit`) — GC работает агрессивнее у потолка.
- **Жёсткий:** systemd `MemoryMax=1500M` в unit-файле nexd.service (или `mem_limit` в Compose) — cgroup v2 убьёт процесс предсказуемо, с логом, а не случайный OOM-killer выберет жертву. Мягкий лимит ставим на ~10–15% ниже жёсткого: GOMEMLIMIT учитывает только кучу рантайма Go.

`GOGC` не трогаем без замера (дефолт разумен). `GOMAXPROCS` — в контейнере с CPU-квотой проверить, что рантайм не видит все ядра хоста.

**Размер бинарника < 50 МБ** — потолок для мониторинга, не запас: `CGO_ENABLED=0 go build -trimpath -ldflags="-s -w"` (минус ~30% на символах и DWARF). Реальный nexd с pgx+goose — заметно меньше, но каждая тяжёлая зависимость (excelize, otel) откусывает мегабайты. Бюджет проверяется шагом CI (`test -s` + порог), не декларируется.

**Старт < 1 сек.** Go-бинарник стартует мгновенно; медлит установление связей:

- Пул БД — лениво: `pgxpool` открывает соединения по требованию, стартовый `Ping` — с таймаутом 5 сек (реализовано в `Connect`).
- Миграции при старте — осознанный компромисс для монолита в один инстанс: goose быстр и идемпотентен, отдельный шаг деплоя не нужен. Если рестарт под нагрузкой станет ждать долгой миграции — переключаемся на явный `nexd migrate` в деплое (команда уже есть), это конфиг, не код.
- Никаких тяжёлых `init()` — всё в `run()`, лениво где можно.

**AI — только внешние API:** на 4 ГБ без GPU локальная LLM невозможна физически. Ollama — опция для колледжа с отдельным GPU-сервером ради ПДн-контура.

**Бюджеты как тест:** размер бинарника — шаг CI; RSS под нагрузкой — k6-прогон с GOMEMLIMIT; старт — `time ./nexd` с немедленным SIGTERM. Превышение порога — красный CI.

## 28. Миграция с 1С *(roadmap)*

Колледж не переходит «в один день». Миграция — управляемый процесс с параллельным периодом и планом отката. Задача Go-кода — сделать импорт **идемпотентным**, а сверку — автоматической.

**Схема:** выгрузка из 1С (ОСВ, обороты, ростер) → конвертер в OneRoster CSV → River-воркер `import.oneroster` → команды шины → сверка балансов против ОСВ → переключение.

**Шаги и честные оценки:**

1. **Выгрузка из 1С — отдельный мини-проект.** 1С не знает OneRoster «из коробки»; конвертер пишется и отлаживается на реальной выгрузке конкретной редакции (структура 1С:Колледж ≠ 1С:Университет). Дни–недели на первую редакцию; дальше конвертер переиспользуется у всех колледжей на той же редакции.
2. **Импорт через River-воркер** — фоновая задача, идемпотентная по естественному ключу (номер счёта, СНИЛС/студбилет). Каждая строка — команда шины (валидация, authz актора `import:*`, аудит происхождения данных — критично для 152-ФЗ). Ошибка строки не роняет батч — копится отчёт.
3. **Параллельный период:** 1С в read-only, NEX в write, неделя-две, бухгалтерия сверяет.
4. **Сверка балансов:** автоматический отчёт — сальдо каждого счёта NEX против ОСВ 1С. Расхождение — стоп-фактор.
5. **Переключение** — когда сверка чистая N дней подряд.

**План отката — честно:** в первые часы/день откат дёшев (1С стоит в read-only, дельта мала — часы работы). После недель работы «откат в 1С» — уже обратная миграция (дни + риск потерь). Реальная страховка — надёжность самого NEX + бэкапы его БД (pg_dump/pgBackRest): откат к последнему консистентному состоянию NEX быстрее и безопаснее возврата в 1С. Быстрый откат держим только на первые дни и репетируем на staging.

**Требование к API для offline/повторов:** идемпотентность записи по клиентскому ключу (`Idempotency-Key`) — сервер запоминает результат по ключу в пределах tenant, повтор возвращает тот же результат, не исполняя команду дважды. Появится вместе с модулем imports.

## 29. Дорожная карта модулей

Порядок — по критерию «даёт данные другим / заменяет самый дорогой кусок 1С». Каждый модуль — по §3.

| Модуль | Статус | Заменяет в 1С | Приоритет | AI-интеграция (актор ai:*) |
|---|---|---|---|---|
| finance | **работает на Postgres** (леджер, RLS, транзакционный аудит) | 1С:Бухгалтерия колледжа | готов | записки к бюджету, флаг аномальных проводок |
| kernel/auth | **работает** (сессии, argon2id, роль admin) | — | готов (M4: роли) | — |
| campus | следующий | 1С:Колледж (студенты, группы, оценки) | P0 | даёт данные остальным |
| admissions | после campus | приёмная кампания | P0 | проверка комплектности документов |
| schedule | после campus | расписание | P1 | генерация расписания (решатель) |
| payroll | после finance+campus | расчёт зарплат | P1 | проверка ведомостей на аномалии |
| reports | сквозной | отчёты/печатные формы | P1 | генерация текстов отчётов (§31) |
| library | позже | библиотека | P2 | семантический поиск по фонду (§10) |
| dormitory | позже | общежитие | P2 | — |

**Почему campus раньше admissions,** хотя приёмка сезонна: admissions создаёт студентов, но живут они в campus; без модели campus (группы, программы, оценки) admissions некуда писать. Сначала домен-приёмник данных, потом источники.

**Правило интеграции модулей:** межмодульная связь только через доменные события ядра. campus публикует `student.enrolled` → dormitory и library подписываются. Прямых импортов пакетов между модулями нет (§1); проверяется линтером (depguard — добавить при втором модуле).

## 30. Госинтеграции *(roadmap)*

Три обязательные для колледжа РФ интеграции. Общие принципы: каждая — отдельный адаптер в `internal/platform/` за интерфейсом, объявленным потребителем (§1); все обращения — через River (госсистемы медленные и нестабильные); circuit breaker обязателен.

**ФИС ФРДО — выгрузка сведений о дипломах.** Сведения о выданных документах вносятся в установленный срок (для ряда программ — 60 дней, ПП РФ №2123). XML через `encoding/xml`; актуальную XSD брать из личного кабинета оператора и фиксировать версию схемы в коде. Подпись КЭП — внешний сервис подписи (§31), не Go. Идемпотентность: повторная выгрузка не создаёт дубль — воркер проверяет статус по номеру документа.

**СМЭВ — проверка данных (паспорта и др.).** Модель «запрос → квитанция → ответ позже»: UI не ждёт, показывает «проверяется», результат приходит фоновой задачей и записывается командой. Circuit breaker обязателен (СМЭВ регулярно недоступна; 5 сбоев подряд → окно быстрых отказов). **SOAP + WS-Security + ГОСТ на Go вручную — НЕ делаем:** это тысячи строк криптографически чувствительного кода, юридически требующего сертифицированного СКЗИ. Решение — внешний сертифицированный шлюз СМЭВ рядом; модуль `smev` формирует бизнес-данные и общается со шлюзом по простому HTTP. Go отвечает за оркестрацию, не за криптотранспорт.

**ЕПГУ (Госуслуги) — подача документов абитуриентами.** Приём заявлений → команда `admissions.application.create` от актора `epgu:*`; через River, идемпотентно по номеру заявления. Аутентификация ИС в ЕСИА (взаимный TLS, сертификат): ключи не в бинарнике и не в git — файл 0400 / смонтированный секрет, путь через env; ротация — регламентная процедура с алертом за N дней.

**Общее правило:** внешняя система — недоверенный и ненадёжный источник. Данные валидируются как пользовательский ввод, обращения изолированы breaker'ом и таймаутами, всё через очередь. Ни одна интеграция не блокирует HTTP-ответ пользователю.

## 31. Отчётность *(roadmap)*

Колледж живёт на бумаге: приказы, справки, ведомости, дипломы, отчёты в министерство. Форматы — PDF (печать/подпись), XLSX (министерство), HTML (просмотр). **Догмат: шаблоны — часть кода** (`go:embed` + `html/template`), а не внешние файлы, которые потеряются. `html/template`, не `text/template` — автоэкранирование против инъекций (в отчёты попадают ФИО и комментарии — недоверенные данные).

**Форматы и библиотеки:**

- HTML — stdlib `html/template`.
- XLSX — компромисс per-отчёт: простая табличная выгрузка = ручная сборка OOXML (это ZIP с XML: `archive/zip` + `encoding/xml`, ~сотни строк, ноль зависимостей); сложные книги со стилями/формулами = excelize (мощный, но тяжёлый). Выбор — ADR модуля reports.
- PDF — простые формы (справка, квитанция) = нативная генерация (gofpdf/maroto) на основном хосте. Сложная вёрстка (диплом, многостраничный отчёт) = HTML→PDF, но **headless-браузер на 4-ГБ хосте не запускаем вообще** (+100–200 МБ RAM — путь к OOM, §27): только отдельный сервис/хост рендера, вызываемый по HTTP.

**AI-генерация текстов:** числа считает код (детерминированно — галлюцинации в деньгах недопустимы), модель формулирует прозу вокруг посчитанных цифр. Черновик, человек утверждает.

**Подпись КЭП:** Go не реализует ГОСТ-криптографию — вызывает внешний сервис подписи (CryptoPro DSS REST API или локальный CSP); интерфейс `Signer` объявляет потребитель (reports/frdo), ключи живут в HSM на стороне DSS. Своя реализация ГОСТ на Go юридически ничтожна.

## 32. Филиалы и offline *(roadmap)*

Колледжи имеют филиалы с плохой связью. Требование: базовая работа при обрыве + разумная синхронизация. **Догмат: не кластер Postgres** (Patroni/Citus операционно неподъёмны для одного админа).

**Offline на фронте — Service Worker + оптимистичный UI:** статика кэшируется, операции при обрыве встают в очередь IndexedDB, при восстановлении связи повторяются. **Требование к Go-API — идемпотентность записи по `Idempotency-Key`** (§28), иначе повтор из очереди создаст дубль.

**Синхронизация филиалов — два варианта по бюджету связи:** read-replica Postgres в филиале (читает локально, пишет в центр; стандартная потоковая репликация, один админ справится) — если связь есть, но медленная; API-синхронизация (филиал — отдельный nexd со своей БД, обмен батчами через идемпотентный импорт) — если связь регулярно рвётся. Выбор — ADR при первом филиале-заказчике.

## 33. Экономика внедрения (TCO)

**Главная ценность NEX — не фичи, а стоимость владения.** Цифры — ориентиры для сравнения подхода, не коммерческое предложение.

| Статья (3 года) | 1С:Колледж (типовой путь) | NEX |
|---|---|---|
| Лицензии ПО | платформа + рабочие места + ИТС-подписка | 0 (open-source стек, §5) |
| Сервер | Windows Server (лицензия) + железо | 1 Linux VPS $20–50/мес |
| Внедрение | франчайзи, недели-месяцы | миграция по §28, дни-недели |
| Сопровождение | «одинэсник» + доработки | один админ + разработчик по необходимости |
| Обновления | платные (ИТС/релизы) | git tag + CI (§25) |

**Откуда экономия — по-инженерному:** нет лицензий (весь стек open-source и обоснован ADR); дешёвое железо (один статический бинарник на 2 vCPU/4 ГБ); один админ (монолит: один процесс, один systemctl, один лог); бесплатные обновления (деплой = git tag + CI).

**Честные оговорки:**

- **Стоимость разработки NEX и TCO — раздельно.** TCO выше — эксплуатационная стоимость готовой системы; стоимость создания NEX на одном колледже не окупается — модель работает при тиражировании (мультитенантность амортизирует разработку на много колледжей).
- **1С зрелее** — за лицензии платят в том числе за готовые формы отчётности под меняющееся законодательство. NEX догоняет это модулями reports и интеграциями — это работа, а не данность.
- **«3× дешевле внедрение / 5× дешевле поддержка» — гипотеза-цель,** проверяемая сметой первого внедрения, а не обещание. Где NEX выигрывает однозначно: лицензии (0 против сотен тысяч) и платные обновления. Где не факт: кастомные доработки могут съесть экономию. Реальное число заказчику — только после расчёта под его редакцию 1С и объём доработок.

**Вывод для техлида:** TCO — следствие всех предыдущих архитектурных решений (монолит, stdlib, один бинарник, дешёвое железо), а не отдельная фича. Каждый догмат из §1–2 в конечном счёте про то, чтобы колледж платил в разы меньше и сопровождал систему силами одного человека.

---

*Живой документ. Расходится с кодом — прав код, правь гайд PR'ом. Связанные документы: `decision-log.md`, `how-to-write-a-module.md`, `roadmap.md`, `docs/ai/`, `docs/research/`, `learning/resources.md`.*
