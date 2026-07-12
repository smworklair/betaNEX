package authz_test

import (
	"context"
	"errors"
	"testing"

	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/identity"
)

func TestGuardRequire(t *testing.T) {
	policy := authz.NewPolicy()
	policy.Grant("teacher", "tasks:read")
	guard := authz.NewGuard(policy)

	t.Run("без актора — ErrUnauthenticated", func(t *testing.T) {
		err := guard.Require(context.Background(), "tasks:read")
		if !errors.Is(err, authz.ErrUnauthenticated) {
			t.Errorf("err = %v, want ErrUnauthenticated", err)
		}
		// 401 и 403 различаются: аноним не должен получать ErrDenied.
		if errors.Is(err, authz.ErrDenied) {
			t.Error("ErrUnauthenticated не должен матчиться с ErrDenied")
		}
	})

	t.Run("роль без права — ErrDenied", func(t *testing.T) {
		ctx := identity.WithActor(context.Background(), identity.Actor{ID: "s1", Roles: []string{"student"}})
		if err := guard.Require(ctx, "tasks:read"); !errors.Is(err, authz.ErrDenied) {
			t.Errorf("err = %v, want ErrDenied", err)
		}
	})

	t.Run("роль с правом — доступ", func(t *testing.T) {
		ctx := identity.WithActor(context.Background(), identity.Actor{ID: "t1", Roles: []string{"teacher"}})
		if err := guard.Require(ctx, "tasks:read"); err != nil {
			t.Errorf("err = %v, want nil", err)
		}
	})
}
