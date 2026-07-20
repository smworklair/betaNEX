# Go в betaNEX: инженерное руководство

Это рабочая документация по языку Go **применительно к этому проекту**. Не учебник Go — учебные ссылки в [learning/resources.md](http://../learning/resources.md). Здесь — как мы пишем betaNEX: решения, паттерны, готовый код. Всё согласовано с [decision-log.md](http://decision-log.md) (ADR-001…021) и реальной кодовой базой (`internal/kernel`, `internal/module/finance`, `internal/platform/httpapi`).

Правило чтения: если код в этом гайде расходится с кодом в репозитории — прав репозиторий, а гайд надо поправить PR'ом.

## Оглавление

1. [Философия: почему Go и как мы на нём пишем](#bookmark=id.5ezb0qa4d5m6)  
2. [Архитектура проекта](#bookmark=id.1a0svpa8obby)  
3. [Структура модуля](#bookmark=id.4y5pboocaou9)  
4. [HTTP-стек](#bookmark=id.lhtyc7sh7zm3)  
5. [Библиотеки: что берём и что нет](#bookmark=id.p2gvwi2640e8)  
6. [PostgreSQL: pgx \+ sqlc](#bookmark=id.ptvj3whxf8y5)  
7. [pgvector: embeddings и RAG](#bookmark=id.91qav83y5d2q)  
8. [Кэш: in-process → Valkey](#bookmark=id.9up8wqxwl0bg)  
9. [Конфигурация](#bookmark=id.1dptjdhu9vgc)  
10. [Логирование (slog)](#bookmark=id.ogb110atn3pl)  
11. [Ошибки](#bookmark=id.tznd1dhlngk5)  
12. [Конкурентность и контексты](#bookmark=id.3ve1tjy1ponb)  
13. [Тестирование](#bookmark=id.7qt0ocpl0wvq)  
14. [Очереди и фоновые задачи (River)](#bookmark=id.tkjb3mfz846b)  
15. [AI-интеграция: LLM не как чатик](#bookmark=id.d1xkiosbfytd)  
16. [Стриминг (SSE)](#bookmark=id.ov3eqp5do0fi)  
17. [Безопасность](#bookmark=id.jjkrbfrz8oj)  
18. [Observability](#bookmark=id.ghquqodh6j0q)  
19. [Производительность](#bookmark=id.5uobsfm4vp0w)  
20. [Масштабирование](#bookmark=id.faor6m8co768)  
21. [Docker / Kubernetes](#bookmark=id.xt2i97qluurv)  
22. [CI/CD](#bookmark=id.1adpj2ddprqw)  
23. [Чек-лист «прежде чем открыть PR»](#bookmark=id.hmbopm3i99z5)  
24. [Оптимизация под слабое железо](#bookmark=id.eup8d7e9auzz)  
25. [Миграция с 1С и Битрикс](#bookmark=id.xf2ccll73vek)  
26. [Дорожная карта модулей](#bookmark=id.fdfa1174i95j)  
27. [Интеграции с госсистемами](#bookmark=id.o48hrivso3g6)  
28. [Отчётность и печатные формы](#bookmark=id.1aduwnojtt8f)  
29. [Филиалы и offline-режим](#bookmark=id.3c3tg0my5lmc)  
30. [Экономика внедрения (TCO)](#bookmark=id.eoa74o6sua48)

---

## 1\. Философия

**Почему Go (ADR-001).** betaNEX — модульный монолит: один статический бинарник `nexd`, встроенная конкурентность, быстрая компиляция, обратная совместимость Go 1.x на годы вперёд. Для долгоживущего ядра КИС это важнее «выразительности».

**Как мы пишем — четыре правила, из которых следует всё остальное:**

1. **stdlib-first.** Зависимость добавляется, только когда stdlib реально не хватает, и это фиксируется в ADR. `net/http`, `log/slog`, `context`, `errors`, `testing`, `encoding/json` покрывают 80% проекта.  
2. **Зависимости направлены внутрь.** `cmd → module → kernel`; `kernel` не импортирует ничего из проекта выше себя. Модули не импортируют друг друга. Нарушение — ошибка архитектуры, а не стиля.  
3. **Интерфейсы объявляет потребитель, а не поставщик.** `command.Authorizer` объявлен в пакете `command`, реализован в `authz` — поэтому `command` не зависит от `authz`. Это ключевой приём удержания зависимостей внутрь.  
4. **Явное лучше неявного.** Никаких глобалей, `init()`\-магии, скрытых синглтонов. Всё конструируется в композиционном корне (`cmd/nexd/main.go`) и передаётся вниз явно.

**Форматирование и стиль:** `gofumpt` (строже `gofmt`), `golangci-lint` (конфиг `.golangci.yml`). Именование — по [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments) и [Google Go Style Guide](https://google.github.io/styleguide/go/). Комментарии в новых пакетах — на русском (правило проекта, см. CONTRIBUTING).

**Go-версия:** объявлена в `go.mod` (`go 1.24`). CI берёт версию оттуда (`setup-go` с `go-version-file`). Обновление версии — отдельный PR.

---

## 2\. Архитектура проекта

**Почему модульный монолит, а не микросервисы и не 1С-клиент-сервер.** Целевой заказчик — колледж с одним админом и сервером уровня «школьная серверная» (4–8 ГБ RAM, 2–4 vCPU). Из этого следует всё:

- **Не микросервисы.** Микросервисы платят за независимое масштабирование сетевыми вызовами, распределёнными транзакциями, отдельными деплоями и наблюдаемостью каждого сервиса. У колледжа нет нагрузки, которая это оправдывает. Аргумент не в том, что «админ не поднимет Kubernetes» (типовой админ колледжа не поднимет и Docker без инструкции — 1С ему ставит и настраивает франчайзи). Аргумент в **операционной простоте эксплуатации**: монолит — это один файл `nexd`, один сервис systemd, один лог, один порт, один бэкап БД. Обновление — заменить файл и перезапустить сервис. Диагностика — `journalctl -u nexd` и `/healthz`. Это тот уровень, который сопровождаемо силами одного невыделенного человека. Микросервисы дают N логов, N деплоев, сетевые сбои между сервисами — цену, которую платят люди, а не процессор.  
    
- **Не 1С-клиент-сервер.** 1С требует лицензий, толстого клиента, платформы Windows-сервера и специалиста-«одинэсника». betaNEX — web-first: клиент это браузер, сервер это один статический бинарник Go под Linux на дешёвом VPS. Ноль лицензий, ноль платформенного вендор-лока.  
    
- **Но модульный — и вот конкретный механизм выноса.** «Границы проведены» — это не декларация, а следствие трёх правил: модуль зависит только от `kernel`/`platform`, модули не импортируют друг друга, межмодульная связь — только через доменные события шины. Пока всё в одном процессе, событие доставляется in-process (вызов подписчиков после коммита). Что физически меняется, если завтра `finance` надо вынести в отдельный процесс:  
    
  1. **Внутримодульные вызовы уже отсутствуют** — никакой код вне `finance` не импортирует его пакеты, так что «отрезать» нечего. Проверяется тестом архитектуры (`go list`/`depguard` в golangci-lint запрещает импорт `module/finance` из других модулей).  
  2. **Меняется только транспорт событий.** Сейчас `event.Bus` публикует события внутри процесса. При выносе `finance` его подписки переключаются с in-process на сетевой транспорт — River (задачи из Postgres, если БД общая) либо HTTP/gRPC между процессами (если БД разделяют). Подписчики не меняются: они по-прежнему получают `student.enrolled`, не зная, пришло оно из соседнего пакета или по сети.  
  3. **В `cmd/nexd/main.go` блок сборки `finance` (репозиторий → RegisterCommands → Routes) переезжает в новый `cmd/finance/main.go`** — тот же код композиции, другой бинарник. Остальные модули в `nexd` не трогаются.


  Мы платим за эту возможность дисциплиной зависимостей (три правила выше \+ линтер), а не инфраструктурой. Пока вынос не нужен — событие остаётся in-process, накладных расходов ноль. **Решение о выборе транспорта (River vs HTTP vs gRPC) принимается в момент реального выноса и фиксируется ADR — сейчас его не предрешаем.**

Итог: сложность архитектуры соответствует бюджету и штату заказчика, а не моде.

Модульный монолит (ADR-002). Три уровня, зависимости строго внутрь:

cmd/nexd/            композиционный корень: читает конфиг, конструирует всё, запускает

  main.go            ← единственное место, где всё «склеивается»

internal/kernel/     доменно-независимое ядро

  identity/          кто актор (Actor в контексте)

  tenancy/           в каком tenant'е (TenantID в контексте)

  authz/             что разрешено (RBAC-политика \+ PolicyAuthorizer)

  command/           шина: Validate → Authorize → Handle → Audit

  event/             доменные события

  audit/             append-only журнал

internal/module/     доменные модули (finance, позже campus/messenger/mail/ai)

internal/platform/   адаптеры инфраструктуры (httpapi, logging, postgres, llm, jobs)

**Композиционный корень — сердце архитектуры.** Всё живёт в `run()` (не в `main()`, чтобы возвращать ошибку, а не `os.Exit`). Пример из реального `cmd/nexd/main.go`:

func run() error {

    cfg, err := config.Load()

    if err \!= nil { return err }

    log := logging.New(os.Stdout, cfg.Log.Level, cfg.Log.Format)

    // Ядро: политика → авторизатор → шина с аудитом.

    policy := authz.NewPolicy()

    for \_, role := range \[\]string{"admin", "accountant"} {

        policy.Grant(role, finance.PermAccountsWrite)

        policy.Grant(role, finance.PermEntriesPost)

    }

    bus := command.NewMemoryBus(authz.NewPolicyAuthorizer(policy), audit.NewSlogRecorder(log))

    // Модуль: репозиторий → регистрация команд → маршруты.

    finRepo := finance.NewMemoryRepository()

    if err := finance.RegisterCommands(bus, finRepo); err \!= nil { return err }

    router := httpapi.NewRouter(log, httpapi.RouterConfig{

        DevAuth: cfg.Env \== config.EnvDevelopment,

        Mount:   \[\]func(\*http.ServeMux){ finance.Routes(bus, finRepo) },

    })

    // ... server.Run(ctx)

}

Добавить новый модуль \= добавить блок «репозиторий → RegisterCommands → Routes» сюда. Ни один существующий файл не меняется, кроме этого.

**Спайн Commands → Events → Audit.** Единственный путь изменения данных. Хендлеры не пишут в БД напрямую — они отправляют команду в шину, которая делает валидацию, авторизацию, исполнение и аудит одним проходом. Это даёт бесплатно: единую точку RBAC, полный аудит «кто что сделал», и (с вехой M2) транзакционность. **AI встраивается сюда как ещё один актор** — см. §15.

---

## 3\. Структура модуля

Канонический модуль (эталон — `internal/module/finance`). Файлы по ответственности, не по типам:

internal/module/\<name\>/

  doc.go          package-комментарий: границы домена (по-русски)

  \<entity\>.go     доменные типы и инварианты (finance: ledger.go)

  commands.go     типы команд: Name() / Permission() / Validate()

  handlers.go     HandlerFunc'и \+ RegisterCommands(bus, repo)

  events.go       доменные события (реализуют event.Event)

  repo.go         интерфейс Repository \+ sentinel-ошибки

  memrepo.go      in-memory реализация — ТОЛЬКО демо/скетч (см. врезку ниже)

  http.go         Routes(bus, repo) \+ DTO \+ маппинг ошибок в HTTP

  \*\_test.go       рядом с кодом

**Команда** — это намерение изменить состояние. Минимальный контракт (`kernel/command/command.go`):

type Command interface {

    Name() string       // "finance.entry.post" — стабильно, попадает в аудит

    Permission() string // "finance:entries:post" — проверяет authz

    Validate() error    // инварианты входа ДО обращения к БД

}

Реальный пример команды с главным доменным инвариантом (баланс дебет=кредит):

func (c PostEntry) Validate() error {

    if len(c.Lines) \< 2 {

        return errors.New("finance: entry needs at least two lines")

    }

    var debit, credit int64

    for i, l := range c.Lines {

        if l.Amount \<= 0 {

            return fmt.Errorf("finance: line %d: amount must be positive", i)

        }

        switch l.Side {

        case Debit:  debit \+= l.Amount

        case Credit: credit \+= l.Amount

        default:     return fmt.Errorf("finance: line %d: unknown side %q", i, l.Side)

        }

    }

    if debit \!= credit {

        return fmt.Errorf("%w: debit %d \!= credit %d", ErrUnbalanced, debit, credit)

    }

    return nil

}

**Про `memrepo.go` — честно.** In-memory репозиторий ведёт себя **не как Postgres**: нет транзакций, нет RLS, нет `RETURNING`, нет `FOR UPDATE`, нет уникальных индексов БД. Это тот же мок, о котором §13 говорит «моки БД врут о поведении» — только в проде. Поэтому статус `memrepo` строго ограничен:

- **Что он есть:** скетч для запуска HTTP-слоя и демо API до готовности слоя Postgres (M1/M2); полигон для юнит-тестов чистой доменной логики (валидация команд), где БД не участвует.  
- **Чем он НЕ является:** не боевое хранилище и не основа для тестов, проверяющих поведение БД. Тесты, которые должны ловить нарушение RLS, гонку на `FOR UPDATE` или конфликт уникального индекса, обязаны идти против реального Postgres в testcontainers (§13).  
- **План замены:** к концу вехи M2 каждый модуль имеет `pgrepo.go` (pgx+sqlc); `memrepo.go` остаётся только там, где им пользуются юнит-тесты доменной логики, и **никогда** не монтируется в `cmd/nexd/main.go` в конфигурации `NEX_ENV=production` — композиционный корень при `production` выбирает `pgrepo`, а `memrepo` за флагом только в dev/demo. Это проверяется тестом композиции.

**Правила модуля** (полный список — [how-to-write-a-module.md](http://how-to-write-a-module.md)): зависит только от kernel/platform; изменения данных только через шину; каждая таблица несёт `tenant_id` \+ RLS; деньги — `int64` в минорных единицах, никогда float; именование `модуль.сущность.глагол` / `модуль:сущность:действие`.

---

## 4\. HTTP-стек

**Без фреймворка (ADR-002): `net/http` \+ `ServeMux`.** С Go 1.22 роутер stdlib умеет методы и path-параметры — 90% ценности chi бесплатно, ноль зависимостей в самом критичном слое.

**Роутинг по методу** (`platform/httpapi/routes.go`):

mux.Handle("GET /healthz", handleHealthz())

mux.Handle("GET /readyz", handleReadyz(cfg.Ready))

// path-параметр: mux.HandleFunc("GET /api/v1/finance/accounts/{id}", ...)

//   id := r.PathValue("id")

**Middleware — обычные `func(http.Handler) http.Handler`.** Порядок в betaNEX (внешний → внутренний): `requestID → requestLogger → [devIdentity] → recoverer → handler`. requestID снаружи, чтобы каждая строка лога несла id; recoverer внутри, чтобы ловить панику любого хендлера. Цепочка собирается функцией `chain`:

func chain(h http.Handler, mws ...middleware) http.Handler {

    for i := len(mws) \- 1; i \>= 0; i-- {

        h \= mws\[i\](h)

    }

    return h

}

**Ответы — единые хелперы** (`platform/httpapi/problem.go`), ошибки в формате RFC 9457 (ADR-003):

httpapi.WriteJSON(w, http.StatusCreated, resp)

httpapi.WriteProblem(w, http.StatusForbidden, "Доступ запрещён", err.Error())

// Content-Type: application/problem+json

**HTTP-хендлер модуля тонкий**: распарсить → собрать команду → `bus.Dispatch` → замапить ошибку. Никакой логики в хендлере. Маппинг ошибок ядра в статусы (`finance/http.go`):

func writeCommandError(w http.ResponseWriter, err error) {

    switch {

    case errors.Is(err, authz.ErrDenied):

        httpapi.WriteProblem(w, http.StatusForbidden, "Доступ запрещён", err.Error())

    case errors.Is(err, ErrAccountNotFound):

        httpapi.WriteProblem(w, http.StatusNotFound, "Счёт не найден", err.Error())

    case errors.Is(err, ErrUnbalanced):

        httpapi.WriteProblem(w, http.StatusUnprocessableEntity, "Проводка отклонена", err.Error())

    default:

        httpapi.WriteProblem(w, http.StatusInternalServerError, "Внутренняя ошибка", err.Error())

    }

}

**Декодирование тела — безопасно по умолчанию**: лимит размера \+ запрет неизвестных полей.

r.Body \= http.MaxBytesReader(w, r.Body, 1\<\<20) // 1 МБ

dec := json.NewDecoder(r.Body)

dec.DisallowUnknownFields()

if err := dec.Decode(dst); err \!= nil { /\* 400 \*/ }

**Сервер — с таймаутами всегда** (`platform/httpapi/server.go`, значения из конфига): `ReadTimeout`, `WriteTimeout`, `IdleTimeout` и graceful shutdown по контексту. Сервер без таймаутов — открытая дверь для медленных клиентов (Slowloris).

**Когда добавить chi:** если понадобятся вложенные группы роутов с общими middleware и их станет больно писать на stdlib — chi совместим с `net/http` и добавляется без переписывания. Не раньше.

**Требование латентности: \< 500 мс на 3G.** Региональные колледжи сидят на плохом интернете; студент открывает страницу с телефона в общаге. Это бюджет, в который обязан уложиться каждый эндпоинт. Следствия для Go-кода:

- **Отдавать мало байт.** JSON компактен; списки — с пагинацией, не «все проводки разом». Caddy жмёт gzip/zstd, но сжимать нужно уже небольшой ответ.  
- **Один round-trip, не N.** Данные страницы — одним-двумя запросами к БД, не десятком (N+1 — §6). На 3G каждый лишний round-trip — сотни миллисекунд RTT.  
- **Стриминг для долгого** (§16): AI-ответ/большой отчёт отдаётся по мере готовности (SSE), а не «8 секунд белый экран».  
- **Тяжёлое — в фон** (§14): отчёт, импорт уходят в River, страница отвечает сразу.  
- **Метрика — это TTFB конкретного API-запроса, а не «загрузка страницы».** Важное уточнение, чтобы не оптимизировать не то: сервер может ответить за 10 мс, но страница из десятков ресурсов (JS, CSS, шрифты) на 3G грузится секундами — это забота фронта (бандл, code-splitting, HTTP-кэш, число ресурсов), не Go. Бюджет betaNEX-бэкенда — **p95 TTFB (time to first byte) отдельного `/api/v1/*` запроса заведомо ниже 500 мс** (гистограмма `nex_http_request_duration_seconds`, §18), чтобы сетевой RTT 3G (200–600 мс) съедал остаток общего бюджета, а не наш код. Смотрим p95/p99, не среднее.  
- **JSON Go по умолчанию не самый компактный, но и не проблема.** `encoding/json` не вставляет лишних пробелов (в отличие от `MarshalIndent`), так что «пробелы» — миф; реальные рычаги: короткие, но читаемые имена полей в DTO; `omitempty` для необязательных; `json.NewEncoder(w).Encode` пишет прямо в поток без промежуточного буфера. `SetEscapeHTML(false)` — только для не-HTML контекстов (мы отдаём JSON, не HTML, экранирование `<>&` можно отключить ради размера и читаемости). Бинарные форматы (msgpack/protobuf) для КИС **не берём**: экономия байт не окупает потерю отлаживаемости `curl`'ом и человекочитаемости; JSON+gzip на текстовых данных сжимается отлично. Пересмотрим, только если профиль покажет сериализацию узким местом (маловероятно на CRUD-трафике колледжа).

---

## 5\. Библиотеки

Принцип: **каждая внешняя зависимость — это ADR**. Ниже — утверждённый список. Всё, чего здесь нет, обсуждается до добавления.

| Область | Берём | НЕ берём и почему |
| :---- | :---- | :---- |
| HTTP | stdlib `net/http` | gin/echo/fiber — свои типы контекста, привязка к фреймворку |
| Роутинг | stdlib `ServeMux` (chi при необходимости) | — |
| БД-драйвер | `jackc/pgx/v5` | `lib/pq` (в режиме поддержки), `database/sql` тоньше по фичам PG |
| Запросы | `sqlc` (кодоген) | GORM/ent — скрывают SQL; squirrel — теряется проверяемость |
| Миграции | `pressly/goose` | golang-migrate тоже ок; goose — SQL-файлы \+ embed |
| Векторы | `pgvector/pgvector-go` | отдельная vector DB — лишний сервис |
| Очередь | `riverqueue/river` | asynq (нужен Redis), самопис |
| LLM SDK | `sashabaranov/go-openai` | langchaingo (170+ зависимостей) |
| Логи | stdlib `log/slog` | zap/zerolog — быстрее, но stdlib хватает |
| Метрики | `prometheus/client_golang` | — |
| Трейсы | `go.opentelemetry.io/otel` | — |
| Rate limit | `golang.org/x/time/rate` | — |
| Circuit breaker | `sony/gobreaker` (или \~50 строк свои) | — |
| UUID | `google/uuid` (или `gen_random_uuid()` в PG) | — |
| Тест-БД | `testcontainers/testcontainers-go` | моки PG врут о поведении |
| Конфиг | stdlib `os.LookupEnv` (свой лоадер) | viper — тяжёл для 12-factor env |
| Валидация | ручная в `Validate()` \+ генерация из OpenAPI | reflect-валидаторы прячут логику |

**Гигиена зависимостей:** `go mod tidy` перед каждым PR; `govulncheck ./...` в CI (уже есть); Dependabot присылает обновления (`.github/dependabot.yml`); новая прямая зависимость → строчка в decision-log.

---

## 6\. PostgreSQL

**pgx/v5 \+ sqlc, без ORM (ADR-006).** sqlc генерирует типобезопасный Go из настоящего SQL — вся мощь Postgres без слоя абстракции.

**Пул соединений** (`platform/postgres`, веха M1):

func New(ctx context.Context, dsn string) (\*pgxpool.Pool, error) {

    cfg, err := pgxpool.ParseConfig(dsn)

    if err \!= nil { return nil, err }

    cfg.MaxConns \= 20

    cfg.MaxConnLifetime \= time.Hour

    pool, err := pgxpool.NewWithConfig(ctx, cfg)

    if err \!= nil { return nil, err }

    if err := pool.Ping(ctx); err \!= nil { // readiness check

        pool.Close()

        return nil, err

    }

    return pool, nil

}

**Запросы sqlc** (`platform/postgres/queries/*.sql`, конфиг `sqlc.yaml`). Пишешь SQL с аннотацией — получаешь типизированную Go-функцию:

\-- name: CreateFinanceAccount :one

INSERT INTO finance\_accounts (tenant\_id, code, name, type, currency)

VALUES ($1, $2, $3, $4, $5) RETURNING \*;

`make sqlc` → `db.CreateFinanceAccount(ctx, params) (FinanceAccount, error)`.

**Миграции goose** (`migrations/NNNNN_*.sql`), embed в бинарник, `make migrate`. Миграция после merge не редактируется — только новая поверх.

**Мультитенантность — два рубежа (ADR-007):**

1. Приложение фильтрует по `tenant_id` из контекста.  
2. RLS в Postgres как страховка. Перед запросами в транзакции:

// helper транзакции устанавливает tenant для RLS-политик

func (r \*Repo) tx(ctx context.Context, fn func(pgx.Tx) error) error {

    tenant, ok := tenancy.TenantFrom(ctx)

    if \!ok { return ErrNoTenant }

    return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {

        if \_, err := tx.Exec(ctx, "SET LOCAL app.tenant\_id \= $1", tenant); err \!= nil {

            return err

        }

        return fn(tx)

    })

}

RLS-политика в миграции (`migrations/00002_finance.sql`):

ALTER TABLE finance\_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant\_isolation ON finance\_accounts

    USING (tenant\_id \= current\_setting('app.tenant\_id')::uuid);

**Деньги и время:** суммы — `int64` в копейках (никогда float/`float64`); время — `timestamptz`, в Go `time.Time` в UTC; идентификаторы — `uuid` (`gen_random_uuid()` на стороне PG).

**Транзакционность спайна (M2):** шина команд открывает транзакцию, в ней — исполнение хендлера \+ запись событий \+ запись аудита. Либо всё, либо ничего. Интерфейс `Repository` уже готов к подмене in-memory на pgx-реализацию без изменения хендлеров.

**Проблема N+1** (критична из\-за §4): не «взять список, потом в цикле догружать по каждому». Один запрос с JOIN или `WHERE id = ANY($1)`. sqlc это не прячет — SQL на виду, N+1 видно в ревью.

**Настройка PostgreSQL под слабое железо.** ВАЖНО про непротиворечивость: минимальное целевое железо betaNEX — **4 ГБ RAM** (§24), и на нём Postgres делит память с `nexd`, Caddy и ОС. Поэтому базовый расчёт — под 4 ГБ, а не «выделенный под БД сервер на 8 ГБ». Ниже — обе конфигурации.

Конфигурация под **4 ГБ RAM** (Postgres \+ nexd \+ Caddy \+ ОС на одной машине — Postgres получает НЕ всю память):

\# postgresql.conf — общая машина 4 ГБ, БД делит RAM с приложением

shared\_buffers \= 512MB            \# \~12% общей RAM: на общей машине НЕ 25%, иначе OOM

effective\_cache\_size \= 1536MB     \# реалистичная оценка кэша, доступного БД (не вся RAM\!)

work\_mem \= 8MB                    \# по формуле ниже; поднимаем точечно через SET LOCAL

max\_connections \= 50              \# пул pgx (MaxConns=20) \+ миграции \+ админ

maintenance\_work\_mem \= 256MB      \# VACUUM и CREATE INDEX (в т.ч. HNSW для pgvector)

Конфигурация под **8 ГБ RAM, выделенный под БД сервер** (когда колледж вырос и БД на отдельной машине):

shared\_buffers \= 2GB              \# 25% RAM — стандарт для ВЫДЕЛЕННОГО сервера БД

effective\_cache\_size \= 6GB        \# \~75% RAM: почти вся память доступна под кэш

work\_mem \= 16MB                   \# по формуле ниже

max\_connections \= 100

maintenance\_work\_mem \= 512MB

**Формула безопасности work\_mem** (главное, чтобы не поймать OOM):

work\_mem ≈ (RAM\_доступная\_БД − shared\_buffers) / max\_connections / 2

Делитель `2` — запас на то, что один запрос может открыть несколько сортировок/хэшей одновременно. Пример для 4 ГБ общей машины (БД доступно \~1.5 ГБ, shared\_buffers 512 МБ): (1536 − 512\) / 50 / 2 ≈ 10 МБ → округляем вниз до 8 МБ. Значение `32 МБ` из первой редакции этого гайда было завышено для 4 ГБ — **вместо `work_mem = 32MB` пишем `work_mem = 8MB`** на общей 4-ГБ машине.

Обоснование параметров (проверено по [PostgreSQL Wiki: Tuning](https://wiki.postgresql.org/wiki/Tuning_Your_PostgreSQL_Server) и [EDB memory tuning](https://www.enterprisedb.com/postgres-tutorials/how-tune-postgresql-memory)):

- **shared\_buffers.** 25% RAM — только для *выделенного* сервера БД. На *общей* машине это верный путь к OOM: считаем от памяти, реально доступной Postgres, а не от всей RAM.  
- **effective\_cache\_size.** Не аллокация, а подсказка планировщику, сколько всего кэша (Postgres \+ ОС) он может рассчитывать. На общей машине занижаем — там кэш делят все процессы.  
- **work\_mem** — по формуле выше, поднимаем точечно `SET LOCAL work_mem = '64MB'` в транзакции тяжёлого отчёта, а не глобально.  
- **max\_connections** держим низким: приложение ходит через пул pgx, сотни соединений только жрут RAM.

**Чем замерять (без этого тюнинг — гадание):**

- `pg_stat_statements` — расширение, показывает самые дорогие запросы по суммарному времени. Первое, что включаем: `shared_preload_libraries = 'pg_stat_statements'`.  
- `EXPLAIN (ANALYZE, BUFFERS) <query>` — реальный план \+ сколько страниц читано из кэша/диска. `BUFFERS` показывает, попадаем ли в `shared_buffers` или бьём в диск.  
- `pgbench` — синтетическая нагрузка для сравнения «до/после» изменения параметра.  
- Правило: **менять по одному параметру, замерять минимум сутки** ([Bun guide](https://bun.uptrace.dev/postgres/performance-tuning.html)). `work_mem`/`effective_cache_size` — без рестарта (`SET`/reload), `shared_buffers`/`max_connections` — с рестартом. Значения — в prod-`compose.yaml` через `command:` или монтированный `postgresql.conf`.

---

## 7\. pgvector

**Зачем в betaNEX:** RAG для AI-слоя (§15) — семантический поиск по документам колледжа (приказы, договоры, регламенты). Отдельная vector DB (Qdrant/Milvus) не нужна: у колледжа тысячи документов, pgvector с HNSW-индексом держит миллионы. Одна БД — один бэкап, одна транзакция, ноль новых сервисов.

**Расширение и таблица** (миграция `00003_ai.sql`):

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE ai\_chunks (

    id          uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

    tenant\_id   uuid NOT NULL REFERENCES tenants (id),

    document\_id uuid NOT NULL REFERENCES ai\_documents (id),

    seq         int  NOT NULL,

    text        text NOT NULL,

    embedding   vector(1024)              \-- размерность модели эмбеддингов

);

\-- HNSW: быстрый ANN-поиск; cosine — для нормализованных эмбеддингов

CREATE INDEX ai\_chunks\_embedding\_idx ON ai\_chunks

    USING hnsw (embedding vector\_cosine\_ops);

ALTER TABLE ai\_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant\_isolation ON ai\_chunks

    USING (tenant\_id \= current\_setting('app.tenant\_id')::uuid);

**Go-тип и поиск** (`pgvector/pgvector-go`, работает с pgx):

import "github.com/pgvector/pgvector-go"

// поиск k ближайших чанков (tenant отфильтрует RLS)

const q \= \`SELECT text FROM ai\_chunks

           ORDER BY embedding \<=\> $1 LIMIT $2\` // \<=\> cosine distance

rows, err := tx.Query(ctx, q, pgvector.NewVector(queryEmbedding), k)

**Версионирование размерности — не «одна колонка навсегда».** `vector(1024)` жёстко привязан к модели эмбеддингов (BGE-M3 — 1024, text-embedding-3-small — 1536, E5-mistral — 4096). Смена модели меняет размерность и требует перестройки индекса. Стратегия betaNEX, чтобы смена модели не была downtime'ом:

- **Колонка на модель, а не одна универсальная.** В `ai_chunks` заводим отдельные колонки под активные модели: `embedding_bge_m3 vector(1024)`, при миграции на другую — добавляем `embedding_e5 vector(1536)` новой миграцией, **не трогая старую**. Имя модели, которой посчитан вектор, хранится в `ai_documents.embedding_model`.  
- **Переход — фоном, не разом.** River-воркер пересчитывает эмбеддинги новой моделью в новую колонку по всему корпусу; пока идёт — поиск работает на старой. Когда новая колонка заполнена и индекс построен — переключаем чтение и дропаем старую колонку/индекс отдельной миграцией. Ноль downtime.  
- **Правило:** активную модель и размерность фиксируем в конфиге (§9) и в `ai_documents.embedding_model`; смена — через процедуру выше, а не `ALTER COLUMN`.

**HNSW строится долго — строим правильно.** Для колледжа «тысячи документов» индекс строится секунды. Но если в одном tenant консолидируются 10 филиалов и корпус растёт до сотен тысяч–миллионов чанков, `CREATE INDEX` блокирует таблицу на минуты. Поэтому:

\-- CONCURRENTLY не блокирует запись в таблицу во время построения

\-- (дольше по времени, но не роняет доступность). Обязательно для больших корпусов.

CREATE INDEX CONCURRENTLY ai\_chunks\_bge\_m3\_idx

    ON ai\_chunks USING hnsw (embedding\_bge\_m3 vector\_cosine\_ops);

Параметры HNSW (`m`, `ef_construction`) — компромисс «скорость построения / качество поиска»; для старта дефолты, тюнинг — под замеренную задержку поиска, не заранее.

**RLS обязателен** — иначе векторный поиск утечёт документы между колледжами (поиск по эмбеддингам игнорирует tenant, если политика не наложена).

---

## 8\. Кэш

**Сначала in-process, Valkey — по необходимости (ADR-008).** Монолит в один инстанс не нуждается в сетевом кэше; преждевременный Redis — лишний компонент и класс багов (инвалидация).

**Интерфейс кэша закладываем сразу**, чтобы апгрейд не трогал вызывающий код:

type Cache interface {

    Get(ctx context.Context, key string) (\[\]byte, bool)

    Set(ctx context.Context, key string, val \[\]byte, ttl time.Duration)

}

Этап 1 — реализация на in-process TTL-кэше (например `maypok86/otter` или своя `sync.Map` \+ expiry). Этап 2 (второй инстанс приложения) — реализация на Valkey (open-source форк Redis; **не** Redis — из\-за лицензии RSAL). Клиент — `valkey-io/valkey-go`.

**Триггер апгрейда явный:** появился второй инстанс `nexd` за балансировщиком ИЛИ кэш должен переживать рестарт. До этого — in-process.

**Где кэш в betaNEX:** (1) кэш ответов LLM с `temperature=0` (§15); (2) горячие справочники (список счетов, роли); (3) rate-limit счётчики (при переходе на Valkey). **Ключи кэша сегментированы по tenant** — иначе утечка между колледжами.

**Экономика кэша LLM — механизм экономии, величина зависит от трафика.** Уберём «60–80% из воздуха»: процент экономии **прямо равен доле повторяющихся запросов**, а она зависит от профиля конкретного колледжа. Грубая оценка: колледж на 1000 студентов с типовыми операциями (одинаковые формулировки справок, повторные вопросы к одним документам) даёт заметную долю повторов; маленький колледж со 100 студентами и разнородными запросами — почти не даёт. **Поэтому цифру не декларируем, а измеряем:** метрика `cache hit rate` (§18) по каждому маршруту; экономия \= hit\_rate × стоимость\_без\_кэша. До измерения на реальном трафике любое число — гадание.

Два независимых уровня кэша:

- **Точный кэш (наш, §8 выше):** запрос с `temperature=0` и идентичным телом отдаётся из хранилища, стоимость попадания — ноль. Работает всегда, у любого провайдера.  
- **Кэш префиксов на стороне провайдера — ОПЦИЯ конкретного провайдера, не универсальный факт.** DeepSeek даёт автоматический prefix caching со скидкой на кэш-хит (величину сверять с актуальным прайсом провайдера — она меняется); OpenAI-совместимые API v2 — тоже; Kimi/GigaChat — **проверять по их документации, не полагаться по умолчанию**. Поэтому: «стабильный системный префикс промпта помогает *там, где провайдер поддерживает prefix caching*». Если не поддерживает — остаётся только наш точный кэш.

Вывод: кэш — обязательный слой цепочки (§15), потому что без него счёт за API растёт линейно с числом студентов. Но конкретную экономию заявляем только после замера hit rate, а выгоду от prefix caching — только для провайдеров, которые его реально дают.

---

## 9\. Конфигурация

**Env-переменные, 12-factor (ADR), свой лоадер поверх `os.LookupEnv`** — без viper. Реальный `internal/config/config.go`: типизированная структура, значения по умолчанию, валидация при старте.

type Config struct {

    Env  Environment

    HTTP HTTPConfig

    Log  LogConfig

    // DatabaseURL string — добавится в M1

}

func Load() (Config, error) {

    r := reader{}

    cfg := Config{

        Env: Environment(r.str("NEX\_ENV", string(EnvDevelopment))),

        // ...

    }

    if err := cfg.validate(); err \!= nil { return Config{}, err }

    return cfg, nil

}

**Правила:** каждая переменная опциональна и имеет разумный дефолт; валидация падает громко при старте, а не тихо в рантайме; секреты (ключи БД, LLM) — только из env, никогда в git; `.env` в `.gitignore`, шаблон — `.env.example`. Префикс всех переменных — `NEX_`.

**Конфиг моделей LLM** (§15) — тоже часть этого конфига (провайдеры, base URL, прайс, маршруты). Hot-reload не делаем: рестарт `nexd` — секунда; добавим, только если реальность потребует.

---

## 10\. Логирование

**`log/slog` из stdlib (ADR-010).** text в dev, JSON в prod. Уже внедрён (`platform/logging`).

log := logging.New(os.Stdout, cfg.Log.Level, cfg.Log.Format)

log.LogAttrs(ctx, slog.LevelInfo, "http request",

    slog.String("method", r.Method),

    slog.Int("status", rec.status),

    slog.Duration("duration", time.Since(start)),

    slog.String("request\_id", RequestIDFrom(ctx)))

**Правила betaNEX:**

- **Структурные атрибуты, не форматирование.** `slog.Int("status", 404)`, не `fmt.Sprintf("status=%d")`. JSON-логи в prod парсятся Loki.  
- **`LogAttrs` в горячем пути** — принимает `[]slog.Attr` и избегает боксинга каждого аргумента в `any`, которое делает вариативный `Info(msg, args ...any)`. Это реальная, но **скромная** микрооптимизация: сам слайс атрибутов всё равно может аллоцироваться. Не превозносим её как ключевую — применяем в явно горячих путях (лог на каждый запрос), в остальных `Info` читаемее и достаточно.  
- **`request_id` в каждой записи** (middleware `requestID`) — связывает все логи одного запроса.  
- **Никогда не логировать секреты и ПДн — и это надо обеспечить механизмом, а не дисциплиной.** `slog` сам не защищает: `slog.Any("user", u)` выгрузит всю структуру, включая пароль-хэш и ФИО. Защита — тип, реализующий `slog.LogValuer`, который сам решает, что отдавать в лог:

// internal/kernel/identity/actor.go — Actor скрывает чувствительное при логировании

func (a Actor) LogValue() slog.Value {

    // в лог уходит только ID и роли; никаких ПДн и токенов

    return slog.GroupValue(

        slog.String("id", a.ID),

        slog.Int("roles", len(a.Roles)),

    )

}

Правило betaNEX: доменные типы, которые могут попасть в лог (Actor, User, платёжные данные), **обязаны** реализовать `LogValuer` и отдавать только безопасные поля. Для структур из внешних источников — не логировать целиком (`slog.Any`), только явные безопасные поля. Для AI-запросов логируем хэш промпта \+ метаданные, не текст (§17). Проверяется ревью и, где возможно, линтером (запрет `slog.Any` на типах с ПДн).

- **Уровни:** debug — детали разработки; info — бизнес-события; warn — аномалии без потери функции; error — то, что требует внимания человека.  
- **Логгер передаётся явно** сверху вниз, не глобальный.

---

## 11\. Ошибки

**Ошибки — значения, оборачиваем `%w`, проверяем `errors.Is/As`.** Никаких паник в бизнес-логике (паника — только для «этого не может быть»: crypto/rand отказал).

**Sentinel-ошибки на границах пакета** (`finance/repo.go`):

var (

    ErrNoTenant        \= errors.New("finance: no tenant in context")

    ErrAccountNotFound \= errors.New("finance: account not found")

    ErrDuplicateCode   \= errors.New("finance: account code already exists")

)

**Оборачивание с контекстом** сохраняет цепочку для `errors.Is`:

return fmt.Errorf("%w: %s", ErrAccountNotFound, id)

// выше по стеку:

if errors.Is(err, ErrAccountNotFound) { /\* → 404 \*/ }

**Правила:** префикс пакета в тексте (`"finance: ..."`) — видно источник в логе; ошибку либо обрабатывают, либо оборачивают и возвращают — не логируют и пробрасывают одновременно (двойной лог); границы HTTP — единственное место, где ошибка превращается в статус (`writeCommandError`); шина команд фиксирует любой исход (ok/denied/error) в аудите независимо от того, как его обработает HTTP.

---

## 12\. Конкурентность и контексты

**`context.Context` — первый аргумент всего, что делает I/O.** Он несёт дедлайн, отмену, и (в betaNEX) актора \+ tenant \+ request\_id.

**Контекст как транспорт идентичности** (`kernel/identity`, `kernel/tenancy`) — типобезопасно, через неэкспортируемые ключи:

// положить (middleware аутентификации)

ctx \= identity.WithActor(ctx, identity.Actor{ID: "u1", Roles: \[\]string{"admin"}})

ctx \= tenancy.WithTenant(ctx, "college-1")

// достать (шина, репозиторий)

actor, ok := identity.ActorFrom(ctx)

tenant, ok := tenancy.TenantFrom(ctx)

**Правила конкурентности betaNEX:**

- **Отмена пробрасывается.** LLM-запрос, SQL-запрос, HTTP-вызов принимают `ctx` и прерываются по нему. Запрос без дедлайна \= подвешенная горутина.  
- **Горутина должна уметь завершиться.** Каждая `go func()` слушает `ctx.Done()` или пишет в канал, который кто-то читает. Утечка горутины — баг.  
- **Разделяемое состояние — под мьютексом или через каналы.** `MemoryBus.handlers` и `MemoryRepository` защищены `sync.RWMutex` (см. код). Гонки ловит `go test -race` (в CI обязателен).  
- **Ограничение параллелизма — семафор на канале** (паттерн для LLM rate limit, §15):

sem := make(chan struct{}, maxConcurrent)

select {

case sem \<- struct{}{}:

    defer func() { \<-sem }()

case \<-ctx.Done():

    return ctx.Err()

}

- **`errgroup.WithContext` для параллельных под-задач** одного запроса (собрать контекст промпта из нескольких источников). Именно `WithContext`, а не голый `Group`: первая ошибка отменяет `ctx`, остальные горутины видят отмену и завершаются, `Wait()` возвращает первую ошибку.

g, ctx := errgroup.WithContext(ctx)

var studentsData, financeData Result

g.Go(func() error { var e error; studentsData, e \= loadStudents(ctx); return e })

g.Go(func() error { var e error; financeData, e \= loadFinance(ctx); return e })

if err := g.Wait(); err \!= nil { // первая ошибка; ctx уже отменён для остальных

    return fmt.Errorf("build prompt context: %w", err)

}

- **Graceful shutdown фоновых циклов.** River-воркеры (§14) останавливаются сами по своему `Stop(ctx)`. Но собственный фоновый цикл (например, периодический флаш метрик) обязан слушать отмену и досчитываться в лимит shutdown:

// запуск из run() (§1); остановка — через тот же ctx, что и HTTP-сервер

func (m \*Metrics) FlushLoop(ctx context.Context) {

    t := time.NewTicker(15 \* time.Second)

    defer t.Stop()

    for {

        select {

        case \<-ctx.Done(): // SIGTERM отменил корневой ctx

            m.flush(context.WithoutCancel(ctx)) // финальный флаш вне отменённого ctx

            return

        case \<-t.C:

            m.flush(ctx)

        }

    }

}

Композиционный корень запускает такие циклы через `errgroup` и ждёт их завершения в окне graceful shutdown — процесс не выходит, пока фоновый цикл не досчитался или не истёк таймаут.

---

## 13\. Тестирование

**Пирамида (ADR): unit (`go test -race`) → integration (testcontainers) → e2e (Playwright, фронт) → нагрузочное (k6).** Всё стандартной библиотекой `testing`, table-driven.

**Table-driven — стандарт betaNEX** (`finance/commands_test.go`):

func TestPostEntryValidate(t \*testing.T) {

    cases := \[\]struct {

        name    string

        lines   \[\]Line

        wantErr bool

    }{

        {"сбалансированная", balanced, false},

        {"дисбаланс", unbalanced, true},

        {"нулевая сумма", zeroAmount, true},

    }

    for \_, tc := range cases {

        t.Run(tc.name, func(t \*testing.T) {

            err := PostEntry{Lines: tc.lines}.Validate()

            if (err \!= nil) \!= tc.wantErr {

                t.Errorf("Validate() err \= %v, wantErr \= %v", err, tc.wantErr)

            }

        })

    }

}

**Тест через шину — как в проде** (`finance/module_test.go`): собираем настоящую шину с политикой и репозиторием, диспатчим команды, проверяем и результат, и аудит, и изоляцию tenant'ов. Это интеграционный тест домена без БД.

**HTTP-тест через `httptest`** (`finance/http_test.go`): поднимаем полный роутер с dev-identity, шлём запросы с заголовками `X-Dev-*`, проверяем статусы и `problem+json`. Негативные кейсы обязательны: 403 без роли, 400 на кривой JSON, 422 на несбалансированную проводку.

**Интеграция с реальным Postgres — testcontainers** (M1+): моки БД врут о поведении (RLS, констрейнты, транзакции), поэтому интеграционные тесты гоняются против настоящего PG в контейнере.

pg, err := postgres.Run(ctx, "postgres:17-alpine", /\* ... \*/)

// dsn := pg.MustConnectionString(ctx); прогнать миграции; тестировать репозиторий

**Про метрику покрытия — честно.** «≥ 80% строк» — слабый ориентир: 80% строкового покрытия набивается на тривиальных `if err != nil`, не проверяя логику. Что действительно важно:

- **Покрытие ветвлений важнее строк.** Каждая ветка `switch`/`if` доменной логики (стороны проводки, исходы команды, ветки authz) должна иметь тест. Строчное покрытие оставляем как грубый сигнал-минимум (≥ 80% для kernel), но целимся в ветки.  
- **Мутационное тестирование для ядра.** `go-mutesting` (или аналог) портит код (меняет `>` на `>=`, убирает строки) и проверяет, что хоть один тест падает. Выжившие мутанты \= дыры, которые строчное покрытие не видит. Гоняем на `kernel` периодически (не на каждый PR — дорого), это лучший индикатор реального качества тестов.

**testcontainers — тяжёлые, поэтому:**

- **Container reuse.** `testcontainers` умеет переиспользовать контейнер между прогонами (`Reuse: true` / `testcontainers.reuse`), не поднимая Postgres заново каждый `go test`. Плюс на CI — сервис-контейнер Postgres в job'е GitHub Actions вместо подъёма из кода.  
- **`t.Parallel()` для интеграционных тестов**, которые делят один контейнер, — но тогда каждый тест работает в своём tenant/schema, чтобы не мешать друг другу (изоляция, которую мы и так требуем).  
- **Разделение по тегам сборки:** быстрые юнит-тесты (без БД) гоняются на каждый PR за секунды; интеграционные (`//go:build integration`) — отдельным шагом. Разработчик локально гоняет юниты постоянно, интеграцию — перед пушем. Это снимает «+30 секунд на каждый прогон» как бутылочное горло для команды.

**Прочие правила:** тесты рядом с кодом (`_test.go`); внешний тест-пакет (`package finance_test`) для публичного API; негативные тесты изоляции tenant'ов **обязательны**; `go test -race ./...` — гейт merge; fuzzing (`testing.F`) — для парсеров (декодеры DTO, токенайзер оценки стоимости).

---

## 14\. Очереди и фоновые задачи

**River — очередь поверх Postgres (ADR-009).** Транзакционный enqueue: задача ставится в той же транзакции, что и бизнес-операция — не теряется и не выполняется до коммита. Ложится на спайн Commands→Events. Никакого нового инфраструктурного компонента (Redis не нужен).

**Зачем в betaNEX:** отправка писем/уведомлений, пересчёт отчётных витрин, импорт ростера (OneRoster), **асинхронные AI-задачи** (классификация аномальных платежей, индексация документов для RAG — §15), batch-запросы к LLM по сниженному тарифу.

**Определение задачи:**

type IndexDocumentArgs struct {

    DocumentID string \`json:"document\_id"\`

}

func (IndexDocumentArgs) Kind() string { return "ai.index\_document" }

type IndexDocumentWorker struct {

    river.WorkerDefaults\[IndexDocumentArgs\]

    repo ai.Repository

    llm  llm.Client

}

func (w \*IndexDocumentWorker) Work(ctx context.Context, job \*river.Job\[IndexDocumentArgs\]) error {

    // чанкинг → эмбеддинги → запись в ai\_chunks; идемпотентно по DocumentID

    return w.repo.IndexDocument(ctx, job.Args.DocumentID)

}

**Транзакционный enqueue** (задача и данные — атомарно):

err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {

    docID, err := saveDocument(ctx, tx, doc) // бизнес-операция

    if err \!= nil { return err }

    \_, err \= riverClient.InsertTx(ctx, tx, IndexDocumentArgs{DocumentID: docID}, nil)

    return err // коммит → задача видна воркеру; откат → её нет

})

**Правила betaNEX:** воркеры **идемпотентны** (повтор задачи не ломает данные — River гарантирует at-least-once); ретраи с экспонентой — встроены в River, настраиваются per kind; долгие задачи уважают `ctx` (River отменяет при shutdown); ошибки воркера логируются и попадают в аудит через ту же шину, если задача меняет данные (актор `system`/`ai`). River-воркеры запускаются в том же процессе `nexd` (монолит) — отдельного деплоя воркеров нет до вехи масштабирования.

---

## 15\. AI-интеграция: LLM не как чатик

Полная стратегия — [docs/ai/](http://ai/) и [docs/research/ai-core.md](http://research/ai-core.md). Здесь — как это кодится на Go.

**Главный принцип betaNEX: AI — это актор шины команд, а не отдельный контур.** LLM не пишет в БД напрямую и не «отвечает в чат». Он: (1) читает данные через те же читающие пути, что и человек; (2) когда нужно действие — **отправляет обычную команду** от актора `ai:*` с ролью, ограниченной политикой authz. Отсюда бесплатно: RBAC, аудит, tenancy, транзакционность — те же, что у людей. Именно это отличает «AI-native» от «прикрутили чатик».

**Конкретные образовательные сценарии betaNEX** (не «ассистент вообще», а функции внутри страниц КИС):

- **Проверка документов абитуриентов.** Загружен пакет на поступление → фоновая River-задача извлекает поля (аттестат, баллы, ФИО, льготы), сверяет комплектность, флагует расхождения. Модель извлекает — человек утверждает. Команда `admissions.application.flag` от актора `ai:*`.  
- **Автоматическое расписание с учётом аудиторий.** Модель предлагает вариант (группы × преподаватели × аудитории × время); результат — не текст в чате, а структурированное предложение, которое проходит `Validate()` (нет коллизий аудиторий/преподавателей) и создаётся командой `schedule.draft.create`. Модель как решатель, ядро как контролёр корректности.  
- **Проверка ВКР на плагиат/качество через RAG** (§7): текст чанкуется → сверяется по векторному индексу с корпусом прошлых работ и источников → отчёт о совпадениях с фрагментами. Не вердикт, а материал для комиссии.  
- **Генерация пояснительных записок к бюджету.** По данным модуля finance (сальдо, исполнение статей) модель составляет черновик записки — sequential refinement (дешёвая модель черновик → сильная редактура). Бухгалтер правит и утверждает; проводки не трогаются (только чтение).

Во всех четырёх модель **предлагает**, а действие совершает команда через шину с authz и аудитом. Ни в одном — свободный чат ради чата.

**Что значит «не чатик» на практике** — три уровня встраивания:

1. **Действия в контексте страницы.** Кнопка «Разобрать» на странице финансов не открывает чат — она вызывает `POST /api/v1/ai/summaries/finance`, который собирает промпт **из структурированных данных модуля** (сальдо, проводки) и возвращает готовую сводку. Пользователь не пишет промпт.  
2. **AI как исполнитель команд.** «Проведи оплату студента Иванова за июнь» → модель через function calling возвращает аргументы команды `finance.entry.post` → аргументы десериализуются в тип команды → проходят `Validate()` и authz → исполняются шиной. Модель предлагает действие, ядро решает, можно ли.  
3. **Фоновая аналитика.** «Три платежа выглядят аномальными» — не запрос пользователя, а результат River-задачи, классифицирующей проводки по batch-тарифу.

**Тонкий gateway-слой `internal/platform/llm`** (не LiteLLM — ADR в docs/ai/06). Единый интерфейс, все провайдеры OpenAI-совместимы:

type Client interface {

    Complete(ctx context.Context, req Request) (Response, error)

    Stream(ctx context.Context, req Request) (\<-chan Chunk, error)

}

type Response struct {

    Content string

    Usage   Usage // ОБЯЗАТЕЛЬНО: без usage нет бюджетов и cost-оптимизации

    Model   string

}

type Usage struct {

    PromptTokens, CompletionTokens int

    CostMicroUSD int64

}

**Один адаптер на всех** (DeepSeek/Kimi/Qwen/Ollama/LiteLLM — меняется base URL):

func NewOpenAICompat(baseURL, apiKey, model string, p Prices) Client {

    cfg := openai.DefaultConfig(apiKey)

    cfg.BaseURL \= baseURL // https://api.deepseek.com/v1

    return \&compatClient{api: openai.NewClientWithConfig(cfg), model: model, prices: p}

}

**Цепочка декораторов** (каждый — отдельный `Client`, оборачивает следующий):

Router → Budget → Cache → RateLimit → Fallback → OpenAICompat(provider)

- **Router** — выбор модели по классу задачи (`cheap`/`long`/`ru-restricted`/`smart`).  
- **Budget** — проверка лимита tenant'а **до** запроса (таблица `ai_budgets`), при исчерпании 429\.  
- **Cache** — точный кэш при `temperature=0` (§8), позже семантический.  
- **RateLimit** — token bucket \+ семафор (§12).  
- **Fallback** — DeepSeek → Kimi → Gemini; для ПДн: GigaChat → YandexGPT.

**Function calling \= команды шины — вот механизм, а не декларация.** Мост между моделью и доменом строится так:

1. **Схема инструмента для модели генерируется из типа команды.** Команда описывает свои поля JSON-тегами и struct-тегами; из них строится JSON Schema, которую понимает function calling. Способ — рефлексия при регистрации команды (например, через `invopop/jsonschema`, генерирующий JSON Schema из Go-типа), либо `go:generate` для статики. Выбор фиксируется ADR; предпочтителен `go:generate` (схема — артефакт в репозитории, ревьюится, не строится в рантайме):

// команда объявляет поля с описаниями для модели

type PostEntry struct {

    Memo  string \`json:"memo"  jsonschema:"description=Назначение проводки"\`

    Lines \[\]Line \`json:"lines" jsonschema:"description=Строки; сумма дебетов=кредитов"\`

}

// go:generate строит из типа JSON Schema инструмента finance.entry.post

2. **Реестр команд → список инструментов.** Шина уже знает все зарегистрированные команды (§3). AI-слой берёт из реестра подмножество, разрешённое роли `ai:*` политикой authz, и отдаёт модели как `tools`. Модель не видит команд, на которые у актора нет прав.  
3. **Ответ модели → команда → шина.** `tool_call` от модели содержит имя команды и JSON аргументов. Десериализуем в тип команды, вызываем `bus.Dispatch(ctx, cmd)` — дальше обычный путь: `Validate()` (ловит бред модели как недоверенный ввод, §17) → authz → аудит. Модель физически не может обойти проверки: она только предлагает аргументы, решает шина.

**Sequential refinement — с эвристикой запуска, а не «красивая фраза».** Двухступенчатая генерация (дешёвая модель → сильная) запускается **не всегда**, иначе теряется экономия. Триггер редактуры — по порядку дешевизны проверки:

- **По типу задачи (основное):** черновик для юридически значимого/публичного документа (пояснительная записка, письмо родителям) всегда идёт на редактуру сильной моделью; внутренняя черновая заметка — нет.  
- **По самопроверке дешёвой модели:** просим её вернуть флаг уверенности/полноты; низкий — эскалация.  
- **По валидации результата:** если черновик не прошёл структурную проверку (нет обязательных разделов отчёта) — эскалация.

Порог и набор триггеров — конфиг маршрута (§9), настраивается без передеплоя логики; дефолт консервативный (редактируем важное, не трогаем черновое).

**Кэш префиксов** упомянут в §8 — здесь не повторяем; см. §8 про то, что это опция конкретного провайдера (DeepSeek/OpenAI-совместимые v2), а не универсальная гарантия.

**RAG вместо «запихнуть всё в контекст»** (§7): для вопросов по документам — векторный поиск релевантных чанков → компактный промпт, а не 200K токенов. Дешевле в десятки раз и точнее (см. research/04-kimi про деградацию длинного контекста).

**Память — существующими механизмами** (research/ai-core §2): working \= текущий диалог; episodic \= таблица `ai_messages`; semantic \= сами данные КИС через читающие команды; procedural \= промпты в git (`internal/module/ai/prompts/`, embed). Отдельного memory-сервиса нет.

**Промпты — код.** Файлы в `prompts/`, `go:embed`, версия в git, ревью в PR. Системный префикс стабилен между запросами → включается кэш префиксов провайдера (−98% у DeepSeek).

---

## 16\. Стриминг

**SSE, не WebSocket (ADR в docs/ai/06).** Трафик AI-ответа односторонний (сервер→клиент), SSE проще, проходит через Caddy без апгрейда соединения, отлаживается `curl`. WebSocket оставляем для будущего мессенджера (двусторонний).

**SSE-хендлер на stdlib** — ключевые моменты: заголовки, `http.Flusher`, отмена по `ctx`:

func (h \*aiHandler) ask(w http.ResponseWriter, r \*http.Request) {

    flusher, ok := w.(http.Flusher)

    if \!ok { httpapi.WriteProblem(w, 500, "streaming unsupported", ""); return }

    w.Header().Set("Content-Type", "text/event-stream")

    w.Header().Set("Cache-Control", "no-cache")

    w.Header().Set("Connection", "keep-alive")

    // ctx запроса: когда клиент закрыл вкладку — стрим LLM отменяется,

    // токены перестают жечься. Это критично для бюджета (§15).

    chunks, err := h.llm.Stream(r.Context(), req)

    if err \!= nil { /\* SSE event: error \*/ return }

    for chunk := range chunks {

        if chunk.Done {

            fmt.Fprintf(w, "event: usage\\ndata: %s\\n\\n", mustJSON(chunk.Usage))

            flusher.Flush()

            break

        }

        fmt.Fprintf(w, "event: delta\\ndata: %s\\n\\n", mustJSON(chunk.Delta))

        flusher.Flush()

    }

}

**SSE-контракт betaNEX:** `event: delta` (кусок текста), `event: usage` (финальная стоимость), `event: error` (данные — problem+json). Обрыв соединения клиентом \= отмена `ctx` \= закрытие провайдерского стрима \= токены не тратятся.

**Правила:** каждый `Fprintf` \+ `Flush()` — иначе буфер держит данные; отдельный длинный `WriteTimeout` для SSE-роутов (обычный 15с убьёт долгий ответ) — либо `http.ResponseController.SetWriteDeadline`; heartbeat-комментарий (`: ping\n\n`) раз в \~15с против таймаутов прокси; на фронте — нативный `EventSource` или fetch-ридер.

---

## 17\. Безопасность

Глубокий разбор — [docs/research/security.md](http://research/security.md). Здесь — что делает Go-код.

**Периметр приложения:**

- **Таймауты сервера всегда** (§4) — против Slowloris.  
- **`MaxBytesReader` \+ `DisallowUnknownFields`** на каждом теле (§4).  
- **Секреты только из env**, никогда в логи/git (§9, §10).  
- **Заголовки безопасности** ставит Caddy на проде (HSTS, X-Content-Type-Options, X-Frame-Options — `deploy/Caddyfile`); CORS — минимально необходимый.

**Аутентификация (M3):** сессии — opaque-токены, хранятся как `sha256`\-хэш (утечка БД ≠ утечка сессий), httpOnly+Secure cookie, ротация, отзыв. Пароли — argon2id (`golang.org/x/crypto/argon2`), рекомендация OWASP. JWT как сессии **не используем** (нельзя отозвать).

// хэш токена сессии — в БД только хэш

sum := sha256.Sum256(\[\]byte(rawToken))

// сравнение — константное время

if subtle.ConstantTimeCompare(stored, sum\[:\]) \!= 1 { /\* invalid \*/ }

**Авторизация:** RBAC в шине команд (§2), не в HTTP-хендлерах — каждая команда объявляет `Permission()`, `authz` проверяет до исполнения. Решение (allow/deny) в аудите.

**AI-специфика (research/security.md):**

- AI-актор получает **минимальную роль** — на старте только читающие команды; каждая пишущая — отдельное явное право.  
- Вывод модели, влияющий на действие, валидируется как недоверенный ввод (тот же `Validate()`).  
- Текст из БД/документов в промпте — **недоверенный**; системная инструкция и данные разделены жёсткой рамкой; «lethal trifecta» (приватные данные \+ недоверенный ввод \+ внешняя коммуникация в одном контексте) — запрещена, пункт ревью.  
- ПДн: классификатор `public|internal|personal`; `personal` → только `ru-restricted`\-маршрут или анонимизация ФИО до промпта (152-ФЗ).

**Инструменты Go:** `govulncheck ./...` в CI (уязвимости зависимостей); `gosec` в golangci-lint; `go test -race` (гонки — это баги безопасности). Прогон OWASP ASVS L1→L2 — веха M11.

**152-ФЗ и требования Рособрнадзора — не опция, а закон.** betaNEX обрабатывает ПДн студентов и сотрудников, колледж-оператор обязан соблюдать 152-ФЗ, betaNEX — технически это обеспечивать. **Оговорка: это инженерные требования к системе, не юридическая консультация; конкретные формулировки, даты и суммы сверять с действующей редакцией по официальному источнику — [publication.pravo.gov.ru](http://publication.pravo.gov.ru) (официальный портал правовой информации), карточка закона на [pravo.gov.ru](http://pravo.gov.ru); привлекать юриста при внедрении.** Ключевые нормы (по состоянию на середину 2026, требуют сверки):

- **Локализация — ст. 18 ч. 5 152-ФЗ** (введена 242-ФЗ от 21.07.2014; обновлённая редакция нормы применяется с 01.07.2025 — сверить по pravo.gov.ru). Первичные запись, систематизация, накопление, хранение ПДн граждан РФ — только в БД, физически на территории РФ (последующая передача/дублирование за рубеж допускаются при условии, что первичная и актуальная копия остаётся в РФ). Практика betaNEX: prod-Postgres хостится в РФ; зарубежные AI-API (DeepSeek, Kimi) **не получают ПДн** — только маршрут `ru-restricted` (GigaChat/YandexGPT, серверы в РФ) или локальная модель через Ollama; в зарубежную модель уходят агрегаты или анонимизированный текст (ФИО → токен до промпта, обратная подстановка после).  
- **Классификация ПДн студентов.** Оценки, приказы, ФИО, даты рождения, льготы — категория **personal**. Классификатор данных (§15, research/security.md) присваивает `public | internal | personal`; `personal` включает ограничения маршрутизации и минимизации.  
- **Аудит изменений (требование контроля).** Кто, когда и что изменил в оценках/приказах — append-only журнал ядра (`kernel/audit`) с trace\_id. Это и отладка (§18), и выполнение требования прослеживаемости изменений критичных данных. Записи не удаляются и не редактируются.  
- **Штрафы за нарушение локализации — ст. 13.11 ч. 8 КоАП РФ:** для юрлиц 1–6 млн ₽ за первичное нарушение; за повторное — по ч. 9 существенно выше (порядок «до \~18 млн ₽» — сверить с действующей редакцией КоАП, суммы менялись и различаются для граждан/должностных/юрлиц). Плюс предписания и блокировка Роскомнадзора. Точные суммы и состав — только по официальному тексту КоАП, не по пересказам. Вывод для инженерии один независимо от точной цифры: **ПДн граждан РФ — на серверах в РФ, зарубежным моделям не передаём.**  
- **Технические следствия:** ПДн не попадают в логи (§10) и в промпты зарубежных моделей; кэш AI-ответов с ПДн сегментирован по tenant и не переходит границу РФ; политика обработки ПДн и согласия — отдельный модуль на вехе M11.

---

## 18\. Observability

**Три столпа, всё self-hosted (ADR-010, ADR-020):** логи (slog→Loki), метрики (Prometheus), трейсы (OpenTelemetry). Плюс аудит через шину — четвёртый, betaNEX-специфичный.

**Метрики Prometheus** (`prometheus/client_golang`), endpoint `/metrics`:

var httpDuration \= prometheus.NewHistogramVec(

    prometheus.HistogramOpts{

        Name:    "nex\_http\_request\_duration\_seconds",

        Buckets: prometheus.DefBuckets,

    }, \[\]string{"route", "method", "status"})

Ключевые метрики betaNEX: `nex_http_request_duration_seconds` (гистограмма латентности), `nex_command_total{command,outcome}` (исходы команд), пул БД (`pgxpool.Stat()`), очередь River, и AI-специфичные: `ai_cost_microusd_total{tenant,model}`, `ai_tokens_total`, `ai_budget_exhausted_total`.

**Трейсы OTel** — trace\_id через весь запрос: HTTP → command → SQL → LLM/job. Тот же id, что `request_id` в логах — инцидент ищется во всех трёх системах сразу.

**Аудит как observability:** каждая команда оставляет запись «актор, tenant, команда, исход, trace\_id» (`kernel/audit`). Для КИС это не только отладка, но и требование (кто изменил оценку/проводку).

**Алерты (M10):** расход tenant'а \> 80% AI-бюджета; error-rate провайдера LLM \> 20% за 5 мин; p95 латентности \> порога; `/readyz` красный. Ошибки — GlitchTip (Sentry-совместимый, Go SDK).

**Правило:** новый эндпоинт/команда → сразу метрика и запись аудита. Observability не прикручивают потом.

---

## 19\. Производительность

**Правило №1: сначала измерь.** Go даёт инструменты профилирования из коробки — не угадывай.

**pprof** (в dev за флагом):

import \_ "net/http/pprof" // регистрирует /debug/pprof/\* на отдельном mux

// go tool pprof http://localhost:8080/debug/pprof/profile?seconds=30

**Бенчмарки для горячего кода** (токенайзер оценки стоимости, сериализация):

func BenchmarkEstimateCost(b \*testing.B) {

    for b.Loop() { // Go 1.24: корректный цикл бенчмарка

        \_ \= EstimateCost(sample)

    }

}

// go test \-bench=. \-benchmem \-cpuprofile=cpu.out

**Практики betaNEX:**

- **`LogAttrs`, не `Info`** в горячем пути (§10) — меньше аллокаций.  
- **Переиспользование буферов** через `sync.Pool` — только если профиль показал аллокации узким местом, не заранее.  
- **Пул БД настроен** (`MaxConns`, `MaxConnLifetime`) — не открывать соединение на запрос.  
- **Стриминг больших ответов**, не буферизация в память (§16).  
- **`-race` в тестах, но не в проде** — он замедляет в разы.  
- **Индексы в PG важнее микрооптимизаций Go** — медленный запрос перевесит любую экономию в коде. `EXPLAIN ANALYZE` — первый инструмент при медленном эндпоинте.

**Не оптимизируй преждевременно.** Читаемый код по умолчанию; оптимизация — только с профилем на руках и бенчмарком до/после.

---

## 20\. Масштабирование

**Философия: вертикально, пока хватает; горизонтально — когда осознанно понадобится.** Масштаб КИС-колледжа — один-два сервера. Не строим Kubernetes-платформу под нагрузку, которой нет.

**Ориентир: до \~5000 студентов на одном инстансе `nexd` (2 vCPU) — ГИПОТЕЗА, не измеренный факт.** Формулируем честно: цифра основана на рассуждении, а не на бенчмарке, и подлежит проверке нагрузочным тестом (веха M8). Рассуждение: КИС — не соцсеть; 5000 студентов создают редкие всплески (первый день записи на дисциплины, публикация сессии), а не постоянный поток; между всплесками — почти простой. Один Go-процесс на 2 vCPU обрабатывает тысячи простых CRUD-запросов/сек — заведомо больше среднего трафика колледжа. Первым упрётся Postgres (тяжёлые запросы, не число соединений — потому пул и мал, §6), а не Go-рантайм.

**Конкретный k6-сценарий проверки** (то, что должно лежать в `load/`, а не просто «есть в load/»):

// load/peak.js — профиль «первый день записи на дисциплины»

export const options \= {

  scenarios: {

    enrollment\_spike: {                 // всплеск: студенты одновременно записываются

      executor: 'ramping-vus',

      startVUs: 0,

      stages: \[

        { duration: '2m', target: 200 },  // 200 одновременных студентов за 2 мин

        { duration: '5m', target: 200 },  // держим пик

        { duration: '2m', target: 0 },    // спад

      \],

    },

  },

  thresholds: {

    http\_req\_duration: \['p95\<500', 'p99\<1000'\], // бюджет §4 под нагрузкой

    http\_req\_failed:   \['rate\<0.01'\],

  },

};

Профиль неравномерный (ramping, всплеск), а не 200 запросов «ровным потоком» — потому что реальная нагрузка КИС именно такая. Смотрим p95/p99 (§4) и `pgxpool.Stat()` (§18: не упёрлись ли в пул). До прогона «5000» — гипотеза, а не обещание заказчику.

**Read-реплики и свежесть данных — read-your-writes обязателен.** Наивное «читаем из реплики» ломается на eventual consistency: бухгалтер создал проводку (запись в мастер), сразу открыл список — реплика отстала на секунды, проводки нет. В КИС это баг, не «фича». Стратегия: **на реплику уходит только заведомо не-свежее чтение** (аналитика, отчёты за прошлые периоды, RAG-поиск по документам); чтение сразу после записи и любые списки, где пользователь ждёт увидеть свою только что созданную запись, идут в мастер. Маршрутизация — на уровне репозитория: метод помечен как `readStale` (можно реплику) или обычный (только мастер). По умолчанию — мастер; на реплику переносим осознанно и точечно. Проще: пока один инстанс — реплики нет вообще, проблема не возникает; вводим реплику только с ростом и сразу с этим правилом.

**Что уже готово к горизонтали в коде:**

- **Stateless HTTP-слой** — состояние в Postgres, не в памяти процесса. Несколько `nexd` за балансировщиком работают из коробки, **кроме** двух вещей ниже.  
- **Кэш** — при втором инстансе in-process → Valkey (§8), интерфейс уже абстрагирован.  
- **Rate-limit / бюджеты** — при втором инстансе счётчики переезжают в Valkey (сейчас in-process).  
- **River-воркеры** — координируются через Postgres, несколько инстансов не дублируют задачи из коробки.

**Порядок роста betaNEX (когда реально упрёмся):**

1. Вертикально: больше CPU/RAM/связь с БД. Долго хватает.  
2. Read-реплики Postgres для тяжёлого чтения (отчёты, RAG-поиск) — раньше, чем отдельная vector DB.  
3. Несколько `nexd` за Caddy/балансировщиком \+ Valkey для общего состояния.  
4. Вынос River-воркеров в отдельный процесс (тот же бинарник, флаг режима) — если фоновая нагрузка конкурирует с HTTP.  
5. Разделение модулей на сервисы — **только если** конкретный модуль требует независимого масштабирования. Модульные границы (§2) уже проведены так, что это возможно без переписывания; но это последний шаг, не первый.

**Тонкое место — Postgres:** вертикальное масштабирование БД имеет предел. Для КИС он далёк. Мониторим пул соединений и медленные запросы (§18, §19) — сигналы задолго до потолка.

---

## 21\. Docker / Kubernetes

**Docker сейчас, Kubernetes — почти наверняка никогда (ADR-018).** Масштаб не оправдывает операционную стоимость k8s.

**Multi-stage Dockerfile** (реальный, в репозитории): сборка в `golang:1.24-alpine`, рантайм в `distroless/static:nonroot` — нет shell, пакетного менеджера, лишней поверхности атаки, процесс не от root.

FROM golang:1.24-alpine AS build

WORKDIR /src

COPY go.mod ./

RUN go mod download           \# слой кэшируется, пока go.mod не менялся

COPY . .

RUN CGO\_ENABLED=0 go build \-trimpath \-ldflags="-s \-w" \-o /out/nexd ./cmd/nexd

FROM gcr.io/distroless/static-debian12:nonroot

COPY \--from=build /out/nexd /nexd

USER nonroot

ENTRYPOINT \["/nexd"\]

`CGO_ENABLED=0` → статический бинарник, работает в `distroless/static`. `-trimpath -ldflags="-s -w"` → меньше размер, нет путей сборки в бинарнике.

**Dev — Docker Compose** (`compose.yaml`): Postgres 17 (позже Valkey). `make dev` поднимает окружение. **Prod — Compose \+ Caddy** (`deploy/`): nexd \+ caddy (авто-TLS, статика фронта) \+ postgres. Заготовки готовы, включаются на вехе M9.

**Если k8s всё-таки понадобится:** образ уже есть, `/healthz` (liveness) и `/readyz` (readiness) уже реализованы под пробы — миграция это конфиг, не переписывание. Но порог — реальная потребность в оркестрации многих инстансов, которой у КИС нет.

---

## 22\. CI/CD

**GitHub Actions** (`.github/workflows/ci.yml`, ADR-019). Пайплайн на каждый PR и push в main:

\- uses: actions/setup-go@v5

  with: { go-version-file: go.mod }   \# версия из go.mod, один источник истины

\- uses: golangci/golangci-lint-action@v8

\- run: go test \-race ./...

\- run: go build ./...

\- run: govulncheck ./...              \# уязвимости зависимостей

**Гейты merge:** зелёный CI обязателен; линт \+ race-тесты \+ сборка \+ govulncheck проходят. Локальные хуки (`lefthook.yml`): `gofmt` \+ `go vet` на pre-commit, `go test -race` на pre-push — ловят проблемы до пуша.

**CD (веха M9):** сборка образа → GHCR → деплой по git-тегу на staging, затем prod. Rollout AI-фич за флагом `NEX_AI_ENABLED`: staging → пилотный tenant → все. Dependabot автоматизирует обновления зависимостей.

---

## 23\. Чек-лист

Прежде чем открыть PR:

* `make lint` и `make test` (с `-race`) зелёные локально  
* Изменения данных идут **через шину команд**, не прямым SQL из хендлера  
* Новая команда: `Name()` стабильно, `Permission()` объявлено, `Validate()` покрывает инварианты  
* Каждая доменная таблица несёт `tenant_id` \+ RLS-политику  
* Изменения API начались со спеки `api/openapi.yaml`  
* Тесты на новое поведение, включая негативные и **изоляцию tenant'ов**  
* Деньги — `int64` в минорных единицах; время — UTC `timestamptz`  
* Ошибки обёрнуты `%w`, проверяются `errors.Is`, на границе HTTP → problem+json  
* I/O принимает и уважает `context.Context`; горутины умеют завершаться  
* Секреты и ПДн не попадают в логи  
* Новая прямая зависимость → строка в `decision-log.md`  
* Новый эндпоинт/команда → метрика Prometheus \+ запись аудита  
* AI-код: вывод модели валидируется как недоверенный ввод; недоверенный текст не смешан с системной инструкцией

---

---

## 24\. Оптимизация под слабое железо

Целевое железо — VPS $20–50/мес: 2 vCPU, 4 ГБ RAM, SSD. Из этого выводятся жёсткие бюджеты: бинарник \< 50 МБ, старт \< 1 сек, holodilnik-модели не держим — AI только через внешние API. Ниже — как их удержать в Go.

### Go runtime под ограниченную память

Главная угроза на 4 ГБ — OOM-killer. GC Go по умолчанию не знает о лимите памяти контейнера/машины и может разогнать кучу до убийства процесса. Лечится `GOMEMLIMIT` (soft memory limit, стабилен с Go 1.19, [gc-guide](https://go.dev/doc/gc-guide)).

// internal/platform/runtime/limit.go

// SetMemoryLimit выставляет мягкий лимит памяти рантайма, если задан

// NEX\_MEMORY\_LIMIT\_BYTES. Оставляем \~25% RAM машины операционной системе,

// Postgres и Caddy: на машине 4 ГБ лимит nexd — около 1.5 ГБ.

func SetMemoryLimit(log \*slog.Logger) {

    raw, ok := os.LookupEnv("NEX\_MEMORY\_LIMIT\_BYTES")

    if \!ok {

        return // не задан — рантайм работает как обычно

    }

    n, err := strconv.ParseInt(raw, 10, 64\)

    if err \!= nil || n \<= 0 {

        log.Warn("invalid NEX\_MEMORY\_LIMIT\_BYTES, ignoring", slog.String("value", raw))

        return

    }

    debug.SetMemoryLimit(n)

    log.Info("go soft memory limit set", slog.Int64("bytes", n))

}

Правила (проверено по [Ardan Labs: K8s Memory Limits and Go](https://www.ardanlabs.com/blog/2024/02/kubernetes-memory-limits-go.html) и [proposal 48409](https://go.googlesource.com/proposal/+/master/design/48409-soft-memory-limit.md)):

- **`GOMEMLIMIT` — soft limit, поэтому нужен ВТОРОЙ, hard-уровень.** Мягкий лимит заставляет GC работать агрессивнее, но если память растёт быстрее, чем GC успевает освобождать (пик аллокаций), процесс всё равно уйдёт в OOM. Поэтому на 4 ГБ ставим оба уровня: `GOMEMLIMIT` (мягкий, чтобы GC держал кучу в рамках) \+ **жёсткий лимit ОС**, который betaNEX не превысит физически:  
  - systemd: `MemoryMax=1500M` в unit-файле `nexd.service` (cgroup v2 убьёт процесс при превышении — предсказуемо, с логом, а не случайный OOM-killer выбирает жертву);  
  - Docker Compose: `mem_limit: 1500m` в сервисе `nexd` (`deploy/compose.prod.yaml`). Мягкий лимит ставим на \~10–15% ниже жёсткого (например `GOMEMLIMIT=1300MiB` при `MemoryMax=1500M`), чтобы GC успевал среагировать до жёсткого потолка. `GOMEMLIMIT` учитывает только кучу и память рантайма Go, не бинарник и не C-аллокации — ещё одна причина иметь запас до hard-лимита.  
- **`GOGC` не трогаем без замера.** Дефолт `GOGC=100` разумен. `GOGC=off` (GC только по лимиту памяти) экономит CPU, но опасен на 4 ГБ — оставляем как эксперимент под нагрузочным тестом, не как дефолт.  
- **`GOMAXPROCS` \= число vCPU.** На 2 vCPU рантайм сам определит правильно; в контейнере с CPU-квотой проверить (иначе рантайм увидит все ядра хоста) — при необходимости `automaxprocs`\-подобная логика или явный env.

### Размер бинарника \< 50 МБ

\# ldflags="-s \-w" убирает таблицу символов и DWARF — минус \~30% размера.

\# CGO\_ENABLED=0 — чистый статический бинарник (см. §21).

build:

	CGO\_ENABLED=0 go build \-trimpath \-ldflags="-s \-w" \-o bin/nexd ./cmd/nexd

**Про «\< 50 МБ» честно: это потолок для мониторинга, а не запас.** Разложение: `distroless/static` не в счёт (это образ); сам бинарник \= Go-рантайм (\~2–5 МБ базы) \+ код \+ зависимости. Реальный `nexd` с pgx+river+otel+prometheus — уже \~30–40 МБ. Добавить `reports` с `excelize` — ещё \+5–10 МБ. То есть 50 МБ — не «много места», а **порог, который легко пробить**, если тащить тяжёлые зависимости. Поэтому 50 МБ — это **бюджет-алерт в CI**, а не гарантия: шаг CI меряет размер бинарника и падает при превышении порога (см. «Бюджеты как тест» ниже). Правило прежнее: не тащить зависимости-гиганты (§5, отказ от langchaingo с 170+ пакетами — в том числе про размер). Фронтенд-статику раздаёт Caddy, в бинарник Go она не встраивается.

### Старт \< 1 сек

Go-бинарник стартует мгновенно; медлит обычно установление связей. Правила:

- **Пул БД — лениво или с коротким таймаутом.** Не блокировать старт на прогреве 20 соединений; `pgxpool` открывает их по требованию. Ping для `/readyz` — с таймаутом, не бесконечный.  
- **Миграции — отдельной командой, не при старте.** `make migrate` в деплое до запуска `nexd`, а не в `run()`. Иначе рестарт под нагрузкой ждёт миграций.  
- **Никаких тяжёлых `init()`.** Догмат проекта (§1) здесь ещё и про скорость старта: всё конструируется в `run()`, лениво где можно.

### AI — только внешние API, без локальных моделей

На 4 ГБ RAM и без GPU локальная LLM (даже 7B) невозможна физически. Это не ограничение, а решение (см. §15, docs/ai): betaNEX ходит в внешние API (DeepSeek/GigaChat/YandexGPT). Ollama из §3 архитектур — опция для колледжа, который *отдельно* купил GPU-сервер ради ПДн-контура; на типовом железе её нет. Экономику закрывает кэш (§8): без него внешний API дорог, с ним — приемлем.

### Бюджеты как тест

Бюджеты проверяются, а не декларируются: размер бинарника — шаг в CI (`test -s bin/nexd` \+ порог); RSS под нагрузкой — в k6-прогоне (§13) с `GOMEMLIMIT`; старт — `time ./nexd` с немедленным SIGTERM. Превышение порога — красный CI, как и упавший тест.

---

## 25\. Миграция с 1С и Битрикс

Колледж не переходит «в один день». Миграция — управляемый процесс с параллельным периодом и планом отката. Задача Go-кода — сделать импорт идемпотентным, а сверку — автоматической.

### Общая схема

flowchart TD

    A\[1С:Колледж / Битрикс24\] \--\>|выгрузка ОСВ, оборотки, ростер| B\[Файлы: XLSX / XML / OneRoster CSV\]

    B \--\>|загрузка| C\[River-воркер import.oneroster\]

    C \--\>|команды шины| D\[(PostgreSQL betaNEX)\]

    D \--\> E\[Сверка балансов и остатков\]

    A \-.read-only.-\> E

    E \--\>|расхождений нет| F\[Переключение на betaNEX write\]

    E \--\>|расхождения| G\[Отчёт о расхождениях \-\> ручной разбор\]

    F \-.план отката 1ч.-\> A

### Шаги

1. **Выгрузка из 1С — и это отдельный мини-проект, не «одна кнопка».** 1С выгружает в свои форматы (XML/XLSX), OneRoster он «из коробки» не знает. Значит, нужен **конвертер 1С-выгрузка → OneRoster CSV**: его надо написать, отладить на реальной выгрузке конкретной редакции 1С (структура отличается между 1С:Колледж и 1С:Университет) и поддерживать. Это оцениваемая работа (дни–недели на первую редакцию 1С), а не данность. OneRoster (стандарт 1EdTech, §27) выбран как промежуточный формат, потому что документирован и переиспользуется между колледжами — конвертер под редакцию 1С пишется один раз, дальше применяется у всех колледжей на той же редакции. ОСВ и обороты по счетам — отдельная выгрузка для сверки финансов (шаг 4).  
2. **Импорт через River-воркер.** Загрузка — фоновая задача (§14), идемпотентная по естественному ключу (номер счёта, СНИЛС/номер студбилета). Повторный запуск не создаёт дублей.

// internal/module/imports/oneroster.go

type ImportRosterArgs struct {

    BatchID string \`json:"batch\_id"\` // идемпотентность: один батч — одна загрузка

    Path    string \`json:"path"\`     // путь к выгрузке во временном хранилище

}

func (ImportRosterArgs) Kind() string { return "import.oneroster" }

func (w \*ImportWorker) Work(ctx context.Context, job \*river.Job\[ImportRosterArgs\]) error {

    records, err := w.parse(ctx, job.Args.Path)

    if err \!= nil {

        return fmt.Errorf("import: parse batch %s: %w", job.Args.BatchID, err)

    }

    for \_, rec := range records {

        // каждая строка — команда шины: валидация, authz (актор import:\*), аудит.

        // upsert по естественному ключу делает повтор безопасным.

        cmd := campus.UpsertStudent{ExternalID: rec.SourcedID, /\* ... \*/}

        if err := w.bus.Dispatch(ctx, cmd); err \!= nil {

            // не роняем весь батч из\-за одной строки — копим отчёт

            w.report.Add(rec.SourcedID, err)

            continue

        }

    }

    return w.report.Persist(ctx, job.Args.BatchID)

}

3. **Параллельный период.** 1С переводится в **read-only** (боевые записи только там для сверки), betaNEX — в write. Обе системы живут неделю-две. Пользователи работают в betaNEX, бухгалтерия сверяет.  
4. **Сверка балансов.** Автоматический отчёт: сальдо каждого счёта в betaNEX (§6, модуль finance) против ОСВ из 1С. Расхождение — стоп-фактор, разбирается вручную до переключения.  
5. **Переключение.** Когда сверка чистая N дней подряд — 1С отключается от боевого ввода.  
6. **План отката — честно про стоимость.** «Откат за 1 час» из первой редакции был оптимизмом. Реальность зависит от того, сколько betaNEX проработал в бою:  
   - **В первые часы/день после переключения** откат дёшев: 1С стоит в read-only с актуальным снимком на момент переключения, объём накопленной в betaNEX дельты мал. Откат \= вернуть ввод в 1С \+ вручную/полускриптом внести дельту (десятки операций). Реалистично — часы, не «1 час».  
   - **После недель работы** «откат в 1С» — уже не откат, а обратная миграция: форматы разные, 1С не умеет импортировать произвольную дельту, объём данных большой. Честная оценка — дни работы \+ риск потери/пересчёта данных, накопленных в betaNEX. Поэтому реальная страховка — **не «откат в 1С», а надёжность самого betaNEX \+ резервные копии его БД** (§21, `pg_dump`/pgBackRest): откат к последнему консистентному состоянию betaNEX быстрее и безопаснее, чем возврат в 1С. «Быстрый откат в 1С» держим только на первые дни параллельного периода и прорепетируем на staging до боевого переключения. Не обещаем «1 час» там, где это неправда.

**Правило betaNEX:** импорт — обычный модуль (`imports`) по правилам §3, все записи через шину. Никаких прямых `INSERT` в обход команд — иначе теряется аудит происхождения данных (критично для 152-ФЗ, §17).

---

## 26\. Дорожная карта модулей

Порядок — по критерию «даёт данные другим / заменяет самый дорогой кусок 1С / готовность железа». Каждый модуль — по §3.

| Модуль | Статус | Заменяет в 1С | Приоритет | AI-интеграция (актор `ai:*`) |
| :---- | :---- | :---- | :---- | :---- |
| `finance` | есть (in-memory, M2 → Postgres) | 1С:Бухгалтерия колледжа | — (готов) | пояснительные записки к бюджету, флаг аномальных проводок |
| `campus` | следующий | 1С:Колледж (ядро: студенты, группы, оценки) | P0 | — (даёт данные остальным) |
| `admissions` | после campus | приёмная кампания | P0 | проверка комплектности документов абитуриентов |
| `schedule` | после campus | расписание | P1 | генерация расписания с учётом аудиторий (решатель) |
| `payroll` | после finance+campus | расчёт зарплат | P1 | проверка ведомостей на аномалии |
| `library` | позже | библиотека | P2 | семантический поиск по фонду (pgvector) |
| `dormitory` | позже | общежитие | P2 | — |
| `reports` | сквозной | отчёты/печатные формы | P1 | генерация текстов отчётов (§28) |

flowchart LR

    campus\[campus\<br/\>P0\] \--\> schedule\[schedule\<br/\>P1\]

    campus \--\> admissions\[admissions\<br/\>P0\]

    campus \--\> payroll\[payroll\<br/\>P1\]

    finance\[finance\<br/\>готов\] \--\> payroll

    finance \--\> reports\[reports\<br/\>P1\]

    campus \--\> reports

    campus \--\> library\[library\<br/\>P2\]

    campus \--\> dormitory\[dormitory\<br/\>P2\]

**Почему campus раньше admissions**, хотя приёмка сезонна: admissions создаёт студентов, но живут они в campus; без модели campus (группы, программы, оценки) admissions некуда писать. Сначала домен-приёмник данных, потом источники — то же правило, что для событий в docs/research/domain-functions.

**Правило интеграции модулей:** межмодульная связь только через доменные события ядра (§14, spine). `campus` публикует `student.enrolled` → `dormitory` и `library` подписываются. Прямых импортов пакетов между модулями нет (§1).

---

## 27\. Интеграции с госсистемами

Три обязательные для колледжа РФ интеграции. Общий принцип: каждая — отдельный адаптер в `internal/platform/`, за интерфейсом, объявленным потребителем (§1); все обращения — через River (§14), потому что госсистемы медленные и нестабильные; circuit breaker обязателен (§17, `sony/gobreaker`).

### ФИС ФРДО — выгрузка сведений о дипломах

Рособрнадзоровский реестр ([obrnadzor.gov.ru](https://obrnadzor.gov.ru/gosudarstvennye-uslugi-i-funkczii/7701537808-gosfunction/formirovanie-i-vedenie-federalnogo-reestra-svedenij-o-dokumentah-ob-obrazovanii-i-ili-o-kvalifikaczii-dokumentah-ob-obuchenii/)). Сведения о выданных документах об образовании вносятся в установленный срок (для ряда программ — в течение 60 дней со дня выдачи, ПП РФ №2123). Формат — XML, файл **подписывается и шифруется КЭП** (КриптоПро CSP).

// internal/module/frdo/commands.go

// ExportDiploma формирует XML-запись для ФИС ФРДО и ставит фоновую

// задачу на подпись и выгрузку. Сама выгрузка — River-воркер, потому что

// подпись КЭП и передача во внешнюю систему медленные и могут падать.

type ExportDiploma struct {

    DiplomaID string

}

func (ExportDiploma) Name() string       { return "frdo.diploma.export" }

func (ExportDiploma) Permission() string { return "frdo:export" }

func (c ExportDiploma) Validate() error {

    if c.DiplomaID \== "" {

        return errors.New("frdo: diploma id required")

    }

    return nil

}

- **XML — через `encoding/xml`** (stdlib), схема — по требованиям ФИС ФРДО (актуальную XSD брать из личного кабинета оператора, версии меняются — фиксировать версию схемы в коде и в ADR).  
- **Подпись КЭП** — через сервис подписи (§28, CryptoPro DSS REST API или локальный КриптоПро CSP). Go не подписывает ГОСТ-алгоритмами сам — вызывает внешний подписывающий сервис.  
- **Идемпотентность:** повторная выгрузка того же диплома не создаёт дубль в реестре — воркер проверяет статус по номеру документа.

### СМЭВ — проверка данных (паспорта и др.)

Система межведомственного электронного взаимодействия. СМЭВ 3 — **SOAP/WSDL** (жёсткие контракты), СМЭВ 4 — REST/JSON ([Клеверенс: отличия](https://www.cleverence.ru/articles/it-i-razrabotka/-sistema-smev-3-i-4-otlichiya-i-perspektivy-vnedreniya/)). Регистрация ИС в личном кабинете участника, КЭП обязательна.

sequenceDiagram

    participant U as Пользователь (приёмка)

    participant N as nexd (модуль smev)

    participant Q as River (очередь)

    participant CB as Circuit Breaker

    participant S as СМЭВ

    U-\>\>N: команда smev.passport.verify

    N-\>\>Q: enqueue (транзакционно)

    Q-\>\>CB: попытка запроса

    alt breaker закрыт (норма)

        CB-\>\>S: SOAP-запрос (подписан КЭП)

        S--\>\>CB: ответ (асинхронно, может минуты)

        CB--\>\>N: результат \-\> команда smev.result.record

    else breaker открыт (СМЭВ недоступна)

        CB--\>\>Q: быстрый отказ, retry позже

    end

    N--\>\>U: статус "проверяется" (не блокируем UI)

- **Circuit breaker обязателен** (`sony/gobreaker`): СМЭВ регулярно недоступна; без breaker'а воркеры копятся и упираются в таймауты. 5 сбоев подряд → окно 30 с быстрых отказов.  
- **Асинхронность.** СМЭВ отвечает не сразу (модель «запрос → квитанция → ответ позже»). UI не ждёт — показывает «проверяется», результат приходит фоновой задачей и записывается командой.  
- **SOAP+WS-Security+ГОСТ на Go вручную — НЕ делаем, это была ошибка первой редакции.** СМЭВ 3 требует не просто SOAP-конверт, а WS-Security с подписью XML по ГОСТ Р 34.10-2012 (canonicalization, `<Security>`\-заголовок, ссылки на подписанные элементы). Реализовать это руками на `encoding/xml` — тысячи строк криптографически чувствительного кода, который никто не сможет поддерживать и который юридически должен опираться на сертифицированное СКЗИ. **Реальное решение — внешний шлюз СМЭВ**, а Go вызывает его по простому HTTP/REST:  
  - готовый сертифицированный адаптер СМЭВ (часто на Java/.NET, есть коммерческие и отраслевые) разворачивается рядом; он берёт на себя WS-Security, ГОСТ-подпись, повторы, форматы конкретных видов сведений;  
  - модуль `smev` в betaNEX формирует бизнес-данные, ставит задачу в River и общается со шлюзом по HTTP — вся ГОСТ-криптография и SOAP-нюансы инкапсулированы в шлюзе;  
  - подпись ГОСТ выполняет шлюз или сервис подписи (§28, CryptoPro), не Go. Это оправданная внешняя зависимость (ADR): своя реализация СМЭВ-транспорта нецелесообразна и юридически рискованна. Go отвечает за оркестрацию и бизнес-логику, не за криптотранспорт.

### ЕПГУ (Госуслуги) — подача документов абитуриентами

Абитуриент подаёт документы через Госуслуги → они приходят в betaNEX. Реализуется как приём заявлений (webhook/выгрузка от ЕПГУ) → команда `admissions.application.create` от актора `epgu:*`. Те же правила: приём через River, идемпотентность по номеру заявления, все записи через шину.

**Аутентификация ИС в ЕПГУ — обязательная часть, не деталь.** Подключение к ЕПГУ/ЕСИА требует регистрации информационной системы и сертификата (взаимная TLS-аутентификация, сертификат уровня, требуемого Минцифры/оператором ЕСИА). Практика betaNEX: приватный ключ и сертификат ИС **не в бинарнике и не в git** — в защищённом хранилище на стороне сервера (файл с правами `0400` под отдельным пользователем, смонтированный секрет, либо тот же сервис подписи §28); путь и параметры — через env (§9). Ротация сертификата — регламентная процедура админа (срок действия ограничен), с алертом за N дней до истечения. Как и СМЭВ, реальное подключение к ЕСИА часто идёт через сертифицированный шлюз/адаптер — betaNEX общается с ним по HTTP, а криптотранспорт и хранение ключа — на шлюзе. Точная схема (прямое подключение vs шлюз) фиксируется ADR при реализации `admissions`.

**Общее правило интеграций:** внешняя система — недоверенный и ненадёжный источник. Данные от неё валидируются как пользовательский ввод (§11), обращения изолированы circuit breaker'ом и таймаутами, всё идёт через очередь. Ни одна интеграция не блокирует HTTP-ответ пользователю.

---

## 28\. Отчётность и печатные формы

Колледж живёт на бумаге: приказы, справки, ведомости, дипломы, отчёты в министерство. Форматы — PDF (печать/подпись), XLSX (данные для министерства), HTML (просмотр). Догмат: **шаблоны — часть кода** (`go:embed` \+ `html/template`), а не внешние файлы, которые потеряются.

### Шаблоны через go:embed \+ html/template

// internal/module/reports/templates.go

import (

    "embed"

    "html/template"

)

//go:embed templates/\*.gohtml

var templatesFS embed.FS

// tmpl загружается один раз при старте (не в init — из run(), §1).

// html/template экранирует по умолчанию — защита от инъекций в отчёты.

func LoadTemplates() (\*template.Template, error) {

    return template.ParseFS(templatesFS, "templates/\*.gohtml")

}

- **`html/template`, не `text/template`** — автоэкранирование против инъекций (в отчёт попадают ФИО, комментарии — недоверенные данные).  
- **`go:embed`** — шаблоны в бинарнике: один файл `nexd`, нечего терять при деплое, версия шаблона \= версия кода.

### Форматы

| Формат | Библиотека | Зачем |
| :---- | :---- | :---- |
| HTML | stdlib `html/template` | просмотр в браузере, база для PDF |
| PDF | HTML → PDF через headless (или `maroto` для простого) | печать, архив, подпись |
| XLSX | `excelize` (богатый, но тяжёлый) ИЛИ ручная сборка OOXML/ODF (см. ниже) | выгрузки в министерство, ОСВ |

**Про `excelize` — не «единственный вариант», а компромисс.** `excelize` мощный (формулы, стили, графики), но это \~десятки тысяч строк и несколько зависимостей. Для типовой министерской выгрузки (плоская таблица, минимум форматирования) есть более лёгкая альтернатива: **XLSX/ODS — это ZIP с XML внутри**, простой лист собирается вручную (`archive/zip` \+ `encoding/xml`, \~сотни строк, ноль внешних зависимостей). Правило betaNEX: простые табличные выгрузки — ручной OOXML/ODF (легче, без зависимости); сложные книги со стилями/формулами — `excelize`, если реально нужны его возможности. Выбор per-отчёт, обоснование в ADR модуля `reports`.

**PDF — осознанный компромисс, и headless на 4 ГБ — НЕ опция.** Нативная генерация на Go (gofpdf/maroto) хороша для простых форм (справка, квитанция) — её и используем на основном хосте. Для сложной вёрстки (диплом, многостраничный отчёт) нужен рендер HTML→PDF, а headless-браузер — это \+100–200 МБ RAM и сотни МБ диска. На 4-ГБ хосте вместе с Postgres и nexd это **не «запускать по требованию», а прямой путь к OOM** (§24). Честное правило: сложный PDF — **только отдельный сервис/контейнер на отдельном хосте** (или внешний сервис рендера), betaNEX вызывает его по HTTP и получает готовый PDF. На основном 4-ГБ хосте headless не запускаем вообще. Если бюджет колледжа — один хост, сложные PDF откладываем или упрощаем вёрстку до нативной генерации. Выбор — ADR при реализации `reports`.

### AI-генерация текстов отчётов

Числа считает код (детерминированно), **текст** пояснительной записки/аналитической справки — модель (§15). Разделение жёсткое: AI не считает суммы (галлюцинации в деньгах недопустимы), AI формулирует прозу вокруг уже посчитанных цифр. Результат — черновик, человек утверждает.

### Подпись КЭП

Юридически значимые документы (приказы, дипломы, отчёты в ФИС ФРДО) подписываются КЭП. Go не реализует ГОСТ-криптографию — вызывает внешний сервис подписи: **CryptoPro DSS** (облачная подпись, [REST API](https://dss.cryptopro.ru/docs/articles/rest/signserver/intro.html)) или локальный КриптоПро CSP.

// internal/platform/sign/dss.go

// Signer — интерфейс подписи, объявлен потребителем (модулем reports/frdo).

// Реализация — адаптер к CryptoPro DSS REST API. Go отдаёт данные,

// получает подпись; приватный ключ живёт в HSM на стороне DSS.

type Signer interface {

    Sign(ctx context.Context, data \[\]byte, certID string) (signature \[\]byte, err error)

}

**Почему внешний сервис, а не библиотека:** ГОСТ-подпись требует сертифицированного СКЗИ (КриптоПро). Своя реализация ГОСТ на Go юридически ничтожна. DSS даёт REST/SOAP API и держит ключи в HSM — betaNEX только оркеструет.

---

## 29\. Филиалы и offline-режим

Колледжи имеют филиалы с плохой связью; техникум в райцентре теряет интернет. Требование: базовая работа при обрыве связи \+ разумная синхронизация филиалов. Догмат: **не кластер Postgres** (операционно неподъёмно для одного админа, §2).

### Offline на фронте — Service Worker \+ оптимистичный UI

Тяжесть offline-режима — на фронтенде, не на Go-бэкенде.

flowchart TD

    U\[Пользователь вводит данные\] \--\> SW{Есть сеть?}

    SW \--\>|да| API\[POST /api/v1/... \-\> nexd\]

    SW \--\>|нет| Q\[IndexedDB: очередь операций\]

    Q \--\>|сеть вернулась| SYNC\[Service Worker: повтор очереди\]

    SYNC \--\> API

    API \--\> OK\[Подтверждение \+ обновление UI\]

    Q \--\> OPT\[Оптимистичный UI: показываем сразу\]

- **Service Worker** кэширует статику и ставит запросы в очередь (IndexedDB) при обрыве.  
- **Оптимистичный UI:** ввод показывается сразу, синхронизируется, когда сеть вернулась.  
- **Требование к API Go:** идемпотентность операций записи по клиентскому ключу (`Idempotency-Key`), иначе повтор из очереди Service Worker создаст дубль. Команда несёт клиентский ключ, шина отбрасывает повтор.

// Идемпотентность записи: клиент шлёт Idempotency-Key, сервер запоминает

// результат по ключу в пределах tenant. Повтор возвращает тот же результат,

// не выполняя команду дважды. Критично для offline-синхронизации (§29)

// и повторов из очереди СМЭВ (§27).

### Синхронизация филиалов — read-replica или API, не кластер

Два варианта по бюджету связи:

- **Read-replica Postgres** в филиале: филиал читает локально (расписание, списки — быстро даже на плохой связи), пишет в центральную БД. Стандартная потоковая репликация PG, один админ справится. Подходит, если связь есть, но медленная.  
- **API-синхронизация:** филиал — отдельный `nexd` со своей БД, обмен с центром через betaNEX API батчами (тот же механизм идемпотентного импорта, §25). Подходит, если связь регулярно рвётся.

**Почему не кластер (Patroni/Citus):** распределённый Postgres требует специалиста и постоянного внимания — противоречит модели «один админ» (§2). Read-replica или API покрывают реальные потребности колледжа без этой стоимости. Выбор — ADR при появлении первого филиала-заказчика.

---

## 30\. Экономика внедрения (TCO)

Главная ценность betaNEX — не фичи, а стоимость владения. Цифры ниже — **ориентиры для сравнения подхода**, не коммерческое предложение; конкретные суммы зависят от редакции 1С, числа рабочих мест и подрядчика, поэтому даны как порядки величин и помечены как требующие уточнения под конкретный колледж.

### Статьи расходов за 3 года

| Статья | 1С:Колледж (типовой путь) | betaNEX | Комментарий |
| :---- | :---- | :---- | :---- |
| Лицензии ПО | платные лицензии на платформу \+ рабочие места \+ ИТС-подписка | 0 (open-source стек, §5) | ключевая разница: у betaNEX лицензий нет |
| Сервер | Windows Server (лицензия) \+ железо под 1С | 1 Linux VPS $20–50/мес | один бинарник на дешёвом VPS (§24) |
| Внедрение | подрядчик-франчайзи, недели-месяцы | миграция по §25, дни-недели | цель: \~3× дешевле по трудозатратам |
| Сопровождение | «одинэсник» (ставка/аутсорс) \+ доработки | один админ \+ разработчик по необходимости | цель: \~5× дешевле за 3 года |
| Обновления | платные (ИТС/релизы) | git pull \+ rollout (§22), бесплатно | нет вендорских релиз-платежей |
| Обучение | курсы 1С | web-интерфейс, знакомый по браузеру | ниже порог входа |

### Откуда экономия — по-инженерному

- **Нет лицензий** — весь стек open-source и обоснован ADR (§5). Это не «бесплатно ради дешевизны», а следствие stdlib-first и отказа от проприетарных зависимостей.  
- **Дешёвое железо** — потому что один статический бинарник на 2 vCPU/4 ГБ (§24, §20), а не платформа 1С на Windows Server.  
- **Один админ** — потому что монолит: один процесс, один `systemctl`, один лог (§2). Нет кластера, нет K8s, нет service mesh.  
- **Бесплатные обновления** — потому что деплой это `git tag` \+ CI (§22), а не вендорский релиз-цикл.

### Честные оговорки

- **Стоимость разработки betaNEX и TCO — раздельно и честно.** TCO выше — это *эксплуатационная* стоимость для колледжа, который берёт готовую систему. Стоимость *создания* betaNEX в неё не входит и на одном колледже не окупается — модель работает только при тиражировании (мультитенантность, §6, амортизирует разработку на много колледжей). Для одного колледжа «с нуля под него» betaNEX может выйти дороже коробочной 1С — это надо говорить прямо, а не прятать.  
    
- **1С зрелее** — за лицензии платят в том числе за готовые формы отчётности и обновления под меняющееся законодательство. betaNEX это догоняет модулями `reports` (§28) и интеграциями (§27) — это работа, а не данность.  
    
- **Порядок «3×/5×» — цель, а не расчёт; вот честная арифметика.** Контрпример показывает, почему нельзя декларировать без цифр. Возьмём эксплуатацию готовой системы за 3 года (без стоимости разработки betaNEX, т.к. она амортизируется на многих):


| Статья (3 года) | 1С:Колледж (порядок) | betaNEX (порядок) |
| :---- | :---- | :---- |
| Лицензии платформы \+ рабочие места \+ ИТС | сотни тыс. ₽ | 0 |
| Сервер | Windows Server \+ железо | VPS $20–50/мес ≈ 65–180 тыс. ₽ |
| Внедрение/настройка | франчайзи, сотни тыс. ₽ | конвертер+настройка, десятки тыс. ₽ |
| Сопровождение (обновления, доработки) | «одинэсник»/аутсорс \+ платные релизы | админ \+ разработчик по необходимости |


  Где betaNEX выигрывает однозначно: **лицензии (0 против сотен тысяч) и платные обновления (git pull против ИТС/релизов)**. Где НЕ факт: если для колледжа пишется кастомная доработка betaNEX — она может съесть экономию. **Поэтому: «3× дешевле внедрение / 5× дешевле поддержка» — это гипотеза-цель, проверяемая сметой на первом внедрении, а не обещание.** Реальное число заказчику даём только после расчёта под его редакцию 1С, число рабочих мест и объём доработок. До этого — «предположительно дешевле за счёт лицензий и обновлений, точная выгода требует сметы».

**Вывод для техлида:** TCO — это следствие всех предыдущих архитектурных решений (монолит, stdlib, один бинарник, дешёвое железо), а не отдельная фича. Каждый догмат из §1–2 в конечном счёте про то, чтобы колледж платил за систему в разы меньше, чем за 1С, и мог сопровождать её силами одного человека.

*Живой документ. Расходится с кодом — прав код, правь гайд PR'ом. Связанные документы: [decision-log.md](http://decision-log.md), [how-to-write-a-module.md](http://how-to-write-a-module.md), [roadmap.md](http://roadmap.md), [docs/ai/](http://ai/), [docs/research/](http://research/), [learning/resources.md](http://../learning/resources.md).*  
