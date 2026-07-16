# web/src/api/tasks.ts

Обёртка над `/api/v1/tasks` — CRUD-операции над задачами: список, создание, отметка выполненной, удаление. Приводит DTO бэкенда к форме, которую рисует UI-прототип, расширяя её дополнительными «богатыми» полями сервера.

## Ключевое

- `interface ApiTask` — DTO бэкенда (`internal/module/tasks/http.go: taskDTO`): `id`, `title`, `note?`, `status` (`open`/`done`), `due_on?`, `assignee?`, `created_by?`, `created_at`, `done_at?`.
- `interface UITask extends Task` — форма, которую рисует прототип (`Task` из `../data`) плюс `note` и `status` с сервера.
- `fromApi(t: ApiTask): UITask` — адаптер DTO → UI-форма (маппинг `status`→`done: boolean`, `due_on`→`due`, `assignee`→`who`).
- `seedToUI(t: Task): UITask` — обратный путь для демо-данных: превращает мок-задачу прототипа в ту же UI-форму, что и реальные данные (унификация двух источников).
- `listTasks(): Promise<UITask[]>` — список задач через `withFallback` (сид — `seedTasks.map(seedToUI)`).
- `interface NewTask` — тело запроса на создание (`title`, `note?`, `due_on?`, `assignee?`).
- `createTask(input): Promise<void>`, `completeTask(id): Promise<void>`, `deleteTask(id): Promise<void>` — прямые мутации через `apiFetch` (POST/POST/DELETE), без фолбэка на моки — при ошибке бросают `ApiError`.

## Как это работает

Чтение (`listTasks`) идёт через `withFallback`, поэтому список задач всегда отображается, даже без бэкенда. Мутации намеренно обходят фолбэк-слой (см. `client.ts`) — если создание/завершение/удаление задачи не удалось на сервере, экран должен об этом узнать, а не сделать вид, что всё получилось. `seedToUI` — мостик, который позволяет мок-данным (`Task` из `../data`, более простая форма) и реальным серверным задачам (`UITask`, форма с `note`/`status`) рендериться одним и тем же UI-кодом.

## Связи

Импортирует `tasks` (сиды) и тип `Task` из `../data`, `apiFetch`/`withFallback` из `./client`. Реэкспортируется через `web/src/api/index.ts` как `tasksApi`. Потребляется экраном `web/src/pages/tasks` и, вероятно, виджетом задач в ленте (`SECTIONS` в `App.tsx` показывает «Задачи» в разделе «Лента»).

## На что обратить внимание

`createTask`/`completeTask`/`deleteTask` возвращают `void` и не обновляют локальный список сами — вызывающий код обязан сам перезапросить `listTasks()` (или обновить локальное состояние) после успешной мутации, иначе список задач в UI останется устаревшим.
