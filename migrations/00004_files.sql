-- 00004_files.sql — файловое хранилище: метаданные в Postgres,
-- содержимое на локальном диске VPS (заменяет S3). Файл привязывается
-- к доменной сущности парой (entity_type, entity_id).

-- +goose Up
CREATE TABLE files (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES tenants (id),
    name         text NOT NULL,
    content_type text NOT NULL DEFAULT 'application/octet-stream',
    size         bigint NOT NULL CHECK (size >= 0),
    sha256       text NOT NULL,                -- hex-хэш = имя блоба на диске
    entity_type  text NOT NULL DEFAULT '',     -- 'student', 'order', 'finance.entry', ...
    entity_id    text NOT NULL DEFAULT '',
    uploaded_by  text NOT NULL DEFAULT '',     -- ID актора (identity.Actor.ID)
    created_at   timestamptz NOT NULL DEFAULT now(),
    search tsvector GENERATED ALWAYS AS (to_tsvector('russian', coalesce(name, ''))) STORED
);

CREATE INDEX files_entity_idx ON files (tenant_id, entity_type, entity_id);
CREATE INDEX files_sha_idx    ON files (tenant_id, sha256);
CREATE INDEX files_search_idx ON files USING gin (search);

ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_files ON files
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- +goose Down
DROP TABLE IF EXISTS files;
