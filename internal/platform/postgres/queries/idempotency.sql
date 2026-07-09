-- Идемпотентные ключи. Все запросы — в tenant-транзакции (RLS).

-- name: TryInsertIdempotencyKey :execrows
INSERT INTO idempotency_keys (tenant_id, key)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: GetIdempotencyKey :one
SELECT * FROM idempotency_keys WHERE key = $1;

-- name: CompleteIdempotencyKey :exec
UPDATE idempotency_keys SET status = $2, content_type = $3, body = $4
WHERE key = $1;

-- name: DeleteIdempotencyKey :exec
DELETE FROM idempotency_keys WHERE key = $1;

-- name: DeleteOldIdempotencyKeys :execrows
DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours';
