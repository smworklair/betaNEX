package httpapi_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/smworklair/betakis/internal/kernel/auth"
	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/module/finance"
	"github.com/smworklair/betakis/internal/platform/httpapi"
	"github.com/smworklair/betakis/internal/platform/postgres"
)

// TestAuthFlowOverHTTP — интеграционный сценарий M3: логин выдаёт
// httpOnly-cookie, сессия открывает защищённые маршруты, logout отзывает
// её мгновенно. Гоняется против реального Postgres.
func TestAuthFlowOverHTTP(t *testing.T) {
	dsn := os.Getenv("NEX_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("NEX_TEST_DATABASE_URL не задан — пропускаю интеграционный тест")
	}
	ctx := context.Background()
	if err := postgres.Migrate(ctx, dsn); err != nil {
		t.Fatalf("миграции: %v", err)
	}
	pg, err := postgres.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("подключение: %v", err)
	}
	t.Cleanup(pg.Close)

	// Организация и администратор.
	var buf [6]byte
	if _, err := rand.Read(buf[:]); err != nil {
		t.Fatal(err)
	}
	slug := "auth-http-" + hex.EncodeToString(buf[:])
	tenantID, err := pg.EnsureTenant(ctx, slug)
	if err != nil {
		t.Fatalf("tenant: %v", err)
	}
	hash, err := auth.HashPassword("правильный-пароль")
	if err != nil {
		t.Fatal(err)
	}
	store := postgres.NewAuthStore(pg)
	_, err = store.CreateUser(tenantCtx(tenantID), auth.User{
		TenantID: tenantID, Email: "admin@college.ru", DisplayName: "Админ",
		Roles: []string{"admin"}, PasswordHash: hash,
	})
	if err != nil {
		t.Fatalf("пользователь: %v", err)
	}

	// Роутер как в продакшене: без dev-заголовков, аудит и транзакции в БД.
	policy := authz.NewPolicy()
	policy.Grant("admin", finance.PermAccountsWrite)
	policy.Grant("admin", finance.PermEntriesPost)
	recorder := postgres.NewAuditRecorder(pg, httpapi.RequestIDFrom)
	bus := command.NewMemoryBus(authz.NewPolicyAuthorizer(policy), recorder, command.WithTxRunner(pg))
	repo := finance.NewPostgresRepository(pg)
	if err := finance.RegisterCommands(bus, repo); err != nil {
		t.Fatal(err)
	}
	svc := auth.NewService(store, time.Hour)
	router := httpapi.NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), httpapi.RouterConfig{
		ResolveTenant: pg.ResolveTenant,
		Auth: &httpapi.AuthConfig{
			Service:       svc,
			TTL:           time.Hour,
			ResolveTenant: pg.ResolveTenant,
			Audit:         recorder,
		},
		Mount: []func(*http.ServeMux){finance.Routes(bus, repo, authz.NewGuard(policy))},
	})

	login := func(password string) *httptest.ResponseRecorder {
		body := `{"tenant":"` + slug + `","email":"admin@college.ru","password":"` + password + `"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}

	// Неверный пароль — 401 без cookie.
	if rec := login("не тот"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("неверный пароль: status = %d, want 401", rec.Code)
	}

	// Верный пароль — 200, httpOnly-cookie.
	rec := login("правильный-пароль")
	if rec.Code != http.StatusOK {
		t.Fatalf("логин: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	res := rec.Result()
	var cookie *http.Cookie
	for _, c := range res.Cookies() {
		if c.Name == "nex_session" {
			cookie = c
		}
	}
	if cookie == nil || cookie.Value == "" {
		t.Fatal("логин не выдал cookie nex_session")
	}
	if !cookie.HttpOnly {
		t.Error("cookie сессии не httpOnly")
	}

	withCookie := func(method, path, body string) *httptest.ResponseRecorder {
		var rdr io.Reader
		if body != "" {
			rdr = strings.NewReader(body)
		}
		req := httptest.NewRequest(method, path, rdr)
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}

	// /me видит пользователя.
	rec = withCookie(http.MethodGet, "/api/v1/auth/me", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("/me: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var me struct {
		Email string   `json:"email"`
		Roles []string `json:"roles"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &me); err != nil {
		t.Fatal(err)
	}
	if me.Email != "admin@college.ru" || len(me.Roles) != 1 || me.Roles[0] != "admin" {
		t.Errorf("/me = %+v", me)
	}

	// Сессия открывает защищённый маршрут (без dev-заголовков).
	rec = withCookie(http.MethodPost, "/api/v1/finance/accounts",
		`{"code":"50","name":"Касса","type":"asset"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("создание счёта под сессией: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	// Без cookie команда отклоняется.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/finance/accounts",
		strings.NewReader(`{"code":"51","name":"Банк","type":"asset"}`))
	anon := httptest.NewRecorder()
	router.ServeHTTP(anon, req)
	if anon.Code != http.StatusForbidden {
		t.Errorf("без сессии: status = %d, want 403", anon.Code)
	}

	// Logout отзывает сессию мгновенно.
	if rec := withCookie(http.MethodPost, "/api/v1/auth/logout", ""); rec.Code != http.StatusNoContent {
		t.Fatalf("logout: status = %d", rec.Code)
	}
	if rec := withCookie(http.MethodGet, "/api/v1/auth/me", ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("/me после logout: status = %d, want 401", rec.Code)
	}

	// Перебор паролей упирается в лимит.
	sawLimit := false
	for range 12 {
		if rec := login("подбор"); rec.Code == http.StatusTooManyRequests {
			sawLimit = true
			break
		}
	}
	if !sawLimit {
		t.Error("rate limiter не сработал после 12 неудачных попыток")
	}
}

func tenantCtx(id string) context.Context {
	return tenancy.WithTenant(context.Background(), id)
}
