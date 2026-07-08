package finance_test

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/smworklair/betakis/internal/module/finance"
	"github.com/smworklair/betakis/internal/platform/httpapi"
)

// newServer поднимает полный роутер с dev-аутентификацией и модулем
// финансов — так же, как это делает cmd/nexd в development.
func newServer(repo finance.Repository) http.Handler {
	bus := newBus(repo)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return httpapi.NewRouter(log, httpapi.RouterConfig{
		DevAuth: true,
		Mount:   []func(*http.ServeMux){finance.Routes(bus, repo)},
	})
}

// doJSON выполняет запрос с dev-заголовками бухгалтера tenant'а college-1.
func doJSON(t *testing.T, h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var rdr io.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Dev-Actor", "u1")
	req.Header.Set("X-Dev-Roles", "accountant")
	req.Header.Set("X-Dev-Tenant", "college-1")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestHTTPFinanceFlow(t *testing.T) {
	repo := finance.NewMemoryRepository()
	srv := newServer(repo)

	// 1. Создаём два счёта.
	rec := doJSON(t, srv, http.MethodPost, "/api/v1/finance/accounts",
		`{"code":"50","name":"Касса","type":"asset"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("создание счёта: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(t, srv, http.MethodPost, "/api/v1/finance/accounts",
		`{"code":"90","name":"Доход от обучения","type":"income"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("создание счёта 90: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	// 2. Узнаём ID счетов.
	rec = doJSON(t, srv, http.MethodGet, "/api/v1/finance/accounts", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("список счетов: status = %d", rec.Code)
	}
	var accounts []struct {
		ID      string `json:"id"`
		Code    string `json:"code"`
		Balance int64  `json:"balance"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &accounts); err != nil {
		t.Fatalf("разбор списка счетов: %v", err)
	}
	if len(accounts) != 2 {
		t.Fatalf("счетов = %d, want 2", len(accounts))
	}
	ids := map[string]string{}
	for _, a := range accounts {
		ids[a.Code] = a.ID
	}

	// 3. Проводим оплату обучения.
	entry := `{"memo":"оплата обучения","lines":[` +
		`{"account_id":"` + ids["50"] + `","side":"debit","amount":4500000},` +
		`{"account_id":"` + ids["90"] + `","side":"credit","amount":4500000}]}`
	rec = doJSON(t, srv, http.MethodPost, "/api/v1/finance/entries", entry)
	if rec.Code != http.StatusCreated {
		t.Fatalf("проведение: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	// 4. Сальдо обоих счетов выросло.
	rec = doJSON(t, srv, http.MethodGet, "/api/v1/finance/accounts", "")
	if err := json.Unmarshal(rec.Body.Bytes(), &accounts); err != nil {
		t.Fatalf("разбор балансов: %v", err)
	}
	for _, a := range accounts {
		if a.Balance != 4_500_000 {
			t.Errorf("сальдо счёта %s = %d, want 4500000", a.Code, a.Balance)
		}
	}

	// 5. Проводка видна в реестре.
	rec = doJSON(t, srv, http.MethodGet, "/api/v1/finance/entries", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "оплата обучения") {
		t.Errorf("реестр проводок: status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHTTPErrors(t *testing.T) {
	repo := finance.NewMemoryRepository()
	srv := newServer(repo)

	t.Run("без роли — 403", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/finance/accounts",
			strings.NewReader(`{"code":"50","name":"Касса","type":"asset"}`))
		req.Header.Set("X-Dev-Actor", "s1")
		req.Header.Set("X-Dev-Roles", "student")
		req.Header.Set("X-Dev-Tenant", "college-1")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
	})

	t.Run("кривой JSON — 400", func(t *testing.T) {
		rec := doJSON(t, srv, http.MethodPost, "/api/v1/finance/accounts", `{"code":`)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", rec.Code)
		}
	})

	t.Run("несбалансированная проводка — 400", func(t *testing.T) {
		rec := doJSON(t, srv, http.MethodPost, "/api/v1/finance/entries",
			`{"lines":[{"account_id":"x","side":"debit","amount":100},{"account_id":"y","side":"credit","amount":50}]}`)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("ошибки в формате problem+json", func(t *testing.T) {
		rec := doJSON(t, srv, http.MethodPost, "/api/v1/finance/accounts", `{"code":"","name":"","type":"asset"}`)
		if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/problem+json") {
			t.Errorf("Content-Type = %q, want problem+json", ct)
		}
	})
}
