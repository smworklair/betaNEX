# internal/platform/httpapi/auditview.go

HTTP-эндпоинт для просмотра журнала аудита — списка событий вида «кто и когда менял оценки, приказы, проводки». Это единственный административный read-only маршрут, который не проходит через обычную шину команд модулей, поэтому у него нет своего `Permission()` и он проверяет роль напрямую.

## Ключевое

- `AuditRoutes(reader audit.Reader) func(mux *http.ServeMux)` — фабрика функции монтирования маршрута `GET /api/v1/audit`, совместимая с полем `RouterConfig.Mount` в `routes.go`.
- `GET /api/v1/audit?limit=100&command=...&actor=...` — отдаёт список записей аудита, отфильтрованных по лимиту, имени команды и ID актора.
- `auditEntryDTO` — DTO записи аудита для JSON-ответа (команда, исход, актор, деталь, diff, trace ID, время).
- `requireRole(w, r, role) bool` — вспомогательная проверка: актор аутентифицирован и несёт указанную роль; сама пишет problem-ответ (401/403) при отказе.

## Как это работает

Хендлер сначала требует роль `admin` через `requireRole` (используя `identity.ActorFrom` для актора из контекста запроса). Затем читает query-параметры (`limit`, `command`, `actor`) и вызывает `reader.Entries` с построенным `audit.Filter`. Результат преобразуется в срез DTO и отдаётся как JSON через `WriteJSON`.

## Связи

Зависит от `internal/kernel/audit` (интерфейс `Reader`, тип `Filter`, `Entry`, `Diff`) и `internal/kernel/identity` (`ActorFrom`, `Actor.Roles`). Использует общие хелперы пакета `httpapi`: `WriteJSON`, `WriteProblem` (problem.go). Монтируется в композиционном корне через `RouterConfig.Mount` (см. routes.go), реализация `audit.Reader` подставляется из `platform/postgres` или in-memory хранилища.

## На что обратить внимание

`requireRole` — это отдельная, более простая проверка прав, чем `RequirePermission` из authz.go: она проверяет ровно одну роль по имени, а не право через RBAC-политику `authz.Guard`. Это осознанное упрощение именно потому, что этот маршрут не связан ни с одной командой шины и не имеет `Permission()`.
