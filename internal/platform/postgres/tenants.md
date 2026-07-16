# internal/platform/postgres/tenants.go

Управление реестром tenant'ов (организаций) в мультиарендной модели NEX: превращение человекочитаемого slug'а в UUID, создание новых организаций и итерация по всем существующим tenant'ам для регламентных задач.

## Ключевое

- `ErrTenantNotFound` — ошибка «tenant не найден»; HTTP-слой отображает её в 400.
- `(*DB) ResolveTenant(ctx, v) (string, error)` — превращает идентификатор tenant'а из запроса (UUID или slug) в UUID. Если `v` уже валидный UUID — возвращает его как есть, иначе ищет по slug в таблице tenant'ов.
- `(*DB) EnsureTenant(ctx, slug) (string, error)` — как `ResolveTenant`, но создаёт tenant, если он не найден. Только для development-сценариев (см. `cmd/nexd`).
- `(*DB) CreateTenant(ctx, slug, name) (string, error)` — регистрирует новую организацию; используется подкомандой `nexd tenant create`.
- `(*DB) ForEachTenant(ctx, fn) error` — прогоняет `fn` в tenant-контексте каждого зарегистрированного tenant'а по очереди (для регламентных задач вроде пересчёта аналитических витрин).

## Как это работает

`ResolveTenant` — точка, через которую HTTP-запрос с произвольным идентификатором организации (из поддомена, заголовка или пути) превращается в конкретный UUID, кладущийся дальше в tenant-контекст (`tenancy.WithTenant`) и используемый в `InTenantTx`. `ForEachTenant` нужен там, где системная задача (не привязанная к одному запросу пользователя) должна последовательно обработать данные каждой организации — так же, как это делал бы человек, переключаясь между организациями по одной.

## Связи

Использует `internal/platform/postgres/db` (sqlc-запросы `GetTenantBySlug`, `CreateTenant`, `ListTenantIDs`) и `internal/kernel/tenancy` (`WithTenant`) для установки контекста в `ForEachTenant`. Тип `DB` определён в `postgres.go`. Вызывается из HTTP middleware (резолвинг tenant'а запроса) и из `cmd/nexd` (создание tenant'ов, регламентные задачи).

## На что обратить внимание

`ResolveTenant` не делает отдельного SQL-запроса, если `v` уже похож на UUID (`pgtype.UUID.Scan` успешен) — это оптимизация и одновременно риск: строка вида UUID, но не существующего tenant'а, пройдёт эту функцию без ошибки и провалится только позже, при попытке использовать её в `InTenantTx`/RLS.
