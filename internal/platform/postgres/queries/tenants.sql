-- Запросы реестра tenant'ов. Таблица без RLS: она — точка входа
-- в изоляцию, запросы к ней выполняются до установки app.tenant_id.

-- name: GetTenantBySlug :one
SELECT * FROM tenants WHERE slug = $1;

-- name: CreateTenant :one
INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING *;
