package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSecurityHeaders(t *testing.T) {
	h := securityHeaders()(okHandler())

	t.Run("базовые заголовки на обычном запросе", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		want := map[string]string{
			"X-Content-Type-Options": "nosniff",
			"X-Frame-Options":        "DENY",
			"Referrer-Policy":        "strict-origin-when-cross-origin",
		}
		for name, value := range want {
			if got := rec.Header().Get(name); got != value {
				t.Errorf("%s = %q, want %q", name, got, value)
			}
		}
		if got := rec.Header().Get("Content-Security-Policy"); got == "" {
			t.Error("нет Content-Security-Policy")
		}
		if got := rec.Header().Get("Permissions-Policy"); got == "" {
			t.Error("нет Permissions-Policy")
		}
	})

	t.Run("HSTS отсутствует на обычном http (локальная разработка)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		if got := rec.Header().Get("Strict-Transport-Security"); got != "" {
			t.Errorf("HSTS выставлен на незащищённом соединении: %q", got)
		}
	})

	t.Run("HSTS появляется за X-Forwarded-Proto: https (за Caddy)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks", nil)
		req.Header.Set("X-Forwarded-Proto", "https")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		if got := rec.Header().Get("Strict-Transport-Security"); got == "" {
			t.Error("нет HSTS за X-Forwarded-Proto: https")
		}
	})
}
