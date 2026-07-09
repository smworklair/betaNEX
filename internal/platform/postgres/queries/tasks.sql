-- Запросы модуля «Задачи». Границу tenant'ов проводит RLS.

-- name: CreateTask :one
INSERT INTO tasks (tenant_id, title, note, due_on, assignee, created_by)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: GetTask :one
SELECT * FROM tasks WHERE id = $1;

-- name: CompleteTask :execrows
UPDATE tasks SET status = 'done', done_at = now()
WHERE id = $1 AND status = 'open';

-- name: DeleteTask :execrows
DELETE FROM tasks WHERE id = $1;

-- name: ListTasks :many
SELECT * FROM tasks
WHERE (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'))
  AND (sqlc.narg('assignee')::text IS NULL OR assignee = sqlc.narg('assignee'))
  AND (sqlc.narg('q')::text IS NULL
       OR search @@ websearch_to_tsquery('russian', sqlc.narg('q')))
ORDER BY
  CASE WHEN sqlc.arg('sort')::text = 'due'      THEN due_on END ASC NULLS LAST,
  CASE WHEN sqlc.arg('sort')::text = 'due_desc' THEN due_on END DESC NULLS LAST,
  CASE WHEN sqlc.arg('sort')::text = 'created'  THEN created_at END ASC,
  created_at DESC
LIMIT $1 OFFSET $2;
