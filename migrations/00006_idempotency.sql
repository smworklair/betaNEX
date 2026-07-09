-- 00006_idempotency.sql — идемпотентность записи по клиентскому ключу
-- (заголовок Idempotency-Key): повтор запроса из очереди офлайн-клиента
-- или ретрая возвращает сохранённый ответ, не исполняя команду дважды.

-- +goose Up
CREATE TABLE idempotency_keys (
    tenant_id    uuid NOT NULL REFERENCES tenants (id),
    key          text NOT NULL,
    status       int  NOT NULL DEFAULT 0,          -- 0 = запрос ещё выполняется
    content_type text NOT NULL DEFAULT '',
    body         bytea NOT NULL DEFAULT ''::bytea,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, key)
);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_idem ON idempotency_keys
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- +goose Down
DROP TABLE IF EXISTS idempotency_keys;
