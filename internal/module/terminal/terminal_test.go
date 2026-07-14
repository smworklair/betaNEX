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
	}
	return d, &notified
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
