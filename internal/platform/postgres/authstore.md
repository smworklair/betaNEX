# internal/platform/postgres/authstore.go

Реализация хранилища аутентификации (`auth.Store`) поверх Postgres: пользователи, сессии, справочник пользователей tenant'а. Один из ключевых адаптеров между доменным пакетом `auth` и реальной базой данных.

## Ключевое

- `AuthStore` / `NewAuthStore(d) *AuthStore` — реализация `auth.Store`.
- `UserByEmail(ctx, email)` / `UserByID(ctx, id)` — поиск пользователя в tenant'е из контекста; возвращают `auth.ErrNoUser`, если не найден или tenant некорректен.
- `CreateUser(ctx, u)` — регистрация пользователя в tenant'е (используется подкомандой `nexd user create`).
- `ListUsers(ctx, limit)` — справочник пользователей tenant'а без хэшей паролей, лимит по умолчанию 200, максимум 1000.
- `CreateSession` / `SessionByTokenHash` / `RevokeSession` / `ExtendSession` — управление сессиями по хэшу токена.
- `userFromRow(row db.User) auth.User` — приватный конвертер строки БД в доменный тип.

## Как это работает

Запросы к таблице пользователей идут через `InTenantTx` — таблица находится под FORCE RLS, поэтому вне транзакции с установленным tenant'ом такие запросы не увидят ни одной строки. Сессии, напротив, ищутся напрямую через `db.New(s.db.pool)` без `InTenantTx`: на этапе поиска сессии по токену tenant ещё не известен (это сессия и определяет, к какому tenant'у относится актор), поэтому таблица сессий сознательно не под RLS. `SessionByTokenHash` транслирует "нет строк" (`pgx.ErrNoRows`) в доменную `auth.ErrSessionInvalid`; аналогично для пользователей — в `auth.ErrNoUser`. `ExtendSession` — no-op по контракту для уже отозванной или истёкшей сессии (скользящее окно продления).

## Связи

Реализует интерфейс `auth.Store` из `internal/kernel/auth` (`var _ auth.Store = (*AuthStore)(nil)`). Зависит от `internal/platform/postgres/db` (сгенерированный sqlc-код) и `postgres.DB` (`InTenantTx`, `pool`, ошибки `ErrNoTenant`/`ErrInvalidTenant`). Используется слоем аутентификации ядра (`internal/kernel/auth`) и, косвенно, `httpapi.UsersRoutes` (через интерфейс `UserLister`, который `AuthStore.ListUsers` реализует).

## На что обратить внимание

Асимметрия RLS между таблицами: `users` — под FORCE RLS и требует `InTenantTx`, `sessions` — намеренно без RLS, потому что на момент поиска сессии tenant запроса ещё неизвестен (это как раз сессия его и сообщает). Ошибки "неизвестный/невалидный tenant" (`ErrNoTenant`, `ErrInvalidTenant`) в `user()` намеренно маскируются под `auth.ErrNoUser` — вызывающему коду не нужно различать "нет пользователя" и "невалидный tenant" на уровне HTTP-ответа аутентификации.
