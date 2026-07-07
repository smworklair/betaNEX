// Пакет postgres — адаптер платформы к PostgreSQL (веха M1).
//
// Здесь будут жить:
//   - конструктор пула соединений pgx (pgxpool) из конфигурации;
//   - Ping для readiness-проверки (/readyz);
//   - помощник транзакций, устанавливающий SET LOCAL app.tenant_id
//     из tenant-контекста (см. internal/kernel/tenancy);
//   - каталог queries/ с SQL для sqlc (генерация: make sqlc).
//
// SQL-миграции лежат в /migrations и применяются goose (make migrate).
package postgres
