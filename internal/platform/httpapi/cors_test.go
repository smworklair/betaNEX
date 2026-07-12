package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func TestCORS(t *testing.T) {
	cfg := CORSConfig{AllowedOrigins: []string{"https://app.example.com"}}
	h := cors(cfg)(okHandler())

	t.Run("preflight разрешённого origin", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodOptions, "/api/v1/tasks", nil)
		req.Header.Set("Origin", "https://app.example.com")
		req.Header.Set("Access-Control-Request-Method", "POST")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		if rec.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204", rec.Code)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
			t.Errorf("Allow-Origin = %q", got)
		}
		if rec.Header().Get("Access-Control-Allow-Credentials") != "true" {
			t.Error("нет Allow-Credentials: cookie-сессии не заработают")
		}
		if !strings.Contains(rec.Header().Get("Access-Control-Allow-Headers"), "Idempotency-Key") {
			t.Error("Idempotency-Key не разрешён в preflight")
		}
	})

	t.Run("обычный запрос разрешённого origin", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks", nil)
		req.Header.Set("Origin", "https://app.example.com")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
			t.Errorf("Allow-Origin = %q", got)
		}
		if !strings.Contains(rec.Header().Get("Vary"), "Origin") {
			t.Error("нет Vary: Origin — кэши перепутают ответы")
		}
	})

	t.Run("чужой origin не получает заголовков", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks", nil)
		req.Header.Set("Origin", "https://evil.example.com")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("чужой origin получил Allow-Origin = %q", got)
		}
	})

	t.Run("запрос без Origin проходит нетронутым", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("без Origin появился Allow-Origin = %q", got)
		}
	})
}

func TestCSRFGuard(t *testing.T) {
	cfg := CORSConfig{AllowedOrigins: []string{"https://app.example.com"}}
	h := csrfGuard(cfg)(okHandler())

	do := func(method, origin string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "https://api.example.com/api/v1/tasks", nil)
		req.Host = "api.example.com"
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	tests := []struct {
		name   string
		method string
		origin string
		want   int
	}{
		{"GET с чужим origin проходит (не мутация)", http.MethodGet, "https://evil.example.com", http.StatusOK},
		{"POST без Origin проходит (curl, интеграции)", http.MethodPost, "", http.StatusOK},
		{"POST same-origin проходит", http.MethodPost, "https://api.example.com", http.StatusOK},
		{"POST c разрешённого фронтенда проходит", http.MethodPost, "https://app.example.com", http.StatusOK},
		{"POST с чужого сайта — 403", http.MethodPost, "https://evil.example.com", http.StatusForbidden},
		{"DELETE с чужого сайта — 403", http.MethodDelete, "https://evil.example.com", http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if rec := do(tt.method, tt.origin); rec.Code != tt.want {
				t.Errorf("status = %d, want %d", rec.Code, tt.want)
			}
		})
	}
}
