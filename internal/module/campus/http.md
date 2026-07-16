# internal/module/campus/http.go

HTTP-слой модуля «Кампус»: регистрирует обработчики команд на шине и монтирует REST-маршруты для групп, студентов и учебного журнала. Связывает доменные команды из campus.go с внешним миром (браузер/фронтенд) через JSON и net/http.

## Ключевое

- `RegisterCommands(bus, repo)` — подписывает каждую команду модуля (CreateGroup, EnrollStudent, UpdateStudent, RecordGrade) на шину команд: обработчик достаёт типизированную команду, вызывает соответствующий метод `Repository`, для RecordGrade дополнительно проставляет `GradedBy` из `identity.ActorFrom(ctx)`.
- `Routes(bus, repo, guard) func(*http.ServeMux)` — фабрика, монтирующая маршруты `/api/v1/campus/groups`, `/students`, `/students/{id}`, `/grades`, `/journal` (GET/POST/PATCH согласно REST).
- `dispatch(w, r, bus, cmd)` — общий хелпер: валидирует команду, отправляет через шину, отвечает 201 или ошибкой.
- `decode(w, r, dst)` — строгий JSON-декодер (лимит тела 1 МБ, запрет неизвестных полей) для входящих запросов.
- `writeErr(w, err)` — маппинг доменных ошибок в HTTP-статусы и RFC 9457 problem-ответы (403 для отказа авторизации, 400 для отсутствия tenant, 409 для дубликата группы, 404 для «не найдено», 500 по умолчанию).
- `studentDTO`, `toStudentDTO` — форма данных студента для отдачи по JSON (отделена от доменного `Student`, добавляет удобные `omitempty`).

## Как это работает

GET-эндпоинты читают данные напрямую из `Repository`, но перед этим проверяют право на чтение через `httpapi.RequirePermission(w, r, guard, PermRead)` — синхронная проверка RBAC. Мутирующие эндпоинты (POST/PATCH), наоборот, не проверяют права сами — они собирают команду и отдают её в `dispatch`, а уже шина команд (`bus.Dispatch`) сама разбирается с авторизацией по `cmd.Permission()` и пишет в аудит-лог. Так реализуется единая точка контроля для всех мутаций домена, а не разбросанные проверки по каждому хендлеру.

## Связи

Импортирует `internal/kernel/authz` (Guard, ErrDenied), `internal/kernel/command` (Bus, Command, HandlerFunc), `internal/kernel/identity` (ActorFrom), `internal/platform/httpapi` (WriteJSON, WriteProblem, RequirePermission). Работает поверх `*Repository` и типов из `campus.go`. Композиционный корень приложения (скорее всего `cmd/nexd`) вызывает и `RegisterCommands`, и `Routes` при старте, передавая общую шину и guard.

## На что обратить внимание

Асимметрия проверки прав: чтения защищает guard прямо в хендлере, а мутации — нет, потому что авторизация мутаций делегирована шине команд (`bus.Dispatch` смотрит на `cmd.Permission()`). Это не пропущенная проверка, а осознанное разделение ответственности: любая мутация домена в NEX обязана идти через шину, поэтому проверка там — единая точка для всех входов, а не только HTTP.
