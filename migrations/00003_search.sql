-- 00003_search.sql — полнотекстовый поиск: tsvector/tsquery вместо
-- Elasticsearch (ноль внешних сервисов). Генерируемые колонки search
-- обновляются самим Postgres; GIN-индексы дают быстрый @@-поиск.
-- Конфигурация 'russian' — стемминг русского из коробки.

-- +goose Up
ALTER TABLE finance_accounts ADD COLUMN search tsvector
    GENERATED ALWAYS AS (
        to_tsvector('russian', coalesce(code, '') || ' ' || coalesce(name, ''))
    ) STORED;
CREATE INDEX finance_accounts_search_idx ON finance_accounts USING gin (search);

ALTER TABLE finance_entries ADD COLUMN search tsvector
    GENERATED ALWAYS AS (to_tsvector('russian', coalesce(memo, ''))) STORED;
CREATE INDEX finance_entries_search_idx ON finance_entries USING gin (search);

-- +goose Down
ALTER TABLE finance_entries DROP COLUMN IF EXISTS search;
ALTER TABLE finance_accounts DROP COLUMN IF EXISTS search;
