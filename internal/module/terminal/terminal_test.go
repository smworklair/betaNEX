package terminal

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/smworklair/betakis/internal/kernel/identity"
)

// deps собирает стенд с работающими адаптерами поверх памяти.
func deps(t *testing.T) (Deps, *[]string) {
	t.Helper()
	notified := []string{}
	d := Deps{
		Tasks: func(_ context.Context, status string, _ int) ([]TaskRow, error) {
			all := []TaskRow{
				{ID: "11111111-aaaa", Title: "Подписать приказ", Status: "open"},
				{ID: "22222222-bbbb", Title: "Сдать отчёт", Status: "done"},
			}
			if status == "" {
				return all, nil
			}
			var out []TaskRow
			for _, r := range all {
				if r.Status == status {
					out = append(out, r)
				}
			}
			return out, nil
		},
		AddTask:  func(_ context.Context, title string) error { return nil },
		DoneTask: func(_ context.Context, id string) error { return nil },
		Users: func(_ context.Context, _ int) ([]UserRow, error) {
			return []UserRow{
				{ID: "u1", Email: "admin@nex.ru", Name: "Админ", Roles: []string{"admin"}},
				{ID: "u2", Email: "t@nex.ru", Name: "Препод", Roles: []string{"teacher"}},
			}, nil
		},
		Notify: func(_ context.Context, ids []string, _ string) error {
			notified = append(notified, ids...)
			return nil
		},
		Audit: func(_ context.Context, limit int) ([]AuditRow, error) {
			return []AuditRow{{Command: "tasks.create", Outcome: "ok", ActorID: "u1", OccurredAt: time.Now()}}, nil
		},
		Unread: func(_ context.Context, _ string) (int64, error) { return 3, nil },
		Groups: func(_ context.Context) ([]GroupRow, error) {
			return []GroupRow{{Code: "ПИ-21-1", Name: "Прикладная информатика", Students: 12}}, nil
		},
		Students: func(_ context.Context, query string, _ int) ([]StudentRow, error) {
			all := []StudentRow{
				{Name: "Иванов Алексей", Group: "ПИ-21-1", Status: "active", Email: "ivanov@stud.ru"},
				{Name: "Петрова Мария", Group: "ПИ-21-1", Status: "active", Email: "petrova@stud.ru"},
			}
			if query == "" {
				return all, nil
			}
			var out []StudentRow
			for _, s := range all {
				if strings.Contains(strings.ToLower(s.Name), strings.ToLower(query)) {
					out = append(out, s)
				}
			}
			return out, nil
		},
		Grades: func(_ context.Context, _ int) ([]GradeRow, error) {
			return []GradeRow{
				{Student: "Иванов Алексей", Group: "ПИ-21-1", Subject: "Базы данных", Grade: 5, On: time.Now()},
				{Student: "Петрова Мария", Group: "ПИ-21-1", Subject: "Базы данных", Grade: 4, On: time.Now()},
			}, nil
		},
		Balances: func(_ context.Context) ([]BalanceRow, error) {
			return []BalanceRow{
				{Code: "50", Name: "Касса", Type: "asset", Amount: 1_250_00},
				{Code: "90", Name: "Выручка", Type: "income", Amount: 62_000_00},
			}, nil
		},
		Entries: func(_ context.Context, _ int) ([]EntryRow, error) {
			return []EntryRow{{Memo: "оплата обучения, июнь", PostedBy: "u1", PostedAt: time.Now(), Amount: 62_000_00}}, nil
		},
	}
	return d, &notified
}

func TestExecRussianAliases(t *testing.T) {
	d, _ := deps(t)
	for _, line := range []string{"обзор", "задачи", "люди", "аудит"} {
		if _, err := d.Exec(identity.WithActor(context.Background(), identity.Actor{ID: "u1"}), line); err != nil {
			t.Fatalf("%q: %v", line, err)
		}
	}
	res, err := d.Exec(context.Background(), "новая задача Проверить отчёт")
	if err != nil || !strings.Contains(res.Text, "Проверить отчёт") {
		t.Fatalf("новая задача: res=%+v err=%v", res, err)
	}
}

func TestExecAnalyticsDomain(t *testing.T) {
	d, _ := deps(t)
	res, err := d.Exec(context.Background(), "аналитика")
	if err != nil || res.Kind != "kpi" || len(res.KPIs) != 3 {
		t.Fatalf("аналитика: res=%+v err=%v", res, err)
	}
	if res.KPIs[2].Value != "4.5" {
		t.Fatalf("средний балл = %s, want 4.5", res.KPIs[2].Value)
	}
	res, err = d.Exec(context.Background(), "студенты иванов")
	if err != nil || len(res.Rows) != 1 || res.Rows[0][0] != "Иванов Алексей" {
		t.Fatalf("студенты иванов: res=%+v err=%v", res, err)
	}
	if res, _ = d.Exec(context.Background(), "группы"); len(res.Rows) != 1 {
		t.Fatalf("группы: %+v", res)
	}
}

func TestExecFinanceDomain(t *testing.T) {
	d, _ := deps(t)
	res, err := d.Exec(context.Background(), "финансы")
	if err != nil || res.Kind != "kpi" {
		t.Fatalf("финансы: res=%+v err=%v", res, err)
	}
	if res.KPIs[1].Value != "1250.00 ₽" { // активы из кассы
		t.Fatalf("активы = %s", res.KPIs[1].Value)
	}
	res, _ = d.Exec(context.Background(), "счета")
	if len(res.Rows) != 2 || res.Rows[1][3] != "62000.00 ₽" {
		t.Fatalf("счета: %+v", res.Rows)
	}
	res, _ = d.Exec(context.Background(), "проводки")
	if len(res.Rows) != 1 || res.Rows[0][1] != "оплата обучения, июнь" {
		t.Fatalf("проводки: %+v", res.Rows)
	}
}

func TestExecSecurityDomain(t *testing.T) {
	d, _ := deps(t)
	res, err := d.Exec(context.Background(), "безопасность")
	if err != nil || res.Kind != "kpi" || len(res.KPIs) != 3 {
		t.Fatalf("безопасность: res=%+v err=%v", res, err)
	}
	if res.KPIs[1].Value != "1" { // один admin в стенде
		t.Fatalf("администраторов = %s, want 1", res.KPIs[1].Value)
	}
}

func TestExecHelp(t *testing.T) {
	d, _ := deps(t)
	res, err := d.Exec(context.Background(), "help")
	if err != nil {
		t.Fatalf("help: %v", err)
	}
	if res.Kind != "table" || len(res.Rows) == 0 {
		t.Fatalf("help: want table with rows, got %+v", res)
	}
}

func TestExecStatusCollectsKPIs(t *testing.T) {
	d, _ := deps(t)
	ctx := identity.WithActor(context.Background(), identity.Actor{ID: "u1", Roles: []string{"admin"}})
	res, err := d.Exec(ctx, "status")
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if res.Kind != "kpi" || len(res.KPIs) != 3 {
		t.Fatalf("status: want 3 kpis, got %+v", res)
	}
	if res.KPIs[0].Value != "1" { // одна открытая задача
		t.Fatalf("status: open tasks = %s, want 1", res.KPIs[0].Value)
	}
}

func TestExecTasksFiltersByStatus(t *testing.T) {
	d, _ := deps(t)
	res, err := d.Exec(context.Background(), "tasks done")
	if err != nil {
		t.Fatalf("tasks done: %v", err)
	}
	if len(res.Rows) != 1 || res.Rows[0][1] != "Сдать отчёт" {
		t.Fatalf("tasks done: got %+v", res.Rows)
	}
	if _, err := d.Exec(context.Background(), "tasks bogus"); !errors.Is(err, ErrUnknown) {
		t.Fatalf("tasks bogus: want ErrUnknown, got %v", err)
	}
}

func TestExecNotifyResolvesRecipients(t *testing.T) {
	d, notified := deps(t)
	res, err := d.Exec(context.Background(), "notify admin@nex.ru проверьте отчёт")
	if err != nil {
		t.Fatalf("notify: %v", err)
	}
	if len(*notified) != 1 || (*notified)[0] != "u1" {
		t.Fatalf("notify: notified %v, want [u1]", *notified)
	}
	if !strings.Contains(res.Text, "1 получателям") {
		t.Fatalf("notify: text %q", res.Text)
	}

	*notified = nil
	if _, err := d.Exec(context.Background(), "notify all собрание в 14:00"); err != nil {
		t.Fatalf("notify all: %v", err)
	}
	if len(*notified) != 2 {
		t.Fatalf("notify all: notified %v, want both users", *notified)
	}

	res, err = d.Exec(context.Background(), "notify nobody@nex.ru привет")
	if err != nil || !strings.Contains(res.Text, "не найден") {
		t.Fatalf("notify missing: res=%+v err=%v", res, err)
	}
}

func TestExecUnknownCommand(t *testing.T) {
	d, _ := deps(t)
	if _, err := d.Exec(context.Background(), "self-destruct now"); !errors.Is(err, ErrUnknown) {
		t.Fatalf("want ErrUnknown, got %v", err)
	}
	if _, err := d.Exec(context.Background(), "   "); !errors.Is(err, ErrUnknown) {
		t.Fatalf("empty line: want ErrUnknown, got %v", err)
	}
}

func TestExecNilDepsDegradeGracefully(t *testing.T) {
	var d Deps // всё отключено
	res, err := d.Exec(context.Background(), "tasks")
	if err != nil || res.Kind != "text" {
		t.Fatalf("nil deps tasks: res=%+v err=%v", res, err)
	}
	res, err = d.Exec(identity.WithActor(context.Background(), identity.Actor{ID: "u1"}), "status")
	if err != nil || !strings.Contains(res.Text, "не подключены") {
		t.Fatalf("nil deps status: res=%+v err=%v", res, err)
	}
}

func TestNotifyCommandValidate(t *testing.T) {
	if err := (Notify{}).Validate(); err == nil {
		t.Fatal("empty Notify must not validate")
	}
	if err := (Notify{UserIDs: []string{"u1"}, Title: "  "}).Validate(); err == nil {
		t.Fatal("blank title must not validate")
	}
	if err := (Notify{UserIDs: []string{"u1"}, Title: "ок"}).Validate(); err != nil {
		t.Fatalf("valid Notify: %v", err)
	}
	if (Notify{}).Name() != CmdNotify || (Notify{}).Permission() != PermExec {
		t.Fatal("Notify metadata mismatch")
	}
}
