-- Журнал аудита. Только INSERT: журнал append-only, что закреплено
-- и на уровне БД — RLS-политик UPDATE/DELETE у таблицы нет.

-- name: CreateAuditEntry :exec
INSERT INTO audit_log (tenant_id, actor_id, command, outcome, detail, trace_id, occurred_at)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: ListAuditEntries :many
SELECT * FROM audit_log ORDER BY occurred_at DESC, id DESC LIMIT $1;

-- name: ListAuditEntriesFiltered :many
SELECT * FROM audit_log
WHERE (sqlc.narg('command')::text IS NULL OR command = sqlc.narg('command'))
  AND (sqlc.narg('actor_id')::text IS NULL OR actor_id = sqlc.narg('actor_id'))
ORDER BY occurred_at DESC, id DESC
LIMIT $1;
