// Пакет postgres — адаптер платформы к PostgreSQL.
//
// Содержимое:
//   - Connect / Ready — пул pgx и readiness-пинг для /readyz;
//   - InTenantTx / InTx — транзакции с SET LOCAL app.tenant_id из
//     tenant-контекста (см. internal/kernel/tenancy): RLS-политики видят
//     только данные текущего tenant'а, поэтому запросы вне транзакции
//     с установленным tenant'ом не возвращают ничего;
//   - Migrate — применение goose-миграций, встроенных в бинарник
//     (пакет /migrations);
//   - ResolveTenant / EnsureTenant / CreateTenant — реестр tenant'ов;
//   - каталог queries/ — SQL для sqlc, генерация в db/ (make sqlc).
package postgres
