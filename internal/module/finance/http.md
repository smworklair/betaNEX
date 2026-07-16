# internal/module/finance/http.go

HTTP-слой модуля finance: превращает REST-запросы в команды для шины (`command.Bus`) или прямые чтения из `Repository`, и обратно — доменные типы в JSON-ответы. Стандартный «тонкий» HTTP-адаптер, вся бизнес-логика — в `commands.go`/`ledger.go`/репозиториях.

## Ключевое

- `maxBodyBytes` — лимит размера тела запроса (1 МБ), защита от раздутых запросов.
- `Routes(bus command.Bus, repo Repository, guard *authz.Guard) func(mux *http.ServeMux)` — точка монтирования маршрутов модуля; вызывается из composition root через `httpapi.RouterConfig.Mount`. Регистрирует: `POST /api/v1/finance/accounts`, `GET /api/v1/finance/accounts`, `POST /api/v1/finance/entries`, `GET /api/v1/finance/entries`.
- `accountRequest`/`accountResponse`, `entryRequest`/`entryResponse`, `lineDTO` — DTO для JSON-сериализации; отделяют внешний контракт API от внутренних доменных типов (`Account`, `Entry`, `Line`).
- `decode(w, r, dst) bool` — общий помощник разбора JSON-тела с `DisallowUnknownFields` и лимитом размера; при ошибке сам пишет HTTP 400 и возвращает `false`.
- `writeCommandError(w, err)` — маппит доменные и инфраструктурные ошибки в статусы по RFC 9457 (`httpapi.WriteProblem`).

## Как это работает

Мутирующие эндпоинты (`POST`) не проверяют право напрямую в хендлере — они собирают команду (`CreateAccount` или `PostEntry`), сами вызывают её `Validate()` для быстрого отсева некорректного ввода (400 без похода в шину), а затем отдают в `bus.Dispatch`: именно шина команд проверяет право (`Permission()` команды), пишет аудит-запись и исполняет обработчик в транзакции. Читающие эндпоинты (`GET`) авторизуются иначе — напрямую через `httpapi.RequirePermission(w, r, guard, PermRead)`, минуя шину, и сразу читают из `Repository`. Это отражает общее правило модуля: «мутации — только через шину, чтения — через guard + репозиторий».

## Связи

Зависит от `internal/kernel/authz` (`Guard`, `ErrDenied`), `internal/kernel/command` (`Bus`), `internal/platform/httpapi` (`WriteJSON`, `WriteProblem`, `RequirePermission`) и от остального пакета finance — `Repository` (`repo.go`), команд `CreateAccount`/`PostEntry` (`commands.go`), ошибок (`repo.go`, `commands.go`). `Routes` вызывается из composition root (`cmd/nexd`), который передаёт конкретную реализацию `Repository` (mem или pg) и настроенные `bus`/`guard`.

## На что обратить внимание

`writeCommandError` — единственное место, которое знает, как каждая доменная ошибка модуля превращается в HTTP-статус (404/409/422/403/400/500) — при добавлении новой ошибки в `repo.go` или `commands.go` про этот `switch` легко забыть, и тогда она молча упадёт в générique 500.
