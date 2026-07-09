-- Запросы файлового хранилища. Границу tenant'ов проводит RLS.

-- name: CreateFile :one
INSERT INTO files (tenant_id, name, content_type, size, sha256, entity_type, entity_id, uploaded_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetFile :one
SELECT * FROM files WHERE id = $1;

-- name: ListFiles :many
SELECT * FROM files
WHERE (sqlc.narg('entity_type')::text IS NULL OR entity_type = sqlc.narg('entity_type'))
  AND (sqlc.narg('entity_id')::text IS NULL OR entity_id = sqlc.narg('entity_id'))
ORDER BY created_at DESC, id
LIMIT $1;

-- name: DeleteFile :execrows
DELETE FROM files WHERE id = $1;

-- name: CountFilesBySHA :one
SELECT count(*) FROM files WHERE sha256 = $1;

-- name: SearchFiles :many
SELECT f.id, f.name, f.content_type, f.created_at,
       ts_rank(f.search, q)::real AS rank
FROM files f, websearch_to_tsquery('russian', $1) q
WHERE f.search @@ q
ORDER BY rank DESC, f.created_at DESC
LIMIT $2;
