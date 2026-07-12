package httpapi_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/smworklair/betakis/internal/kernel/audit"
	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/module/finance"
	"github.com/smworklair/betakis/internal/platform/httpapi"
	"github.com/smworklair/betakis/internal/platform/postgres"
)

// TestIdempotencyKey: два POST с одним Idempotency-Key создают один
// счёт; повтор возвращает сохранённый ответ с пометкой.
func TestIdempotencyKey(t *testing.T) {
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
		t.Fatal(err)
	}
	t.Cleanup(pg.Close)

	var buf [6]byte
	if _, err := rand.Read(buf[:]); err != nil {
		t.Fatal(err)
	}
	tenantID, err := pg.EnsureTenant(ctx, "idem-"+hex.EncodeToString(buf[:]))
	if err != nil {
		t.Fatal(err)
	}

	repo := finance.NewPostgresRepository(pg)
	policy := authz.NewPolicy()
	policy.Grant("admin", finance.PermAccountsWrite)
	bus := command.NewMemoryBus(authz.NewPolicyAuthorizer(policy), &audit.MemoryRecorder{}, command.WithTxRunner(pg))
	if err := finance.RegisterCommands(bus, repo); err != nil {
		t.Fatal(err)
	}
	router := httpapi.NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), httpapi.RouterConfig{
		DevAuth:     true,
		Idempotency: postgres.NewIdempotencyStore(pg),
		Mount:       []func(*http.ServeMux){finance.Routes(bus, repo, authz.NewGuard(policy))},
	})

	post := func(key string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/finance/accounts",
			strings.NewReader(`{"code":"50","name":"Касса","type":"asset"}`))
		req.Header.Set("X-Dev-Actor", "u1")
		req.Header.Set("X-Dev-Roles", "admin")
		req.Header.Set("X-Dev-Tenant", tenantID)
		req.Header.Set("Idempotency-Key", key)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}

	key := "client-op-" + hex.EncodeToString(buf[:])
	first := post(key)
	if first.Code != http.StatusCreated {
		t.Fatalf("первый запрос: status = %d, body = %s", first.Code, first.Body.String())
	}
	second := post(key)
	if second.Code != http.StatusCreated {
		t.Fatalf("повтор: status = %d, body = %s", second.Code, second.Body.String())
	}
	if second.Header().Get("Idempotency-Replayed") != "true" {
		t.Error("повтор без пометки Idempotency-Replayed")
	}

	// Счёт создан ровно один раз: без ключа второй POST даёт 409.
	third := post("другой-ключ-" + hex.EncodeToString(buf[:]))
	if third.Code != http.StatusConflict {
		t.Errorf("тот же код счёта с новым ключом: status = %d, want 409 (дубликат)", third.Code)
	}
}
