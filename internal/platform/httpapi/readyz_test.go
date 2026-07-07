package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadyz(t *testing.T) {
	t.Run("без проверок отвечает 200", func(t *testing.T) {
		router := NewRouter(testLogger(), nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
		if rec.Code != http.StatusOK {
			t.Errorf("GET /readyz status = %d, want %d", rec.Code, http.StatusOK)
		}
	})

	t.Run("проваленная проверка даёт 503 с именем зависимости", func(t *testing.T) {
		checks := []ReadinessCheck{
			{Name: "postgres", Check: func(context.Context) error { return errors.New("connection refused") }},
			{Name: "always-ok", Check: func(context.Context) error { return nil }},
		}
		router := NewRouter(testLogger(), checks)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))

		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
		}
		if body := rec.Body.String(); !strings.Contains(body, "postgres") {
			t.Errorf("в теле нет имени проваленной проверки: %s", body)
		}
	})
}

func TestRequestID(t *testing.T) {
	router := NewRouter(testLogger(), nil)

	t.Run("генерируется, если клиент не прислал", func(t *testing.T) {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
		if id := rec.Header().Get("X-Request-Id"); id == "" {
			t.Error("ответ без X-Request-Id")
		}
	})

	t.Run("присланный клиентом возвращается как есть", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		req.Header.Set("X-Request-Id", "client-id-42")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if id := rec.Header().Get("X-Request-Id"); id != "client-id-42" {
			t.Errorf("X-Request-Id = %q, want %q", id, "client-id-42")
		}
	})

	t.Run("слишком длинный идентификатор заменяется", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		req.Header.Set("X-Request-Id", strings.Repeat("x", 100))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if id := rec.Header().Get("X-Request-Id"); len(id) > 64 || id == "" {
			t.Errorf("недопустимый X-Request-Id в ответе: %q", id)
		}
	})
}
