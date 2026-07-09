package cache

import (
	"context"
	"testing"
	"time"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
)

func TestMemoryGetSetExpiry(t *testing.T) {
	c := NewMemory(10)
	now := time.Now()
	c.now = func() time.Time { return now }
	ctx := context.Background()

	c.Set(ctx, "k", []byte("v"), time.Minute)
	if v, ok := c.Get(ctx, "k"); !ok || string(v) != "v" {
		t.Fatalf("Get = %q, %v", v, ok)
	}

	now = now.Add(2 * time.Minute)
	if _, ok := c.Get(ctx, "k"); ok {
		t.Error("истёкшая запись должна пропасть")
	}

	c.Delete(ctx, "k")
	if _, ok := c.Get(ctx, "k"); ok {
		t.Error("после Delete запись должна пропасть")
	}
}

func TestMemoryEviction(t *testing.T) {
	c := NewMemory(3)
	ctx := context.Background()
	c.Set(ctx, "a", []byte("1"), time.Minute)
	c.Set(ctx, "b", []byte("2"), 2*time.Minute)
	c.Set(ctx, "c", []byte("3"), 3*time.Minute)
	c.Set(ctx, "d", []byte("4"), 4*time.Minute) // вытесняет ближайшую к истечению "a"

	if _, ok := c.Get(ctx, "a"); ok {
		t.Error("ожидалось вытеснение записи с ближайшим истечением")
	}
	if _, ok := c.Get(ctx, "d"); !ok {
		t.Error("новая запись должна остаться")
	}
}

func TestTenantKey(t *testing.T) {
	if _, ok := TenantKey(context.Background(), "accounts"); ok {
		t.Error("без tenant'а ключ строиться не должен")
	}
	ctx1 := tenancy.WithTenant(context.Background(), "t-1")
	ctx2 := tenancy.WithTenant(context.Background(), "t-2")
	k1, _ := TenantKey(ctx1, "accounts")
	k2, _ := TenantKey(ctx2, "accounts")
	if k1 == k2 {
		t.Error("ключи разных tenant'ов совпали — утечка между колледжами")
	}
}
