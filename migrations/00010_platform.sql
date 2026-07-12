-- 00010_platform.sql — платформенный фундамент: transactional outbox,
-- diff в журнале аудита, внутренние уведомления.

-- +goose Up

-- Transactional outbox: доменное изменение и намерение «сделать что-то
-- снаружи» (уведомить, отправить письмо, дёрнуть webhook) коммитятся
-- одной транзакцией; воркер разбирает очередь после коммита. Семантика
-- доставки — at-least-once: обработчики обязаны быть идемпотентными.
-- Без RLS (как sessions): воркер обходит все tenant'ы одним запросом,
-- наружу таблица не видна.
CREATE TABLE outbox (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id    uuid REFERENCES tenants (id),
    topic        text NOT NULL,                     -- напр. "notification.created"
    payload      jsonb NOT NULL DEFAULT '{}',
    created_at   timestamptz NOT NULL DEFAULT now(),
    available_at timestamptz NOT NULL DEFAULT now(), -- не раньше этого момента
    attempts     int NOT NULL DEFAULT 0,
    done_at      timestamptz,                       -- обработано (или похоронено)
    last_error   text NOT NULL DEFAULT ''           -- диагноз последней неудачи
);

-- Частичный индекс: воркер сканирует только необработанный хвост.
CREATE INDEX outbox_pending_idx ON outbox (available_at) WHERE done_at IS NULL;

-- Diff в аудите: «что именно поменялось» ({поле: {from, to}}), помимо
-- «кто и что сделал». NULL = команда диффа не сообщила.
ALTER TABLE audit_log ADD COLUMN diff jsonb;

-- Внутренние уведомления пользователям (колокольчик в шапке). Доставка
-- по внешним каналам (email) уходит через outbox — здесь только лента.
CREATE TABLE notifications (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES tenants (id),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind       text NOT NULL,                  -- напр. "task.assigned"
    title      text NOT NULL,
    body       text NOT NULL DEFAULT '',
    ref_type   text NOT NULL DEFAULT '',       -- тип связанной сущности ("task")
    ref_id     text NOT NULL DEFAULT '',       -- её идентификатор
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at    timestamptz
);

CREATE INDEX notifications_user_idx
    ON notifications (tenant_id, user_id, created_at DESC);
CREATE INDEX notifications_unread_idx
    ON notifications (tenant_id, user_id) WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_notifications ON notifications
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- +goose Down
DROP TABLE IF EXISTS notifications;
ALTER TABLE audit_log DROP COLUMN IF EXISTS diff;
DROP TABLE IF EXISTS outbox;
