-- Запросы аутентификации. Таблица users под FORCE RLS: запросы к ней
-- выполняются в транзакции с app.tenant_id. Таблица sessions без RLS —
-- поиск сессии по хэшу токена происходит до того, как tenant известен.

-- name: CreateUser :one
INSERT INTO users (tenant_id, email, password_hash, display_name, roles)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: ListUsers :many
-- Справочник пользователей tenant'а: выбор исполнителя задачи,
-- получателей рассылки. Хэш пароля наружу не выбирается.
SELECT id, email, display_name, roles, is_active, created_at
FROM users
ORDER BY display_name, email
LIMIT $1;

-- name: CreateSession :exec
INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at)
VALUES ($1, $2, $3, $4);

-- name: GetLiveSessionByTokenHash :one
SELECT * FROM sessions
WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now();

-- name: RevokeSessionByTokenHash :exec
UPDATE sessions SET revoked_at = now()
WHERE token_hash = $1 AND revoked_at IS NULL;

-- name: ExtendSession :exec
UPDATE sessions SET expires_at = $2
WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now();

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions
WHERE expires_at < now() - interval '7 days'
   OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days');
