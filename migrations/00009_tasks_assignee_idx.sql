-- 00009_tasks_assignee_idx.sql — индекс под экран «мои задачи»:
-- ListTasks фильтрует по assignee, а существующий tasks_status_idx
-- покрывает только (tenant_id, status, due_on). Индекс частичный:
-- задачи без исполнителя (assignee = '') в выборку по исполнителю
-- не попадают и место в индексе не занимают.

-- +goose Up
CREATE INDEX tasks_assignee_idx ON tasks (tenant_id, assignee)
    WHERE assignee <> '';

-- +goose Down
DROP INDEX IF EXISTS tasks_assignee_idx;
