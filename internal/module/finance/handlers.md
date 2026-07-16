# internal/module/finance/handlers.go

Связывает команды модуля «Финансы» (CreateAccount, PostEntry) с шиной команд — аналог `handlers.go` в модуле files и логики регистрации в `campus/http.go`, только вынесенный в отдельный файл.

## Ключевое

- `Registrar` — локальный интерфейс с методом `Register(name, h)`, как и в files/handlers.go — развязка от конкретной реализации шины.
- `RegisterCommands(bus Registrar, repo Repository) error` — вызывается один раз из композиционного корня (`cmd/nexd`); подписывает обработчики на `CmdAccountCreate` и `CmdEntryPost`. Принимает `Repository` как интерфейс (не конкретный `PostgresRepository`), в отличие от `export.go`.

## Как это работает

Обработчик `CmdAccountCreate` конвертирует команду `CreateAccount` в доменный `Account`: генерирует новый ID (`newID()`), подставляет валюту по умолчанию `"RUB"`, если не задана, проставляет `CreatedAt`, вызывает `repo.CreateAccount`. Обработчик `CmdEntryPost` конвертирует `PostEntry` в `Entry`: генерирует ID, копирует строки проводки как есть (баланс уже проверен в `Validate()` на этапе команды), проставляет `PostedBy` из `identity.ActorFrom(ctx)`, вызывает `repo.PostEntry`. Комментарий в коде явно отмечает, что событие `EntryPosted` (из `events.go`) пока не публикуется здесь — начнёт публиковаться, когда появится outbox-доставка.

## Связи

Зависит от `internal/kernel/command` (Command, HandlerFunc) и `internal/kernel/identity` (ActorFrom). Использует команды `CreateAccount`/`PostEntry` из `commands.go`, типы `Account`/`Entry` (из основного `finance.go`, не в списке) и интерфейс `Repository`. Дополняется `export.go`, который регистрирует ещё одну, Postgres-специфичную команду (`RegisterStatsCommands`) поверх той же шины.

## На что обратить внимание

`RegisterCommands` здесь принимает абстрактный интерфейс `Repository` (в отличие от `RegisterStatsCommands` в export.go, которому нужен конкретный `*PostgresRepository`) — то есть базовые операции модуля (создание счёта, проводка) работают с любой реализацией хранилища (включая `MemoryRepository` для тестов/разработки), а отчётные функции требуют именно Postgres.
