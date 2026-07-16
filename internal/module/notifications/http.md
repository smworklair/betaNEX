# internal/module/notifications/http.go

HTTP-слой модуля notifications: REST-эндпоинты личной ленты уведомлений пользователя.

## Ключевое

- `Routes(bus command.Bus, repo *Repository, guard *authz.Guard) func(mux *http.ServeMux)` — монтирует четыре маршрута: `GET /api/v1/notifications` (список, с query-параметрами `unread`, `limit`, `offset`), `GET /api/v1/notifications/unread-count`, `POST /api/v1/notifications/{id}/read`, `POST /api/v1/notifications/read-all`.
- `notificationDTO` — JSON-форма уведомления для ответа (в частности, `ReadAt` сериализуется как RFC3339-строка только если уведомление прочитано).
- `toDTO(n Notification) notificationDTO` — конвертер доменного типа в DTO.
- `dispatch(w, r, bus, cmd)` — общий помощник: валидирует команду, отправляет в шину, пишет `{"status":"ok"}`.
- `writeErr(w, err)` — маппинг ошибок модуля в HTTP-статусы (RFC 9457 через `httpapi.WriteProblem`).

## Как это работает

Лента строго персональная: и `GET`-, и `POST`-эндпоинты берут id пользователя не из URL/тела запроса, а из текущего актора в контексте (`identity.ActorFrom`) — пользователь физически не может прочитать или отметить чужие уведомления через этот API. Чтения (`GET /notifications`, `/unread-count`) авторизуются напрямую через `httpapi.RequirePermission(..., PermRead)` и читают из `Repository`. Отметка прочитанным (`POST .../read`, `/read-all`) идёт через командную шину (`MarkRead`/`MarkAllRead` из `notifications.go`) — там же авторизация по `PermWrite` и запись в аудит.

## Связи

Зависит от `internal/kernel/authz`, `internal/kernel/command`, `internal/kernel/identity`, `internal/platform/httpapi` и от `Repository`/команд, объявленных в `notifications.go` того же пакета. `Routes` вызывается из composition root при сборке HTTP-роутера.

## На что обратить внимание

Ничего специфически нетривиального — файл прямолинейно следует тому же паттерну «чтение через guard, запись через шину», что и `finance/http.go` и `tasks/http.go`.
