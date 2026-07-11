package tasks

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/smworklair/betakis/internal/kernel/authz"
)

func TestToDTO(t *testing.T) {
	created := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	full := Task{
		ID: "t-1", Title: "Заголовок", Note: "Заметка", Status: "done",
		DueOn:    time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC),
		Assignee: "user-1", CreatedBy: "admin-1", CreatedAt: created,
		DoneAt: time.Date(2026, 7, 10, 9, 30, 0, 0, time.UTC),
	}
	d := toDTO(full)
	if d.DueOn != "2026-07-15" {
		t.Errorf("DueOn = %q, ожидалось 2026-07-15", d.DueOn)
	}
	if d.DoneAt != "2026-07-10T09:30:00Z" {
		t.Errorf("DoneAt = %q, ожидалось RFC3339", d.DoneAt)
	}

	// Пустые даты не сериализуются: у JSON-поля omitempty.
	d = toDTO(Task{ID: "t-2", Title: "Открытая", Status: "open", CreatedAt: created})
	if d.DueOn != "" || d.DoneAt != "" {
		t.Errorf("нулевые даты должны давать пустые строки, получено due=%q done=%q", d.DueOn, d.DoneAt)
	}
	raw, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "due_on") || strings.Contains(string(raw), "done_at") {
		t.Errorf("пустые даты не должны попадать в JSON: %s", raw)
	}
}

func TestWriteErrStatusMapping(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want int
	}{
		{"отказ авторизации", fmt.Errorf("шина: %w", authz.ErrDenied), http.StatusForbidden},
		{"нет tenant", fmt.Errorf("репозиторий: %w", ErrNoTenant), http.StatusBadRequest},
		{"не найдено", fmt.Errorf("репозиторий: %w", ErrNotFound), http.StatusNotFound},
		{"прочее", fmt.Errorf("сеть упала"), http.StatusInternalServerError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			writeErr(rec, tt.err)
			if rec.Code != tt.want {
				t.Errorf("статус = %d, ожидался %d", rec.Code, tt.want)
			}
			if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/problem+json") {
				t.Errorf("Content-Type = %q, ожидался problem+json", ct)
			}
		})
	}
}

// Ошибки валидации входа обязаны давать 400 до обращения к шине команд:
// хендлеры вызываются с nil-шиной, паника означала бы нарушение порядка.
func TestRoutesRejectBadInput(t *testing.T) {
	mux := http.NewServeMux()
	Routes(nil, nil)(mux)

	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{"битый JSON", http.MethodPost, "/api/v1/tasks", `{"title":`},
		{"неизвестное поле", http.MethodPost, "/api/v1/tasks", `{"titel":"опечатка"}`},
		{"некорректная дата", http.MethodPost, "/api/v1/tasks", `{"title":"ок","due_on":"15.07.2026"}`},
		{"пустой заголовок", http.MethodPost, "/api/v1/tasks", `{"title":""}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("статус = %d, ожидался 400; тело: %s", rec.Code, rec.Body)
			}
		})
	}
}
