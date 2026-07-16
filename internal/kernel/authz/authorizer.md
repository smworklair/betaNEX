# internal/kernel/authz/authorizer.go

Реализация интерфейса `command.Authorizer` поверх статической RBAC-политики (`Policy`). Это тот компонент, который шина команд (`command.MemoryBus`) вызывает перед исполнением каждой команды, чтобы решить, разрешено ли актору её выполнить.

## Ключевое

- `PolicyAuthorizer` — структура, оборачивающая `*Policy` и реализующая интерфейс `command.Authorizer`.
- `NewPolicyAuthorizer(p *Policy) *PolicyAuthorizer` — конструктор.
- `(*PolicyAuthorizer) Authorize(ctx, cmd command.Command) error` — достаёт актора из контекста (`identity.ActorFrom`), и если его нет — возвращает `ErrDenied` с пометкой «no actor in context»; если актор есть, проверяет через `policy.Allows(actor.Roles, cmd.Permission())`, есть ли у любой из его ролей требуемое командой право.

## Как это работает

Метод `Authorize` — прямой мост между двумя пакетами ядра: он берёт право, которое объявляет сама команда через `cmd.Permission()` (часть интерфейса `command.Command`), и роли актора из контекста запроса, и сверяет их по матрице `Policy`. Если совпадений нет — команда отклоняется ошибкой, оборачивающей `ErrDenied` (проверяется через `errors.Is`), и это решение попадает в аудит как `OutcomeDenied`.

## Связи

Зависит от `internal/kernel/command` (интерфейсы `Authorizer`, `Command`) и `internal/kernel/identity` (`ActorFrom`), а также от `policy.go` того же пакета (`Policy`, `ErrDenied`). Используется в `cmd/nexd/main.go`, где `authz.NewPolicyAuthorizer(policy)` передаётся в `command.NewMemoryBus` как единственный авторизатор шины команд.

## На что обратить внимание

Запрос без актора в контексте отклоняется всегда, независимо от политики — анонимные команды в принципе невозможны через шину; это отдельный путь отказа от «есть актор, но нет права».
