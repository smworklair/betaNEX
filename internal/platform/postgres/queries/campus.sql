-- Запросы модуля «Кампус». Границу tenant'ов проводит RLS.

-- name: CreateCampusGroup :one
INSERT INTO campus_groups (tenant_id, code, name)
VALUES ($1, $2, $3) RETURNING *;

-- name: ListCampusGroups :many
SELECT g.*, count(s.id) FILTER (WHERE s.status = 'active')::int AS active_students
FROM campus_groups g
LEFT JOIN campus_students s ON s.group_id = g.id
GROUP BY g.id
ORDER BY g.code;

-- name: CreateCampusStudent :one
INSERT INTO campus_students (tenant_id, full_name, email, group_id, status)
VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: GetCampusStudent :one
SELECT * FROM campus_students WHERE id = $1;

-- name: UpdateCampusStudent :one
UPDATE campus_students
SET full_name = $2, email = $3, group_id = $4, status = $5
WHERE id = $1
RETURNING *;

-- name: ListCampusStudents :many
SELECT s.*, g.code AS group_code
FROM campus_students s
LEFT JOIN campus_groups g ON g.id = s.group_id
WHERE (sqlc.narg('group_id')::uuid IS NULL OR s.group_id = sqlc.narg('group_id'))
  AND (sqlc.narg('status')::text IS NULL OR s.status = sqlc.narg('status'))
  AND (sqlc.narg('q')::text IS NULL
       OR s.search @@ websearch_to_tsquery('russian', sqlc.narg('q')))
ORDER BY
  CASE WHEN sqlc.arg('sort')::text = 'name'       THEN s.full_name END ASC,
  CASE WHEN sqlc.arg('sort')::text = 'name_desc'  THEN s.full_name END DESC,
  CASE WHEN sqlc.arg('sort')::text = 'group'      THEN g.code END ASC NULLS LAST,
  CASE WHEN sqlc.arg('sort')::text = 'created'    THEN s.created_at END ASC,
  s.created_at DESC
LIMIT $1 OFFSET $2;

-- name: CreateCampusGrade :one
INSERT INTO campus_grades (tenant_id, student_id, subject, grade, graded_on, graded_by, note)
VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;

-- name: CampusJournal :many
SELECT gr.id, gr.subject, gr.grade, gr.graded_on, gr.graded_by, gr.note,
       s.id AS student_id, s.full_name, g.code AS group_code
FROM campus_grades gr
JOIN campus_students s ON s.id = gr.student_id
LEFT JOIN campus_groups g ON g.id = s.group_id
WHERE (sqlc.narg('group_id')::uuid IS NULL OR s.group_id = sqlc.narg('group_id'))
  AND (sqlc.narg('subject')::text IS NULL OR gr.subject = sqlc.narg('subject'))
  AND (sqlc.narg('student_id')::uuid IS NULL OR s.id = sqlc.narg('student_id'))
ORDER BY s.full_name, gr.graded_on, gr.subject
LIMIT $1;

-- name: SearchCampusStudents :many
SELECT s.id, s.full_name, s.status, g.code AS group_code,
       ts_rank(s.search, q)::real AS rank
FROM campus_students s
LEFT JOIN campus_groups g ON g.id = s.group_id,
     websearch_to_tsquery('russian', $1) q
WHERE s.search @@ q
ORDER BY rank DESC, s.full_name
LIMIT $2;
