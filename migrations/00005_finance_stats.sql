-- 00005_finance_stats.sql — отчётная витрина финансов: обороты по
-- счетам по месяцам. Обычная таблица, а не MATERIALIZED VIEW,
-- намеренно: REFRESH MATERIALIZED VIEW выполняется от владельца и под
-- FORCE RLS без tenant'а увидел бы ноль строк. Витрина пересчитывается
-- per-tenant ночной задачей и командой finance.stats.refresh.

-- +goose Up
CREATE TABLE finance_monthly_turnovers (
    tenant_id    uuid NOT NULL REFERENCES tenants (id),
    month        date NOT NULL,           -- первый день месяца
    account_id   uuid NOT NULL REFERENCES finance_accounts (id),
    debit        bigint NOT NULL DEFAULT 0,
    credit       bigint NOT NULL DEFAULT 0,
    refreshed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, month, account_id)
);

ALTER TABLE finance_monthly_turnovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_monthly_turnovers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_fin_turnovers ON finance_monthly_turnovers
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- +goose Down
DROP TABLE IF EXISTS finance_monthly_turnovers;
