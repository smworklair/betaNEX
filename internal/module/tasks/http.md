# internal/module/tasks/http.go

HTTP-слой модуля tasks: REST-эндпоинты для CRUD-операций над задачами и их рассылки.

## Ключевое

- `Routes(bus command.Bus, repo *Repository, guard *authz.Guard) func(mux *http.ServeMux)` — монтирует маршруты: `POST /api/v1/tasks` (создать), `GET /api/v1/tasks` (список с фильтрами `status`, `assignee`, `q`, `sort`, `limit`, `offset`), `POST /api/v1/tasks/{id}/complete`, `POST /api/v1/tasks/{id}/dispatch` (рассылка получателям), `DELETE /api/v1/tasks/{id}`.
- `taskDTO` — JSON-форма задачи для ответа (даты форматируются отдельно: `DueOn` как `YYYY-MM-DD`, `DoneAt` как RFC3339).
- `toDTO(t Task) taskDTO` — конвертер.
- `dispatch(w, r, bus, cmd, okStatus)` — общий помощник: валидирует команду, шлёт в шину, пишет ответ с заданным HTTP-статусом (поддерживает `204 No Content` для удаления).
- `writeErr(w, err)` — маппинг ошибок модуля (`ErrNoTenant`, `ErrNotFound`, `ErrRecipientNotFound`, `authz.ErrDenied`) в HTTP-статусы по RFC 9457.

## Как это работает

Создание задачи (`POST /tasks`) разбирает JSON вручную прямо в хендлере (не через отдельный DTO-тип с тегами, а через анонимную структуру), отдельно парсит `due_on` как дату `2006-01-02` перед сборкой команды `Create`. Все мутации (`create`, `complete`, `dispatch`, `delete`) идут через `dispatch` → командную шину — авторизация по `PermWrite` и аудит там. Единственное чтение (`GET /tasks`) авторизуется отдельно через `httpapi.RequirePermission(..., PermRead)` и обращается напрямую к `repo.List`.

## Связи

Зависит от `internal/kernel/authz`, `internal/kernel/command`, `internal/platform/httpapi` и от типов/команд, объявленных в `tasks.go` того же пакета (`Create`, `Complete`, `Delete`, `Dispatch`, `Filter`, `Repository`). Монтируется composition root'ом при сборке общего HTTP-роутера.

## На что обратить внимание

`dispatch` в этом файле — локальный HTTP-хелпер («отправить команду в шину и написать ответ»), а не связан с командой `Dispatch` («разослать задачу получателям») из `tasks.go` — имена совпадают случайно, это разные вещи на разных уровнях абстракции.
