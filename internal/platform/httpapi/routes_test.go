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
