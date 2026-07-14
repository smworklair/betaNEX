// Package terminal — консоль администратора («Администратор · альфа»):
// AI-native вход во всю функциональность системы через команды.
//
// Терминал — не отдельный чат и не обход архитектуры: чтения идут через
// те же репозитории, что и обычные экраны, мутации — только через шину
// команд (авторизация + аудит + транзакция), то есть терминал — ещё один
// actor поверх того же командного позвоночника. Модуль не импортирует
// соседние модули: всё, что ему нужно, приходит адаптерами из composition
// root (cmd/nexd) — направление зависимостей сохраняется.
package terminal

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/kernel/identity"
)

// PermExec — право пользоваться терминалом. Выдаётся только admin:
// консоль открывает всю систему разом, поэтому и право отдельное, а не
// сумма прав модулей.
const PermExec = "terminal:exec"

// CmdNotify — имя команды рассылки уведомления из терминала.
const CmdNotify = "terminal.notify"

// ErrUnknown — неизвестная команда (фронт показывает подсказку help).
var ErrUnknown = errors.New("terminal: unknown command")

// --- Структурированный результат ------------------------------------------------

// KPI — один показатель в ответе kind=kpi.
type KPI struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// Result — структурированный ответ команды. Терминал отдаёт не текст,
// а данные: фронт сам решает, как их нарисовать (таблица, KPI, текст).
type Result struct {
	Kind    string     `json:"kind"` // text | table | kpi
	Title   string     `json:"title,omitempty"`
	Text    string     `json:"text,omitempty"`
	Columns []string   `json:"columns,omitempty"`
	Rows    [][]string `json:"rows,omitempty"`
	KPIs    []KPI      `json:"kpis,omitempty"`
	Hint    string     `json:"hint,omitempty"` // подсказка следующего шага
}

// --- Строки данных от адаптеров ---------------------------------------------------

// TaskRow — задача в терминальном представлении.
type TaskRow struct {
	ID     string
	Title  string
	Status string
	DueOn  string
}

// UserRow — пользователь в терминальном представлении.
type UserRow struct {
	ID    string
	Email string
	Name  string
	Roles []string
}

// AuditRow — запись журнала аудита в терминальном представлении.
type AuditRow struct {
	Command    string
	Outcome    string
	ActorID    string
	OccurredAt time.Time
}

// Deps — всё, что терминалу нужно от остальной системы. Поля-функции
// вместо интерфейсов на чужие типы: модуль не знает соседей, адаптеры
// собирает composition root. Любое nil-поле честно отключает команду.
type Deps struct {
	Tasks    func(ctx context.Context, status string, limit int) ([]TaskRow, error)
	AddTask  func(ctx context.Context, title string) error            // через шину
	DoneTask func(ctx context.Context, id string) error               // через шину
	Users    func(ctx context.Context, limit int) ([]UserRow, error)  //
	Notify   func(ctx context.Context, userIDs []string, title string) error // через шину
	Audit    func(ctx context.Context, limit int) ([]AuditRow, error) //
	Unread   func(ctx context.Context, userID string) (int64, error)  //
}

// --- Команда рассылки --------------------------------------------------------------

// Notify — команда «отправить уведомление пользователям». Идёт через шину:
// авторизация, аудит и транзакция — как у любого другого изменения.
type Notify struct {
	UserIDs []string
	Title   string
}

// Name возвращает стабильное имя команды для аудита.
func (Notify) Name() string { return CmdNotify }

// Permission возвращает право, требуемое для исполнения.
func (Notify) Permission() string { return PermExec }

// Validate проверяет инварианты входа.
func (c Notify) Validate() error {
	if len(c.UserIDs) == 0 {
		return errors.New("terminal: notify: нет получателей")
	}
	if strings.TrimSpace(c.Title) == "" {
		return errors.New("terminal: notify: пустой текст")
	}
	return nil
}

// Sender — то, что команде Notify нужно от сервиса уведомлений.
type Sender interface {
	Notify(ctx context.Context, userIDs []string, kind, title, body, refType, refID string) error
}

// RegisterCommands подключает команды терминала к шине.
func RegisterCommands(bus interface {
	Register(name string, h command.HandlerFunc) error
}, sender Sender,
) error {
	return bus.Register(CmdNotify, func(ctx context.Context, cmd command.Command) error {
		c, ok := cmd.(Notify)
		if !ok {
			return fmt.Errorf("terminal: %s: unexpected command type %T", CmdNotify, cmd)
		}
		return sender.Notify(ctx, c.UserIDs, "terminal.message", c.Title, "", "", "")
	})
}

// --- Исполнитель -------------------------------------------------------------------

// Exec разбирает строку терминала и выполняет команду. Неизвестная
// команда возвращает ErrUnknown — фронт предлагает help; свободный текст
// туда не попадает: его фронт отправляет в LLM-ветку до вызова exec.
func (d Deps) Exec(ctx context.Context, line string) (Result, error) {
	args := strings.Fields(strings.TrimSpace(line))
	if len(args) == 0 {
		return Result{}, ErrUnknown
	}
	switch args[0] {
	case "help":
		return d.help(), nil
	case "whoami":
		return d.whoami(ctx), nil
	case "status":
		return d.status(ctx)
	case "tasks":
		status := "open"
		if len(args) > 1 {
			status = args[1]
		}
		return d.tasks(ctx, status)
	case "task":
		if len(args) >= 3 && args[1] == "add" {
			return d.addTask(ctx, strings.Join(args[2:], " "))
		}
		if len(args) == 3 && args[1] == "done" {
			return d.doneTask(ctx, args[2])
		}
		return Result{}, ErrUnknown
	case "users":
		return d.users(ctx)
	case "notify":
		if len(args) < 3 {
			return Result{}, ErrUnknown
		}
		return d.notify(ctx, args[1], strings.Join(args[2:], " "))
	case "audit":
		limit := 10
		if len(args) > 1 {
			if n, err := strconv.Atoi(args[1]); err == nil && n > 0 && n <= 100 {
				limit = n
			}
		}
		return d.audit(ctx, limit)
	default:
		return Result{}, ErrUnknown
	}
}

func (d Deps) help() Result {
	return Result{
		Kind:  "table",
		Title: "Команды терминала",
		Columns: []string{"Команда", "Что делает"},
		Rows: [][]string{
			{"status", "сводка системы: задачи, люди, уведомления"},
			{"tasks [open|done|all]", "список задач"},
			{"task add <текст>", "создать задачу"},
			{"task done <id>", "закрыть задачу"},
			{"users", "пользователи организации"},
			{"notify <email|all> <текст>", "уведомить (через шину команд, с аудитом)"},
			{"audit [n]", "последние записи журнала аудита"},
			{"whoami", "кто я и мои роли"},
		},
		Hint: "свободный вопрос — тоже сюда: его разберёт ИИ",
	}
}

func (d Deps) whoami(ctx context.Context) Result {
	actor, ok := identity.ActorFrom(ctx)
	if !ok {
		return Result{Kind: "text", Text: "аноним (нет сессии)"}
	}
	return Result{Kind: "text", Text: fmt.Sprintf("%s · роли: %s", actor.ID, strings.Join(actor.Roles, ", "))}
}

// status собирает сводку из всех подключённых источников; отключённые
// адаптеры просто пропускаются — терминал живёт и с частичной сборкой.
func (d Deps) status(ctx context.Context) (Result, error) {
	var kpis []KPI
	if d.Tasks != nil {
		rows, err := d.Tasks(ctx, "open", 200)
		if err != nil {
			return Result{}, err
		}
		kpis = append(kpis, KPI{Label: "Открытых задач", Value: strconv.Itoa(len(rows))})
	}
	if d.Users != nil {
		rows, err := d.Users(ctx, 1000)
		if err != nil {
			return Result{}, err
		}
		kpis = append(kpis, KPI{Label: "Пользователей", Value: strconv.Itoa(len(rows))})
	}
	if d.Unread != nil {
		if actor, ok := identity.ActorFrom(ctx); ok {
			n, err := d.Unread(ctx, actor.ID)
			if err != nil {
				return Result{}, err
			}
			kpis = append(kpis, KPI{Label: "Непрочитанных у вас", Value: strconv.FormatInt(n, 10)})
		}
	}
	if len(kpis) == 0 {
		return Result{Kind: "text", Text: "источники данных не подключены"}, nil
	}
	return Result{Kind: "kpi", Title: "Система", KPIs: kpis, Hint: "подробнее: tasks · users · audit"}, nil
}

func (d Deps) tasks(ctx context.Context, status string) (Result, error) {
	if d.Tasks == nil {
		return Result{Kind: "text", Text: "модуль задач не подключён"}, nil
	}
	if status == "all" {
		status = ""
	}
	if status != "" && status != "open" && status != "done" {
		return Result{}, ErrUnknown
	}
	rows, err := d.Tasks(ctx, status, 20)
	if err != nil {
		return Result{}, err
	}
	out := Result{Kind: "table", Title: "Задачи", Columns: []string{"ID", "Задача", "Статус", "Срок"}}
	for _, t := range rows {
		out.Rows = append(out.Rows, []string{shortID(t.ID), t.Title, t.Status, t.DueOn})
	}
	if len(out.Rows) == 0 {
		return Result{Kind: "text", Text: "задач нет", Hint: "task add <текст> — создать"}, nil
	}
	out.Hint = "task done <id> — закрыть · task add <текст> — создать"
	return out, nil
}

func (d Deps) addTask(ctx context.Context, title string) (Result, error) {
	if d.AddTask == nil {
		return Result{Kind: "text", Text: "модуль задач не подключён"}, nil
	}
	if err := d.AddTask(ctx, title); err != nil {
		return Result{}, err
	}
	return Result{Kind: "text", Text: "задача создана: " + title, Hint: "tasks — посмотреть список"}, nil
}

func (d Deps) doneTask(ctx context.Context, id string) (Result, error) {
	if d.DoneTask == nil {
		return Result{Kind: "text", Text: "модуль задач не подключён"}, nil
	}
	if err := d.DoneTask(ctx, id); err != nil {
		return Result{}, err
	}
	return Result{Kind: "text", Text: "задача закрыта: " + id}, nil
}

func (d Deps) users(ctx context.Context) (Result, error) {
	if d.Users == nil {
		return Result{Kind: "text", Text: "справочник пользователей не подключён"}, nil
	}
	rows, err := d.Users(ctx, 50)
	if err != nil {
		return Result{}, err
	}
	out := Result{Kind: "table", Title: "Пользователи", Columns: []string{"Email", "Имя", "Роли"}}
	for _, u := range rows {
		out.Rows = append(out.Rows, []string{u.Email, u.Name, strings.Join(u.Roles, ", ")})
	}
	out.Hint = "notify <email> <текст> — уведомить"
	return out, nil
}

// notify резолвит получателя (email или all) в id пользователей и
// отправляет команду в шину — авторизация и аудит там.
func (d Deps) notify(ctx context.Context, to, text string) (Result, error) {
	if d.Notify == nil || d.Users == nil {
		return Result{Kind: "text", Text: "уведомления не подключены"}, nil
	}
	users, err := d.Users(ctx, 1000)
	if err != nil {
		return Result{}, err
	}
	var ids []string
	for _, u := range users {
		if to == "all" || strings.EqualFold(u.Email, to) {
			ids = append(ids, u.ID)
		}
	}
	if len(ids) == 0 {
		return Result{Kind: "text", Text: "получатель не найден: " + to, Hint: "users — список адресов"}, nil
	}
	if err := d.Notify(ctx, ids, text); err != nil {
		return Result{}, err
	}
	return Result{Kind: "text", Text: fmt.Sprintf("уведомление ушло %d получателям · записано в аудит", len(ids))}, nil
}

func (d Deps) audit(ctx context.Context, limit int) (Result, error) {
	if d.Audit == nil {
		return Result{Kind: "text", Text: "журнал аудита не подключён"}, nil
	}
	rows, err := d.Audit(ctx, limit)
	if err != nil {
		return Result{}, err
	}
	out := Result{Kind: "table", Title: "Журнал аудита", Columns: []string{"Когда", "Команда", "Исход", "Актор"}}
	for _, e := range rows {
		out.Rows = append(out.Rows, []string{
			e.OccurredAt.Format("02.01 15:04:05"), e.Command, e.Outcome, shortID(e.ActorID),
		})
	}
	return out, nil
}

// shortID сокращает uuid до читаемого в консоли хвоста.
func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}
