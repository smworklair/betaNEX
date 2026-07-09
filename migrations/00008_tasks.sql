-- 00008_tasks.sql — модуль «Задачи»: рабочие дела сотрудников
-- (подготовить приказ, проверить документы, напомнить о платеже).

-- +goose Up
CREATE TABLE tasks (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES tenants (id),
    title      text NOT NULL,
    note       text NOT NULL DEFAULT '',
    status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    due_on     date,
    assignee   text NOT NULL DEFAULT '',   -- ID актора-исполнителя
    created_by text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    done_at    timestamptz,
    search tsvector GENERATED ALWAYS AS (
        to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(note, ''))
    ) STORED
);
CREATE INDEX tasks_status_idx ON tasks (tenant_id, status, due_on);
CREATE INDEX tasks_search_idx ON tasks USING gin (search);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tasks ON tasks
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- +goose Down
DROP TABLE IF EXISTS tasks;
