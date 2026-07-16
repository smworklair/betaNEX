# internal/module/tasks/tasks.go

Модуль «Задачи» — рабочие дела сотрудников колледжа (подготовить приказ, проверить документы абитуриента, напомнить о платеже). Единственный файл пакета — содержит домен, команды, репозиторий Postgres и регистрацию команд в шине.

## Ключевое

- `PermWrite`, `PermRead` — права изменения и чтения задач.
- `CmdCreate`, `CmdComplete`, `CmdDelete`, `CmdDispatch` — стабильные имена команд для аудита.
- `ErrNoTenant`, `ErrNotFound`, `ErrRecipientNotFound` — доменные ошибки модуля.
- `Task` — задача: заголовок, заметка, статус (`open`/`done`), срок, исполнитель, автор, метки времени.
- `Create{Title, Note, DueOn, Assignee}` — команда «создать задачу»; `Validate()` ограничивает длину заголовка 500 символами (считая руны, а не байты — важно для кириллицы).
- `Complete{ID}` — команда «отметить выполненной», идемпотентна.
- `Dispatch{ID, UserIDs}` — команда «разослать задачу» получателям через сервис уведомлений; рассылка атомарна (не уведомился один — не уведомился никто), максимум 100 получателей.
- `Delete{ID}` — команда «удалить задачу».
- `Repository` (Postgres) с методами `Create`, `Complete`, `Delete`, `List` (с фильтром `Filter`), `Get`, `Search`.
- `Filter{Status, Assignee, Query, Sort, Limit, Offset}` — параметры выборки списка задач.
- `Notifier` — интерфейс («то, что задачам нужно от сервиса уведомлений»), объявленный здесь, а не в пакете notifications — зависимость идёт от потребителя.
- `RegisterCommands(bus, repo, notifier)` — регистрирует все четыре команды в шине.

## Как это работает

`Create` при отсутствии явного `Assignee` назначает задачу на самого автора (`t.Assignee = actor.ID`) — «задача без исполнителя — себе». `Complete` работает только с открытыми задачами (0 затронутых строк → `ErrNotFound`) и после успеха явно фиксирует детерминированный diff в аудит через `audit.SetDiff(ctx, ...)`, поскольку переход всегда один и тот же (`open` → `done`). `Dispatch` не хранит уведомления сам — подгружает задачу через `repo.Get`, затем вызывает `notifier.Notify(...)`; если `notifier == nil` (уведомления не подключены на этом развёртывании), команда просто возвращает ошибку вместо паники. `Repository.exec` — общий приватный хелпер для `Complete`/`Delete`: парсит ID в UUID, выполняет операцию, проверяет число задетых строк.

## Связи

Зависит от `internal/kernel/audit`, `internal/kernel/command`, `internal/kernel/identity`, `internal/kernel/tenancy`, `internal/platform/httpapi` (тип `SearchHit` для `Search`), `internal/platform/postgres` и `internal/platform/postgres/db`. Интерфейс `Notifier` реализует `*notifications.Service` — их связывает composition root. `http.go` того же пакета — HTTP-обёртка. `internal/module/terminal` через адаптеры composition root дергает `Repository.List`/`Create`/`Complete` (поля `Deps.Tasks`, `Deps.AddTask`, `Deps.DoneTask`).

## На что обратить внимание

Проверка длины заголовка в `Create.Validate()` явно считает руны (`utf8.RuneCountInString`), а не байты — комментарий поясняет, что байтовый лимит вдвое урезал бы русские заголовки, так как кириллица в UTF-8 занимает два байта на символ.
