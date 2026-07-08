-- 00002_finance.sql — леджер двойной записи модуля «Финансы» (ADR-021).
-- Статус: ЧЕРНОВИК до вехи M2 — применяется, когда появится Postgres-слой.

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
CREATE TABLE finance_entries (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES tenants (id),
    memo       text NOT NULL DEFAULT '',
    posted_by  uuid REFERENCES users (id),
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
ALTER TABLE finance_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_lines    ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_fin_accounts ON finance_accounts
    USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_fin_entries ON finance_entries
    USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_fin_lines ON finance_lines
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Инвариант «дебет = кредит» проверяется в command-слое (PostEntry.Validate);
-- на вехе M2 сюда добавится constraint-триггер как второй рубеж.

-- +goose Down
DROP TABLE IF EXISTS finance_lines;
DROP TABLE IF EXISTS finance_entries;
DROP TABLE IF EXISTS finance_accounts;
