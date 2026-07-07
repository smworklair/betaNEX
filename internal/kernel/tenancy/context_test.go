package tenancy_test

import (
	"context"
	"testing"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
)

func TestTenantContext(t *testing.T) {
	t.Run("пустой контекст — tenant не установлен", func(t *testing.T) {
		if _, ok := tenancy.TenantFrom(context.Background()); ok {
			t.Error("TenantFrom вернул ok для пустого контекста")
		}
	})

	t.Run("установленный tenant читается обратно", func(t *testing.T) {
		ctx := tenancy.WithTenant(context.Background(), "tenant-42")
		id, ok := tenancy.TenantFrom(ctx)
		if !ok || id != "tenant-42" {
			t.Errorf("TenantFrom = (%q, %v), want (%q, true)", id, ok, "tenant-42")
		}
	})
}
