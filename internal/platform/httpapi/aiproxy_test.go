package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/smworklair/betakis/internal/kernel/identity"
	"github.com/smworklair/betakis/internal/kernel/tenancy"
)

// discardLogger — логгер для тестов: ничего не печатает, но проверяет
// сигнатуру вызовов внутри aiproxy.go.
func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func withActorAndTenant(r *http.Request, tenant string) *http.Request {
	ctx := identity.WithActor(r.Context(), identity.Actor{ID: "u1", Roles: []string{"staff"}})
	ctx = tenancy.WithTenant(ctx, tenant)
	return r.WithContext(ctx)
}

func TestMountAIGateway_EmptyURLMountsNothing(t *testing.T) {
	mount := MountAIGateway(AIGatewayConfig{}, discardLogger())
	mux := http.NewServeMux()
	mount(mux)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/ask", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (маршрут не должен монтироваться при пустом URL)", rec.Code)
	}
}

func TestMountAIGateway_ForwardsTenantAndSecret(t *testing.T) {
	var gotTenant, gotSecret, gotPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotTenant = r.Header.Get("X-Tenant-Id")
		gotSecret = r.Header.Get(gatewaySecretHeader)
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":"ok"}`))
	}))
	defer upstream.Close()

	mount := MountAIGateway(AIGatewayConfig{URL: upstream.URL, Secret: "s3cr3t"}, discardLogger())
	mux := http.NewServeMux()
	mount(mux)

	req := withActorAndTenant(httptest.NewRequest(http.MethodPost, "/api/v1/ai/ask", nil), "tenant-42")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}
	if gotTenant != "tenant-42" {
		t.Errorf("X-Tenant-Id пришёл в ai-gateway как %q, want %q", gotTenant, "tenant-42")
	}
	if gotSecret != "s3cr3t" {
		t.Errorf("%s пришёл как %q, want %q", gatewaySecretHeader, gotSecret, "s3cr3t")
	}
	if gotPath != "/api/v1/ai/ask" {
		t.Errorf("путь = %q, want /api/v1/ai/ask", gotPath)
	}
}

func TestMountAIGateway_ForwardsRequestID(t *testing.T) {
	var gotRequestID string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotRequestID = r.Header.Get(requestIDHeader)
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	mount := MountAIGateway(AIGatewayConfig{URL: upstream.URL}, discardLogger())
	mux := http.NewServeMux()
	mount(mux)

	req := withActorAndTenant(httptest.NewRequest(http.MethodPost, "/api/v1/ai/ask", nil), "t1")
	ctx := context.WithValue(req.Context(), requestIDKey{}, "req-abc123")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if gotRequestID != "req-abc123" {
		t.Errorf("%s пришёл в ai-gateway как %q, want %q", requestIDHeader, gotRequestID, "req-abc123")
	}
}

func TestMountAIGateway_HealthzPathRewritten(t *testing.T) {
	var gotPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	mount := MountAIGateway(AIGatewayConfig{URL: upstream.URL}, discardLogger())
	mux := http.NewServeMux()
	mount(mux)

	req := withActorAndTenant(httptest.NewRequest(http.MethodGet, "/api/v1/ai/healthz", nil), "t1")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if gotPath != "/healthz" {
		t.Errorf("upstream получил путь %q, want /healthz (у ai-gateway он без префикса)", gotPath)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestMountAIGateway_NoSecretHeaderWhenNotConfigured(t *testing.T) {
	var sawHeader bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, sawHeader = r.Header[gatewaySecretHeader]
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	mount := MountAIGateway(AIGatewayConfig{URL: upstream.URL}, discardLogger())
	mux := http.NewServeMux()
	mount(mux)

	req := withActorAndTenant(httptest.NewRequest(http.MethodGet, "/api/v1/ai/providers", nil), "t1")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if sawHeader {
		t.Error("X-Gateway-Secret отправлен, хотя Secret не сконфигурирован")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestMountAIGateway_RequiresAuthenticatedActor(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("upstream не должен был получить запрос без аутентифицированного актора")
	}))
	defer upstream.Close()

	mount := MountAIGateway(AIGatewayConfig{URL: upstream.URL}, discardLogger())
	mux := http.NewServeMux()
	mount(mux)

	// Ни актора, ни tenant'а в контексте — как если бы прокси вызвали
	// без сессии (например, атакующий, минуя фронтенд).
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/ask", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestMountAIGateway_RequiresTenant(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("upstream не должен был получить запрос без tenant'а")
	}))
	defer upstream.Close()

	mount := MountAIGateway(AIGatewayConfig{URL: upstream.URL}, discardLogger())
	mux := http.NewServeMux()
	mount(mux)

	ctx := identity.WithActor(context.Background(), identity.Actor{ID: "u1"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/ask", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
