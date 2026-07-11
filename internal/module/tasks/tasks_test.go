package tasks

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/smworklair/betakis/internal/platform/postgres"
	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

func TestCreateValidate(t *testing.T) {
	tests := []struct {
		name    string
		cmd     Create
		wantErr bool
	}{
		{"пустой заголовок", Create{}, true},
		{"слишком длинный заголовок", Create{Title: strings.Repeat("я", 501)}, true},
		{"граница длины (500)", Create{Title: strings.Repeat("я", 500)}, false},
		{"минимальная валидная", Create{Title: "Подготовить приказ"}, false},
		{"с датой и исполнителем", Create{Title: "Проверить документы", DueOn: time.Now(), Assignee: "user-1"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.cmd.Validate(); (err != nil) != tt.wantErr {
				t.Errorf("Validate() = %v, ожидалась ошибка: %v", err, tt.wantErr)
			}
		})
	}
}

func TestCompleteDeleteValidate(t *testing.T) {
	if err := (Complete{}).Validate(); err == nil {
		t.Error("Complete без ID должна не проходить валидацию")
	}
	if err := (Complete{ID: "task-1"}).Validate(); err != nil {
		t.Errorf("Complete с ID: неожиданная ошибка %v", err)
	}
	if err := (Delete{}).Validate(); err == nil {
		t.Error("Delete без ID должна не проходить валидацию")
	}
	if err := (Delete{ID: "task-1"}).Validate(); err != nil {
		t.Errorf("Delete с ID: неожиданная ошибка %v", err)
	}
}

// Имена команд — часть контракта аудита: смена имени ломает историю журнала.
func TestCommandContract(t *testing.T) {
	if got := (Create{}).Name(); got != "tasks.create" {
		t.Errorf("Create.Name() = %q", got)
	}
	if got := (Complete{}).Name(); got != "tasks.complete" {
		t.Errorf("Complete.Name() = %q", got)
	}
	if got := (Delete{}).Name(); got != "tasks.delete" {
		t.Errorf("Delete.Name() = %q", got)
	}
	for _, perm := range []string{
		(Create{}).Permission(), (Complete{}).Permission(), (Delete{}).Permission(),
	} {
		if perm != PermWrite {
			t.Errorf("Permission() = %q, ожидалось %q", perm, PermWrite)
		}
	}
}

func TestMapErr(t *testing.T) {
	if got := mapErr(nil); got != nil {
		t.Errorf("mapErr(nil) = %v", got)
	}
	if got := mapErr(fmt.Errorf("обёртка: %w", postgres.ErrNoTenant)); !errors.Is(got, ErrNoTenant) {
		t.Errorf("mapErr(ErrNoTenant) = %v, ожидался ErrNoTenant", got)
	}
	if got := mapErr(fmt.Errorf("обёртка: %w", postgres.ErrInvalidTenant)); !errors.Is(got, ErrNoTenant) {
		t.Errorf("mapErr(ErrInvalidTenant) = %v, ожидался ErrNoTenant", got)
	}
	sentinel := errors.New("что-то ещё")
	if got := mapErr(sentinel); !errors.Is(got, sentinel) {
		t.Errorf("mapErr(прочее) = %v, ожидался исходный %v", got, sentinel)
	}
}

func TestTaskFromRow(t *testing.T) {
	var id pgtype.UUID
	if err := id.Scan("0198344c-0000-7000-8000-000000000001"); err != nil {
		t.Fatal(err)
	}
	created := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	due := time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC)
	done := time.Date(2026, 7, 10, 9, 30, 0, 0, time.UTC)

	row := db.Task{
		ID: id, Title: "Заголовок", Note: "Заметка", Status: "done",
		Assignee: "user-1", CreatedBy: "admin-1",
		CreatedAt: pgtype.Timestamptz{Time: created, Valid: true},
		DueOn:     pgtype.Date{Time: due, Valid: true},
		DoneAt:    pgtype.Timestamptz{Time: done, Valid: true},
	}
	got := taskFromRow(row)
	if got.ID != "0198344c-0000-7000-8000-000000000001" ||
		got.Title != "Заголовок" || got.Note != "Заметка" || got.Status != "done" ||
		got.Assignee != "user-1" || got.CreatedBy != "admin-1" ||
		!got.CreatedAt.Equal(created) || !got.DueOn.Equal(due) || !got.DoneAt.Equal(done) {
		t.Errorf("taskFromRow: неожиданный результат %+v", got)
	}

	// NULL-поля даты не должны попадать в доменную модель.
	row.DueOn = pgtype.Date{}
	row.DoneAt = pgtype.Timestamptz{}
	got = taskFromRow(row)
	if !got.DueOn.IsZero() || !got.DoneAt.IsZero() {
		t.Errorf("taskFromRow: NULL-даты должны давать нулевое время, получено due=%v done=%v", got.DueOn, got.DoneAt)
	}
}
