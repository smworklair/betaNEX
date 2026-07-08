-- 00002_finance.sql — леджер двойной записи модуля «Финансы» (ADR-021).

-- +goose Up

-- План счетов. Код уникален в пределах tenant'а.
CREATE TABLE finance_accounts (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES tenants (id),
    code       text NOT NULL,
    name       text NOT NULL,
    type       text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
    currency   char(3) NOT NULL DEFAULT 'RUB',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

-- Проводки: append-only, исправление — сторнирующей проводкой.
-- posted_by — непрозрачный ID актора (identity.Actor.ID), как в audit_log.
CREATE TABLE finance_entries (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES tenants (id),
    memo       text NOT NULL DEFAULT '',
    posted_by  text NOT NULL DEFAULT '',
    posted_at  timestamptz NOT NULL DEFAULT now()
);

-- Строки проводок. Суммы — bigint в минорных единицах (копейках).
CREATE TABLE finance_lines (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id  uuid NOT NULL REFERENCES tenants (id),
    entry_id   uuid NOT NULL REFERENCES finance_entries (id),
    account_id uuid NOT NULL REFERENCES finance_accounts (id),
    side       text NOT NULL CHECK (side IN ('debit', 'credit')),
    amount     bigint NOT NULL CHECK (amount > 0)
);

CREATE INDEX finance_lines_account_idx ON finance_lines (tenant_id, account_id);
CREATE INDEX finance_lines_entry_idx   ON finance_lines (entry_id);
CREATE INDEX finance_entries_time_idx  ON finance_entries (tenant_id, posted_at DESC);

-- Изоляция tenant'ов: RLS — второй рубеж после фильтров приложения.
-- FORCE и NULLIF — по тем же причинам, что в 00001_init.sql.
ALTER TABLE finance_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE finance_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_entries  FORCE ROW LEVEL SECURITY;
ALTER TABLE finance_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_lines    FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_fin_accounts ON finance_accounts
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_fin_entries ON finance_entries
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_fin_lines ON finance_lines
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Второй рубеж инварианта «дебет = кредит» (первый — PostEntry.Validate):
-- отложенный constraint-триггер проверяет баланс каждой проводки на COMMIT.
-- +goose StatementBegin
CREATE FUNCTION finance_check_entry_balanced() RETURNS trigger AS $$
DECLARE
    diff bigint;
BEGIN
    SELECT COALESCE(SUM(CASE side WHEN 'debit' THEN amount ELSE -amount END), 0)
    INTO diff
    FROM finance_lines
    WHERE entry_id = NEW.entry_id;

    IF diff <> 0 THEN
        RAISE EXCEPTION 'finance: entry % is not balanced (debit-credit=%)', NEW.entry_id, diff;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER finance_entry_balanced
    AFTER INSERT ON finance_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION finance_check_entry_balanced();

-- +goose Down
DROP TABLE IF EXISTS finance_lines;
DROP FUNCTION IF EXISTS finance_check_entry_balanced;
DROP TABLE IF EXISTS finance_entries;
DROP TABLE IF EXISTS finance_accounts;
