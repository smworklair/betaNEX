-- Transactional outbox. Enqueue выполняется в транзакции команды
-- (присоединяется через контекст); Claim/Done/Fail — воркером на пуле,
-- вне tenant-транзакций (таблица без RLS).

-- name: EnqueueOutbox :exec
INSERT INTO outbox (tenant_id, topic, payload, available_at)
VALUES ($1, $2, $3, now() + make_interval(secs => sqlc.arg('delay_secs')::float8));

-- name: ClaimOutboxBatch :many
-- Забирает пачку готовых сообщений и сразу сдвигает available_at с
-- экспоненциальным backoff: если воркер умрёт посреди обработки,
-- сообщение вернётся в очередь само. SKIP LOCKED позволяет нескольким
-- инстансам разбирать очередь без взаимных блокировок.
UPDATE outbox SET attempts = attempts + 1,
    available_at = now() + make_interval(secs => least(3600.0, 10.0 * (2.0 ^ least(attempts, 8))))
WHERE id IN (
    SELECT id FROM outbox
    WHERE done_at IS NULL AND available_at <= now()
    ORDER BY id
    LIMIT $1
    FOR UPDATE SKIP LOCKED
)
RETURNING *;

-- name: MarkOutboxDone :exec
UPDATE outbox SET done_at = now(), last_error = '' WHERE id = $1;

-- name: MarkOutboxFailed :exec
-- Фиксирует диагноз; время следующей попытки уже выставлено при Claim.
UPDATE outbox SET last_error = $2 WHERE id = $1;

-- name: BuryOutbox :exec
-- Хоронит сообщение после исчерпания попыток: done_at ставится, диагноз
-- остаётся — мёртвые письма ищутся по done_at IS NOT NULL AND last_error <> ''.
UPDATE outbox SET done_at = now(), last_error = $2 WHERE id = $1;

-- name: DeleteOldOutbox :execrows
DELETE FROM outbox WHERE done_at IS NOT NULL AND done_at < now() - interval '30 days';
