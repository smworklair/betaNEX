package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

// testLogger returns a logger that discards output, so tests exercise the
// middleware chain without producing noise.
func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestRouterHealthzMethodRouting(t *testing.T) {
	router := NewRouter(testLogger(), RouterConfig{})

	t.Run("GET is allowed", func(t *testing.T) {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
		if rec.Code != http.StatusOK {
			t.Errorf("GET /healthz status = %d, want %d", rec.Code, http.StatusOK)
		}
	})

	t.Run("POST is rejected", func(t *testing.T) {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/healthz", nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("POST /healthz status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
		}
	})

	t.Run("unknown path is 404", func(t *testing.T) {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/does-not-exist", nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET /does-not-exist status = %d, want %d", rec.Code, http.StatusNotFound)
		}
	})
}

// TestRecovererCatchesPanic verifies the recoverer middleware converts a panic
// in a handler into a 500 response instead of crashing the server.
func TestRecovererCatchesPanic(t *testing.T) {
	panicking := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	})
	handler := chain(panicking, requestLogger(testLogger()), recoverer(testLogger()))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

// CSRF-страж активен в обычном (production) роутере и выключен в
// development (DevAuth): там Vite-прокси шлёт Origin дев-сервера.
func TestRouterCSRFModes(t *testing.T) {
	foreignPost := func(router http.Handler) int {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/openapi.yaml", nil)
		req.Host = "api.example.com"
		req.Header.Set("Origin", "https://evil.example.com")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec.Code
	}

	prod := NewRouter(testLogger(), RouterConfig{})
	if code := foreignPost(prod); code != http.StatusForbidden {
		t.Errorf("production: POST с чужим Origin = %d, want 403", code)
	}

	dev := NewRouter(testLogger(), RouterConfig{DevAuth: true})
	if code := foreignPost(dev); code == http.StatusForbidden {
		t.Error("development: CSRF-страж не должен резать запросы Vite-прокси")
	}
}

// Спека OpenAPI раздаётся без аутентификации.
func TestRouterServesOpenAPI(t *testing.T) {
	router := NewRouter(testLogger(), RouterConfig{OpenAPI: []byte("openapi: 3.1.0\n")})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/openapi.yaml", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Body.String(); got != "openapi: 3.1.0\n" {
		t.Errorf("body = %q", got)
	}
}
