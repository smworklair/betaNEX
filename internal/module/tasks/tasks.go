// Package tasks — модуль «Задачи»: рабочие дела сотрудников колледжа
// (подготовить приказ, проверить документы абитуриента, напомнить о
// платеже). Создание/выполнение/удаление — команды через шину.
package tasks

import (
	"context"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/smworklair/betakis/internal/kernel/audit"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/kernel/identity"
	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/platform/httpapi"
	"github.com/smworklair/betakis/internal/platform/postgres"
	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// Права модуля.
const (
	// PermWrite — право изменения задач.
	PermWrite = "tasks:write"
	// PermRead — право чтения списка задач.
	PermRead = "tasks:read"
)

// Имена команд.
const (
	CmdCreate   = "tasks.create"
	CmdComplete = "tasks.complete"
	CmdDelete   = "tasks.delete"
	CmdDispatch = "tasks.dispatch"
)

// Ошибки модуля.
var (
	ErrNoTenant = errors.New("tasks: no tenant in context")
	ErrNotFound = errors.New("tasks: task not found")
	// ErrRecipientNotFound — получатель рассылки не существует в tenant'е.
	// В неё композиционный корень переводит ошибку сервиса уведомлений.
	ErrRecipientNotFound = errors.New("tasks: recipient not found")
)

// Task — рабочая задача.
type Task struct {
	ID        string
	Title     string
	Note      string
	Status    string // open | done
	DueOn     time.Time
	Assignee  string
	CreatedBy string
	CreatedAt time.Time
	DoneAt    time.Time
}

// Create — команда «создать задачу».
type Create struct {
	Title    string
	Note     string
	DueOn    time.Time // нулевое время = без срока
	Assignee string
}

// Name возвращает стабильное имя команды для аудита.
func (Create) Name() string { return CmdCreate }

// Permission возвращает право, требуемое для исполнения.
func (Create) Permission() string { return PermWrite }

// Validate проверяет инварианты входа.
func (c Create) Validate() error {
	if c.Title == "" {
		return errors.New("tasks: title is required")
	}
	// Считаем символы, а не байты: кириллица в UTF-8 занимает два байта,
	// и лимит в байтах вдвое урезал бы русские заголовки.
	if utf8.RuneCountInString(c.Title) > 500 {
		return errors.New("tasks: title is too long")
	}
	return nil
}

// Complete — команда «отметить задачу выполненной». Идемпотентна.
type Complete struct{ ID string }

// Name возвращает стабильное имя команды для аудита.
func (Complete) Name() string { return CmdComplete }

// Permission возвращает право, требуемое для исполнения.
func (Complete) Permission() string { return PermWrite }

// Validate проверяет инварианты входа.
func (c Complete) Validate() error {
	if c.ID == "" {
		return errors.New("tasks: id is required")
	}
	return nil
}

// Dispatch — команда «разослать задачу»: получатели узнают о задаче
// через сервис уведомлений (внутренняя лента + внешняя доставка через
// outbox). Рассылка атомарна: не уведомился один — не уведомился никто.
type Dispatch struct {
	ID      string
	UserIDs []string
}

// Name возвращает стабильное имя команды для аудита.
func (Dispatch) Name() string { return CmdDispatch }

// Permission возвращает право, требуемое для исполнения.
func (Dispatch) Permission() string { return PermWrite }

// Validate проверяет инварианты входа.
func (c Dispatch) Validate() error {
	if c.ID == "" {
		return errors.New("tasks: id is required")
	}
	if len(c.UserIDs) == 0 {
		return errors.New("tasks: user_ids is required")
	}
	if len(c.UserIDs) > 100 {
		return errors.New("tasks: too many recipients (max 100)")
	}
	for _, id := range c.UserIDs {
		if id == "" {
			return errors.New("tasks: empty user id in user_ids")
		}
	}
	return nil
}

// Delete — команда «удалить задачу».
type Delete struct{ ID string }

// Name возвращает стабильное имя команды для аудита.
func (Delete) Name() string { return CmdDelete }

// Permission возвращает право, требуемое для исполнения.
func (Delete) Permission() string { return PermWrite }

// Validate проверяет инварианты входа.
func (c Delete) Validate() error {
	if c.ID == "" {
		return errors.New("tasks: id is required")
	}
	return nil
}

// --- Репозиторий ----------------------------------------------------------------

// Repository — хранилище задач в Postgres.
type Repository struct {
	db *postgres.DB
}

// NewRepository создаёт репозиторий поверх подключения к БД.
func NewRepository(d *postgres.DB) *Repository { return &Repository{db: d} }

// Filter — фильтры и сортировка списка задач.
type Filter struct {
	Status   string // open | done | ""
	Assignee string
	Query    string // полнотекстовый поиск
	Sort     string // due | due_desc | created | "" (свежие первыми)
	Limit    int
	Offset   int
}

// Create сохраняет задачу.
func (r *Repository) Create(ctx context.Context, t Task) (Task, error) {
	var out Task
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		tenant, ok := tenancy.TenantFrom(ctx)
		if !ok {
			return ErrNoTenant
		}
		var tu pgtype.UUID
		if err := tu.Scan(tenant); err != nil {
			return fmt.Errorf("%w: %q", ErrNoTenant, tenant)
		}
		due := pgtype.Date{}
		if !t.DueOn.IsZero() {
			due = pgtype.Date{Time: t.DueOn, Valid: true}
		}
		row, err := q.CreateTask(ctx, db.CreateTaskParams{
			TenantID: tu, Title: t.Title, Note: t.Note,
			DueOn: due, Assignee: t.Assignee, CreatedBy: t.CreatedBy,
		})
		if err != nil {
			return err
		}
		out = taskFromRow(row)
		return nil
	})
	return out, mapErr(err)
}

// Complete отмечает открытую задачу выполненной; уже выполненная или
// отсутствующая → ErrNotFound.
func (r *Repository) Complete(ctx context.Context, id string) error {
	return r.exec(ctx, id, func(ctx context.Context, q *db.Queries, u pgtype.UUID) (int64, error) {
		return q.CompleteTask(ctx, u)
	})
}

// Delete удаляет задачу.
func (r *Repository) Delete(ctx context.Context, id string) error {
	return r.exec(ctx, id, func(ctx context.Context, q *db.Queries, u pgtype.UUID) (int64, error) {
		return q.DeleteTask(ctx, u)
	})
}

func (r *Repository) exec(ctx context.Context, id string, op func(context.Context, *db.Queries, pgtype.UUID) (int64, error)) error {
	var u pgtype.UUID
	if err := u.Scan(id); err != nil {
		return fmt.Errorf("%w: %s", ErrNotFound, id)
	}
	return mapErr(r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		n, err := op(ctx, q, u)
		if err != nil {
			return err
		}
		if n == 0 {
			return fmt.Errorf("%w: %s", ErrNotFound, id)
		}
		return nil
	}))
}

// List возвращает задачи по фильтру с сортировкой.
func (r *Repository) List(ctx context.Context, f Filter) ([]Task, error) {
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 100
	}
	params := db.ListTasksParams{
		Limit:  int32(f.Limit),  // #nosec G115 -- ограничен 500 выше
		Offset: int32(f.Offset), // #nosec G115 -- смещение пагинации
		Sort:   f.Sort,
	}
	if f.Status != "" {
		params.Status = &f.Status
	}
	if f.Assignee != "" {
		params.Assignee = &f.Assignee
	}
	if f.Query != "" {
		params.Q = &f.Query
	}
	var out []Task
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		rows, err := q.ListTasks(ctx, params)
		if err != nil {
			return err
		}
		out = make([]Task, 0, len(rows))
		for _, row := range rows {
			out = append(out, taskFromRow(row))
		}
		return nil
	})
	return out, mapErr(err)
}

// Get возвращает задачу по ID.
func (r *Repository) Get(ctx context.Context, id string) (Task, error) {
	var u pgtype.UUID
	if err := u.Scan(id); err != nil {
		return Task{}, fmt.Errorf("%w: %s", ErrNotFound, id)
	}
	var out Task
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		row, err := q.GetTask(ctx, u)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: %s", ErrNotFound, id)
		}
		if err != nil {
			return err
		}
		out = taskFromRow(row)
		return nil
	})
	return out, mapErr(err)
}

// Notifier — то, что задачам нужно от сервиса уведомлений. Интерфейс
// объявлен здесь (а не в notifications), чтобы зависимость шла от
// потребителя: tasks не знает, кто именно доставит уведомление.
// Реализация — notifications.Service; связывает их композиционный корень.
type Notifier interface {
	Notify(ctx context.Context, userIDs []string, kind, title, body, refType, refID string) error
}

// RegisterCommands подключает команды модуля к шине. notifier может быть
// nil — тогда команда рассылки отвечает ошибкой (уведомления не подключены).
func RegisterCommands(bus interface {
	Register(name string, h command.HandlerFunc) error
}, repo *Repository, notifier Notifier,
) error {
	if err := bus.Register(CmdCreate, func(ctx context.Context, cmd command.Command) error {
		c, ok := cmd.(Create)
		if !ok {
			return fmt.Errorf("tasks: %s: unexpected command type %T", CmdCreate, cmd)
		}
		t := Task{Title: c.Title, Note: c.Note, DueOn: c.DueOn, Assignee: c.Assignee}
		if actor, ok := identity.ActorFrom(ctx); ok {
			t.CreatedBy = actor.ID
			if t.Assignee == "" {
				t.Assignee = actor.ID // задача без исполнителя — себе
			}
		}
		_, err := repo.Create(ctx, t)
		return err
	}); err != nil {
		return err
	}
	if err := bus.Register(CmdComplete, func(ctx context.Context, cmd command.Command) error {
		c, ok := cmd.(Complete)
		if !ok {
			return fmt.Errorf("tasks: %s: unexpected command type %T", CmdComplete, cmd)
		}
		if err := repo.Complete(ctx, c.ID); err != nil {
			return err
		}
		// Complete переводит только открытые задачи — дифф детерминирован.
		audit.SetDiff(ctx, audit.Diff{"status": {From: "open", To: "done"}})
		return nil
	}); err != nil {
		return err
	}
	if err := bus.Register(CmdDispatch, func(ctx context.Context, cmd command.Command) error {
		c, ok := cmd.(Dispatch)
		if !ok {
			return fmt.Errorf("tasks: %s: unexpected command type %T", CmdDispatch, cmd)
		}
		if notifier == nil {
			return errors.New("tasks: dispatch: notifications are not configured")
		}
		t, err := repo.Get(ctx, c.ID)
		if err != nil {
			return err
		}
		return notifier.Notify(ctx, c.UserIDs,
			"task.assigned", "Вам направлена задача: "+t.Title, t.Note, "task", t.ID)
	}); err != nil {
		return err
	}
	return bus.Register(CmdDelete, func(ctx context.Context, cmd command.Command) error {
		c, ok := cmd.(Delete)
		if !ok {
			return fmt.Errorf("tasks: %s: unexpected command type %T", CmdDelete, cmd)
		}
		return repo.Delete(ctx, c.ID)
	})
}

func mapErr(err error) error {
	if errors.Is(err, postgres.ErrNoTenant) || errors.Is(err, postgres.ErrInvalidTenant) {
		return fmt.Errorf("%w: %v", ErrNoTenant, err)
	}
	return err
}

func taskFromRow(row db.Task) Task {
	t := Task{
		ID: row.ID.String(), Title: row.Title, Note: row.Note,
		Status: row.Status, Assignee: row.Assignee, CreatedBy: row.CreatedBy,
		CreatedAt: row.CreatedAt.Time,
	}
	if row.DueOn.Valid {
		t.DueOn = row.DueOn.Time
	}
	if row.DoneAt.Valid {
		t.DoneAt = row.DoneAt.Time
	}
	return t
}

// Search — полнотекстовый поиск по задачам (httpapi.SearchSource).
func (r *Repository) Search(ctx context.Context, query string, limit int) ([]httpapi.SearchHit, error) {
	items, err := r.List(ctx, Filter{Query: query, Limit: limit})
	if err != nil {
		return nil, err
	}
	hits := make([]httpapi.SearchHit, 0, len(items))
	for _, t := range items {
		hits = append(hits, httpapi.SearchHit{
			Kind: "task", ID: t.ID, Title: t.Title, Snippet: t.Note, At: t.CreatedAt,
		})
	}
	return hits, nil
}
