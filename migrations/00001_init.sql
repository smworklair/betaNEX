-- 00001_init.sql — схема ядра (вехи M2–M3).
-- Применяется автоматически при старте nexd (goose, embed) или `make migrate`.

-- +goose Up

-- Организации (tenant'ы). Всё доменное — внутри tenant'а.
-- Реестр tenant'ов без RLS: он и есть точка входа в изоляцию.
CREATE TABLE tenants (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        text NOT NULL UNIQUE,          -- короткое имя для URL/конфигов
    name        text NOT NULL,                 -- отображаемое название
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Пользователи. Принадлежат tenant'у; пароль — только argon2id-хэш.
-- Роли пока храним массивом на пользователе; с вехой M4 раздача прав
-- переедет в настраиваемые RBAC-таблицы tenant'а.
CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenants (id),
    email         text NOT NULL,
    password_hash text NOT NULL,               -- argon2id, формат PHC
    display_name  text NOT NULL DEFAULT '',
    roles         text[] NOT NULL DEFAULT '{}',
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);

-- Сессии: opaque-токен храним только как хэш (утечка БД ≠ утечка сессий).
-- tenant_id дублируется из users: middleware сначала находит сессию по
-- хэшу токена (до того, как tenant известен), затем устанавливает
-- app.tenant_id и только после этого читает пользователя под RLS.
CREATE TABLE sessions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants (id),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash  bytea NOT NULL UNIQUE,         -- sha256 от выданного токена
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz
);

-- Журнал аудита: append-only, пишется в одной транзакции с изменением.
-- actor_id — непрозрачная строка (identity.Actor.ID): пользователь,
-- системный процесс или AI-актор. tenant_id NULL = событие вне tenant'а
-- (например, отклонённый запрос без контекста организации).
CREATE TABLE audit_log (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id   uuid REFERENCES tenants (id),
    actor_id    text NOT NULL DEFAULT '',
    command     text NOT NULL,                 -- имя команды, напр. "finance.entry.post"
    outcome     text NOT NULL,                 -- ok | denied | error
    detail      text NOT NULL DEFAULT '',
    trace_id    text NOT NULL DEFAULT '',
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_tenant_time_idx ON audit_log (tenant_id, occurred_at DESC);

-- RLS: второй рубеж изоляции tenant'ов (первый — фильтры приложения).
-- Приложение в каждой транзакции выполняет:
--   SELECT set_config('app.tenant_id', '<uuid>', true);
-- FORCE обязателен: без него владелец таблиц (роль приложения) обходит
-- политики молча. NULLIF(..., '') — при неустановленной переменной
-- политика видит NULL и не возвращает ни строки вместо ошибки каста.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_users ON users
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Сессии без RLS: поиск по хэшу токена происходит до того, как tenant
-- известен. Наружу таблица не видна, токены захэшированы.

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

-- Чтение — только записи своего tenant'а.
CREATE POLICY audit_select ON audit_log FOR SELECT
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Вставка — в свой tenant либо без tenant'а (системные события).
-- UPDATE/DELETE-политик нет намеренно: журнал append-only даже для
-- роли приложения.
CREATE POLICY audit_insert ON audit_log FOR INSERT
    WITH CHECK (tenant_id IS NOT DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- +goose Down
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS tenants;
