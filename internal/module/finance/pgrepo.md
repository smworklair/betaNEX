# internal/module/finance/pgrepo.go

Промышленная реализация `Repository` из `repo.go` поверх PostgreSQL, построенная на коде, сгенерированном sqlc (`internal/platform/postgres/db`). Это то хранилище леджера, что реально работает в production.

## Ключевое

- `PostgresRepository` — обёртка над `*postgres.DB`, реализующая `Repository`.
- `NewPostgresRepository(d *postgres.DB) *PostgresRepository` — конструктор.
- Методы `CreateAccount`, `Account`, `Accounts`, `PostEntry`, `Entries` — та же сигнатура, что и у `MemoryRepository`, но с обращением к БД.
- `tenantUUID(ctx)` — достаёт tenant из контекста и конвертирует в `pgtype.UUID` для параметров запросов.
- `mapTenantErr(err)` — переводит ошибки платформенного пакета `postgres` (нет tenant / невалидный tenant) в доменную `ErrNoTenant`, чтобы вызывающий код модуля видел единый словарь ошибок независимо от реализации хранилища.
- `isUniqueViolation(err)` — распознаёт нарушение уникальности по коду SQLSTATE `23505` (используется, чтобы превратить конфликт по коду счёта в `ErrDuplicateCode`).
- `accountFromRow(row db.FinanceAccount) Account` — конвертирует сырую строку БД в доменный тип `Account`.

## Как это работает

Каждый метод выполняется в транзакции через `r.db.InTenantTx(ctx, func(ctx, q *db.Queries) error {...})` — это платформенная обёртка (`internal/platform/postgres`), которая перед выполнением запроса выставляет `app.tenant_id` в сессии Postgres. Благодаря этому фильтрация по tenant'у в самих SQL-запросах не нужна — её обеспечивает Row-Level Security (RLS) на уровне БД. `PostEntry` перед вставкой сам подгружает счета по ID строк проводки одним запросом (`ListFinanceAccountsByIDs`) и проверяет единство валюты в Go-коде — как «второй пояс» защиты в дополнение к отложенному constraint-триггеру в самой БД. ID сущностей, которые передаёт домен (`Account.ID` при создании), игнорируются: их генерирует БД через `gen_random_uuid()` — единый источник идентификаторов.

## Связи

Реализует `Repository` из `repo.go`; использует доменные типы из `ledger.go`. Зависит от `internal/platform/postgres` (обёртка над pgx, `InTenantTx`) и `internal/platform/postgres/db` (сгенерированный sqlc-код с готовыми запросами). Дополняется файлами `search.go` (метод `Search` на том же `*PostgresRepository`) и `stats.go` (методы `RefreshStats`/`MonthlyTurnovers`) — то есть `PostgresRepository` — это один тип, чьи методы разнесены по нескольким файлам по смыслу (CRUD / поиск / отчётность).

## На что обратить внимание

Балансировку строк проводки (дебет == кредит) проверяет ещё `PostEntry.Validate()` до похода в БД, но код здесь дублирует проверку единства валюты — комментарий поясняет, что на стороне БД тот же инвариант дублирует отложенный constraint-триггер: два независимых уровня защиты от рассинхронизации данных.
