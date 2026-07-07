# queries/ — SQL-запросы для sqlc

Сюда кладутся файлы `*.sql` с аннотациями sqlc; `make sqlc` генерирует
из них типобезопасный Go-код в `../db`. Схему sqlc читает из `/migrations`.

Пример формата (появится на вехе M2 вместе с реальными запросами):

```sql
-- name: GetTenantBySlug :one
SELECT * FROM tenants WHERE slug = $1;

-- name: CreateTenant :one
INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING *;
```

Правила: один файл на предметную область (`tenants.sql`, `users.sql`);
запросы к доменным таблицам обязаны опираться на `tenant_id` (RLS —
второй рубеж, а не единственный).
