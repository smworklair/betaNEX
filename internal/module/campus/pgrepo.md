# internal/module/campus/pgrepo.go

Реализация хранилища модуля «Кампус» поверх PostgreSQL (через sqlc-сгенерированные запросы и pgx). Единственная точка, где домен campus превращается в SQL-запросы и обратно.

## Ключевое

- `Repository` — структура-обёртка над `*postgres.DB`; `NewRepository(d)` — конструктор.
- `StudentFilter`, `JournalFilter` — параметры фильтрации/сортировки/пагинации для списков студентов и журнала.
- `CreateGroup`, `Groups`, `CreateStudent`, `UpdateStudent`, `Students`, `RecordGrade`, `Journal` — основные CRUD/чтение-операции модуля, каждая оборачивает работу в `r.db.InTenantTx(...)` — транзакцию с уже выставленным tenant-контекстом.
- `Search(ctx, query, limit)` — реализация интерфейса `httpapi.SearchSource`: полнотекстовый поиск по студентам для глобального поиска по системе.
- `tenantUUID(ctx)` — достаёт tenant из контекста и парсит его в `pgtype.UUID`, возвращая `ErrNoTenant` при проблемах.
- `optUUID(s, notFound)` — парсит необязательный UUID-параметр (пустая строка → NULL, невалидная непустая строка → доменная ошибка notFound).
- `mapErr`, `isUnique`, `isFK` — преобразование ошибок Postgres (коды `23505` unique violation, `23503` foreign key violation) в доменные ошибки campus.go (`ErrDuplicateGroup`, `ErrUnknownGroup`, `ErrUnknownStudent`).

## Как это работает

Каждый публичный метод открывает транзакцию через `InTenantTx`, внутри которой вызывает сгенерированные sqlc-методы (`db.Queries`), затем конвертирует SQL-строки (`db.CampusGroup`, `db.CampusStudent`, …) в доменные типы (`Group`, `Student`, `Grade`). Специфичные ошибки Postgres (нарушение уникальности, нарушение FK) не пробрасываются как есть, а превращаются в понятные модулю ошибки через `isUnique`/`isFK` + `fmt.Errorf("%w: ...")`, чтобы HTTP-слой (http.go) мог их узнать через `errors.Is` и вернуть правильный код ответа.

## Связи

Зависит от `internal/kernel/tenancy` (TenantFrom), `internal/platform/postgres` (DB, InTenantTx, ErrNoTenant/ErrInvalidTenant), `internal/platform/postgres/db` (sqlc-сгенерированные Queries и параметры), `internal/platform/httpapi` (SearchHit/SearchSource) и от `pgx`/`pgtype` напрямую. Использует типы и константы из `campus.go` (Group, Student, Grade, ошибки). Сам `Repository` используется в `http.go` (RegisterCommands, Routes).

## На что обратить внимание

Лимиты `Limit`/`Offset` подрезаются вручную в коде (например, `Students`: 500, `Journal`: 1000) перед конвертацией в `int32` — с пометками `#nosec G115`, то есть это осознанное подавление предупреждения линтера о возможном overflow при приведении int→int32, а не пропущенная проверка. Также обратите внимание, что несуществующий/невалидный UUID группы или студента в фильтрах не считается ошибкой — метод просто возвращает пустой список (`[]Student{}, nil`), в отличие от команд записи, где невалидный UUID — доменная ошибка.
