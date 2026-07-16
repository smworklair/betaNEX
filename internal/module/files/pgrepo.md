# internal/module/files/pgrepo.go

Реализация хранилища метаданных файлов поверх PostgreSQL. По структуре зеркалит `campus/pgrepo.go`: обёртка над `*postgres.DB`, транзакции с tenant-контекстом, конвертация SQL-строк в доменные типы.

## Ключевое

- `Repository` / `NewRepository(d)` — единственная реализация хранилища для модуля files (комментарий в коде явно говорит: без БД модуль не имеет смысла и просто не монтируется в in-memory режиме).
- `Create(ctx, f File) (File, error)` — сохраняет метаданные файла, ID генерирует БД.
- `File(ctx, id) (File, error)` — получение метаданных по ID; невалидный/несуществующий ID → `ErrNotFound`.
- `List(ctx, entityType, entityID, limit) ([]File, error)` — список файлов tenant'а, опционально отфильтрованный по привязанной сущности.
- `Delete(ctx, id) (sha string, referenced bool, err error)` — удаляет запись метаданных и сразу возвращает SHA файла и флаг, остались ли другие файлы с тем же SHA (используется вызывающим HTTP-слоем, чтобы решить, чистить ли блоб на диске).
- `SHAReferenced(ctx, sha) (bool, error)` — отдельная проверка «есть ли ещё ссылки на этот SHA», нужна HTTP-слою после неудачной команды `Attach`.
- `Search(ctx, query, limit)` — реализация `httpapi.SearchSource`: полнотекстовый поиск по именам файлов для глобального поиска.
- `mapErr`, `fileFromRow` — вспомогательные: маппинг ошибок tenant'а, конвертация `db.File` → доменный `File`.

## Как это работает

Каждый метод оборачивает работу с БД в `r.db.InTenantTx`, чтобы транзакция шла с выставленным tenant-контекстом (изоляция через RLS + `SET LOCAL`). ID переданный снаружи парсится в `pgtype.UUID`; если парсинг падает — сразу `ErrNotFound`, до похода в БД. `Delete` — самый содержательный метод: сначала достаёт запись (чтобы узнать SHA), потом удаляет её, потом считает оставшиеся файлы с этим SHA (`CountFilesBySHA`) — то есть сам вычисляет, «осиротел» ли блоб, вместо того чтобы заставлять вызывающего делать два отдельных похода в БД.

## Связи

Зависит от `internal/kernel/tenancy` (TenantFrom), `internal/platform/postgres` (DB, InTenantTx, ErrNoTenant/ErrInvalidTenant), `internal/platform/postgres/db` (сгенерированные sqlc Queries/параметры/типы), `internal/platform/httpapi` (SearchHit) и от pgx/pgtype. Использует доменный тип `File` и ошибки из `files.go`. Вызывается из `handlers.go` (RegisterCommands) и `http.go` (все HTTP-обработчики модуля).

## На что обратить внимание

Модуль files, в отличие от campus, не имеет альтернативной in-memory реализации — Postgres здесь единственная и обязательная. Это осознанно задокументировано прямо в комментарии к `Repository`, так что при чтении кода не стоит искать mock/memory-репозиторий для этого модуля.
