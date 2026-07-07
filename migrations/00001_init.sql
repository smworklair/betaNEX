-- 00001_init.sql — черновик схемы ядра (веха M2).
-- Статус: НАБРОСОК. До старта M2 схему можно менять свободно,
-- после попадания в main — только новыми миграциями поверх.

-- +goose Up

-- Организации (tenant'ы). Всё доменное — внутри tenant'а.
CREATE TABLE tenants (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        text NOT NULL UNIQUE,          -- короткое имя для URL/конфигов
    name        text NOT NULL,                 -- отображаемое название
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Пользователи. Принадлежат tenant'у; пароль — только argon2id-хэш.
CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenants (id),
    email         text NOT NULL,
    password_hash text NOT NULL,               -- argon2id, формат PHC
    display_name  text NOT NULL DEFAULT '',
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);

-- Сессии: opaque-токен храним только как хэш (утечка БД ≠ утечка сессий).
CREATE TABLE sessions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash  bytea NOT NULL UNIQUE,         -- sha256 от выданного токена
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz
);

-- Журнал аудита: append-only, пишется в одной транзакции с изменением.
CREATE TABLE audit_log (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id   uuid NOT NULL REFERENCES tenants (id),
    actor_id    uuid REFERENCES users (id),    -- NULL = системный актор
    command     text NOT NULL,                 -- имя команды, напр. "college.student.enroll"
    outcome     text NOT NULL,                 -- ok | denied | error
    detail      jsonb NOT NULL DEFAULT '{}',
    trace_id    text NOT NULL DEFAULT '',
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_tenant_time_idx ON audit_log (tenant_id, occurred_at DESC);

-- RLS: второй рубеж изоляции tenant'ов.
-- Приложение перед запросами выполняет: SET LOCAL app.tenant_id = '<uuid>'.
ALTER TABLE users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_users ON users
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_audit ON audit_log
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- +goose Down
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS tenants;
