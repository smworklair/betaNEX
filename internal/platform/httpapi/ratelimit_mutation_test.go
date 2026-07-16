package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/smworklair/betakis/internal/kernel/identity"
)

func TestMutationRateLimit_GETNeverThrottled(t *testing.T) {
	limiter := newRateLimiter(1, time.Minute)
	h := mutationRateLimit(limiter)(okHandler())

	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET #%d: status = %d, want 200", i, rec.Code)
		}
	}
}

func TestMutationRateLimit_BlocksAfterBurst(t *testing.T) {
	limiter := newRateLimiter(2, time.Minute)
	h := mutationRateLimit(limiter)(okHandler())

	req := func() *http.Request { return httptest.NewRequest(http.MethodPost, "/api/v1/tasks", nil) }

	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req())
		if rec.Code != http.StatusOK {
			t.Fatalf("запрос #%d в пределах burst: status = %d, want 200", i, rec.Code)
		}
	}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req())
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 после исчерпания burst", rec.Code)
	}
}

func TestMutationRateLimit_KeyedByActorNotIP(t *testing.T) {
	limiter := newRateLimiter(1, time.Minute)
	h := mutationRateLimit(limiter)(okHandler())

	withActor := func(id string) *http.Request {
		r := httptest.NewRequest(http.MethodPost, "/api/v1/tasks", nil)
		r.RemoteAddr = "10.0.0.1:12345" // тот же IP у обоих — как за общим reverse-proxy
		ctx := identity.WithActor(r.Context(), identity.Actor{ID: id})
		return r.WithContext(ctx)
	}

	rec1 := httptest.NewRecorder()
	h.ServeHTTP(rec1, withActor("user-a"))
	if rec1.Code != http.StatusOK {
		t.Fatalf("user-a: status = %d, want 200", rec1.Code)
	}

	// Другой актор с того же IP не должен упереться в лимит user-a —
	// именно поэтому ключ актор, а не IP (см. mutationRateLimit).
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, withActor("user-b"))
	if rec2.Code != http.StatusOK {
		t.Fatalf("user-b: status = %d, want 200 (не должен делить лимит с user-a)", rec2.Code)
	}

	// А повторный запрос user-a (burst=1) уже упирается в лимит.
	rec3 := httptest.NewRecorder()
	h.ServeHTTP(rec3, withActor("user-a"))
	if rec3.Code != http.StatusTooManyRequests {
		t.Fatalf("user-a повторно: status = %d, want 429", rec3.Code)
	}
}
