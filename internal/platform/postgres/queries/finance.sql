-- Запросы модуля «Финансы». Генерация: make sqlc → internal/platform/postgres/db.
-- Фильтра по tenant_id в тексте запросов нет намеренно: каждый запрос
-- выполняется в транзакции с app.tenant_id, и границу проводит RLS.

-- name: CreateFinanceAccount :one
INSERT INTO finance_accounts (tenant_id, code, name, type, currency)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetFinanceAccount :one
SELECT * FROM finance_accounts WHERE id = $1;

-- name: ListFinanceAccountsByIDs :many
SELECT * FROM finance_accounts WHERE id = ANY($1::uuid[]);

-- name: ListFinanceAccountsWithBalances :many
SELECT
    a.*,
    COALESCE(SUM(
        CASE
            WHEN a.type IN ('asset', 'expense') AND l.side = 'debit'  THEN l.amount
            WHEN a.type IN ('asset', 'expense') AND l.side = 'credit' THEN -l.amount
            WHEN l.side = 'credit' THEN l.amount
            WHEN l.side = 'debit'  THEN -l.amount
        END
    ), 0)::bigint AS balance
FROM finance_accounts a
LEFT JOIN finance_lines l ON l.account_id = a.id
GROUP BY a.id
ORDER BY a.code;

-- name: CreateFinanceEntry :one
INSERT INTO finance_entries (tenant_id, memo, posted_by)
VALUES ($1, $2, $3)
RETURNING *;

-- name: CreateFinanceLine :exec
INSERT INTO finance_lines (tenant_id, entry_id, account_id, side, amount)
VALUES ($1, $2, $3, $4, $5);

-- name: ListFinanceEntries :many
SELECT * FROM finance_entries ORDER BY posted_at, id;

-- name: ListFinanceLines :many
SELECT * FROM finance_lines ORDER BY entry_id, id;
