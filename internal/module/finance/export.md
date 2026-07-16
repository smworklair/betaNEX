# internal/module/finance/export.go

Отчётные и обменные HTTP-маршруты модуля «Финансы»: витрина месячных оборотов, экспорт в CSV/XLSX и импорт плана счетов из CSV. В отличие от `handlers.go`, работает только в Postgres-режиме — использует конкретный `*PostgresRepository`, а не абстрактный интерфейс `Repository`.

## Ключевое

- `RegisterStatsCommands(bus, repo *PostgresRepository)` — регистрирует команду `CmdStatsRefresh`/`RefreshStats`, которая пересчитывает материализованную витрину оборотов; отдельная функция от общего `RegisterCommands`, потому что витрина существует только на Postgres.
- `ReportRoutes(bus, repo, guard) func(*http.ServeMux)` — монтирует `GET /stats/monthly`, `POST /stats/refresh`, `GET /export/accounts.csv`, `GET /export/entries.csv`, `GET /export/turnovers.xlsx`, `POST /import/accounts`.
- `importAccounts(w, r, bus)` — построчный импорт плана счетов из CSV (`code,name,type[,currency]`), каждая строка проводится как обычная команда `CreateAccount` — с полной валидацией, авторизацией и аудитом, как при ручном вводе. Ошибочные строки не прерывают импорт, а собираются в отчёт (`created`/`errors`).
- `beginCSV(w, filename)` — хелпер, настраивающий заголовки ответа и UTF-8 BOM, чтобы кириллица в CSV корректно открывалась в Excel.

## Как это работает

GET-эндпоинты (витрина, экспорты) сначала проверяют право на чтение через `httpapi.RequirePermission`, затем читают данные из `PostgresRepository` и сериализуют их либо в JSON, либо в CSV (через `encoding/csv` с BOM), либо в XLSX (через `internal/platform/xlsx`). Импорт (`POST /import/accounts`) читает CSV построчно, пропускает заголовок, для каждой валидной строки формирует команду `CreateAccount` и диспатчит её через шину — то есть повторно использует ту же командную инфраструктуру, что и обычное создание счёта через API, вместо того чтобы писать в БД напрямую. Это гарантирует, что импортированные данные проходят те же проверки прав и оставляют тот же след в аудите, что и ручной ввод.

## Связи

Зависит от `internal/kernel/authz` (Guard), `internal/kernel/command` (Bus, Command), `internal/platform/httpapi` (WriteJSON, WriteProblem, RequirePermission) и `internal/platform/xlsx` (генерация XLSX). Использует `PostgresRepository` (из `finance.go`, не в списке файлов) и команду `CreateAccount` из `commands.go`. Регистрируется композиционным корнем наряду с `RegisterCommands` из `handlers.go`.

## На что обратить внимание

`importAccounts` намеренно не прерывается на первой ошибочной строке — собирает частичный отчёт об успехах/неудачах, что удобно для массового импорта, где часть строк может быть невалидной, но не должна блокировать остальные. Также обратите внимание, что эти маршруты — единственные в модуле finance, требующие именно `PostgresRepository`, а не абстрактный `Repository`: если приложение когда-то будет работать с `MemoryRepository`, эти отчётные функции окажутся недоступны.
