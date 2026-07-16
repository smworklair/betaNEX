# internal/module/finance/search.go

Реализация полнотекстового поиска по счетам и проводкам модуля finance — часть сквозного (cross-module) поиска `/api/v1/search`, объявленного в `internal/platform/httpapi`.

## Ключевое

- `(*PostgresRepository) Search(ctx, query string, limit int) ([]httpapi.SearchHit, error)` — единственный метод файла; реализует интерфейс `httpapi.SearchSource` для модуля finance.

## Как это работает

Метод в одной транзакции (`InTenantTx`) выполняет два sqlc-запроса — `SearchFinanceAccounts` и `SearchFinanceEntries`, оба используют `websearch_to_tsquery` по `tsvector`-колонкам, заведённым в миграции `00003_search.sql`. Результаты обоих запросов сливаются в один плоский срез `httpapi.SearchHit`: счета получают `Kind: "finance.account"` и заголовок «код — название», проводки — `Kind: "finance.entry"` с заголовком по назначению платежа (`Memo`) и датой проведения. Ранжирование (`Rank`) приходит прямо из Postgres full-text search.

## Связи

Метод объявлен на `*PostgresRepository` (из `pgrepo.go`) — то есть физически это продолжение того же типа, просто вынесенное в отдельный файл по смыслу. Зависит от `internal/platform/httpapi` (тип `SearchHit`, интерфейс `SearchSource`) и `internal/platform/postgres/db` (сгенерированные запросы). Реализация есть только для Postgres — у `MemoryRepository` поиска нет, то есть в dev-режиме на in-memory хранилище сквозной поиск по финансам не работает.

## На что обратить внимание

Функция не проверяет `limit` на верхнюю границу сама — комментарий `#nosec G115` у приведения `int32(limit)` явно перекладывает ответственность за ограничение `limit` на вызывающий код (composition root/HTTP-слой поиска).
