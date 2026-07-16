# internal/module/files/handlers.go

Связывает команды модуля «Файлы» (Attach, Delete) с шиной команд: регистрирует обработчики, которые вызывают методы `Repository`. Аналог `RegisterCommands` в других модулях (campus, finance).

## Ключевое

- `Registrar` — локальный интерфейс с единственным методом `Register(name, h)`; используется вместо конкретного типа шины, чтобы модуль не зависел от её реализации напрямую.
- `RegisterCommands(bus Registrar, repo *Repository) error` — вызывается один раз из композиционного корня приложения при старте; подписывает обработчики на `CmdAttach` и `CmdDelete`.

## Как это работает

Обработчик `CmdAttach` конвертирует команду `Attach` в доменный тип `File`, проставляет `UploadedBy` из `identity.ActorFrom(ctx)` (если актор есть в контексте) и вызывает `repo.Create(ctx, f)`. Обработчик `CmdDelete` просто вызывает `repo.Delete(ctx, c.ID)`, отбрасывая дополнительные возвращаемые значения (SHA и флаг «ссылка ещё есть») — они нужны только HTTP-слою для очистки блоба, а не самой команде. Оба обработчика делают приведение типа команды (`cmd.(Attach)`) с проверкой `ok`, чтобы не упасть при ошибке регистрации.

## Связи

Зависит от `internal/kernel/command` (Command, HandlerFunc) и `internal/kernel/identity` (ActorFrom), а также от типов `Attach`, `Delete`, `File`, `CmdAttach`, `CmdDelete` из `files.go` и от `*Repository` из `pgrepo.go`. Вызывается композиционным корнем (аналогично `campus.RegisterCommands`), а также подразумевает, что `files/http.go` использует ту же шину для `bus.Dispatch`.

## На что обратить внимание

Определение локального интерфейса `Registrar` вместо использования готового типа шины из kernel — обеспечивает модулю независимость от конкретной реализации command bus и упрощает тестирование (можно подсунуть мок, реализующий только `Register`).
