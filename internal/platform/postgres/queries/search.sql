-- Полнотекстовый поиск (веб-синтаксис websearch_to_tsquery: кавычки,
-- минус-слова, OR). Фильтра по tenant_id нет — границу проводит RLS.

-- name: SearchFinanceAccounts :many
SELECT a.id, a.code, a.name,
       ts_rank(a.search, q)::real AS rank
FROM finance_accounts a, websearch_to_tsquery('russian', $1) q
WHERE a.search @@ q
ORDER BY rank DESC, a.code
LIMIT $2;

-- name: SearchFinanceEntries :many
SELECT e.id, e.memo, e.posted_at,
       ts_rank(e.search, q)::real AS rank
FROM finance_entries e, websearch_to_tsquery('russian', $1) q
WHERE e.search @@ q
ORDER BY rank DESC, e.posted_at DESC
LIMIT $2;
