-- Уведомления. Все запросы — в tenant-транзакции (RLS); лента и отметки
-- о прочтении дополнительно ограничены user_id получателя.

-- name: CreateNotification :one
INSERT INTO notifications (tenant_id, user_id, kind, title, body, ref_type, ref_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListNotifications :many
SELECT * FROM notifications
WHERE user_id = $1
  AND (NOT sqlc.arg('unread_only')::boolean OR read_at IS NULL)
ORDER BY created_at DESC, id DESC
LIMIT $2 OFFSET $3;

-- name: CountUnreadNotifications :one
SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL;

-- name: MarkNotificationRead :execrows
UPDATE notifications SET read_at = now()
WHERE id = $1 AND user_id = $2 AND read_at IS NULL;

-- name: MarkAllNotificationsRead :execrows
UPDATE notifications SET read_at = now()
WHERE user_id = $1 AND read_at IS NULL;
