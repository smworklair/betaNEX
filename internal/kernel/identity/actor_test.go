package identity_test

import (
	"context"
	"testing"

	"github.com/smworklair/betakis/internal/kernel/identity"
)

func TestActorContext(t *testing.T) {
	t.Run("пустой контекст — актора нет", func(t *testing.T) {
		if _, ok := identity.ActorFrom(context.Background()); ok {
			t.Error("ActorFrom вернул ok для пустого контекста")
		}
	})

	t.Run("установленный актор читается обратно", func(t *testing.T) {
		want := identity.Actor{ID: "u1", Roles: []string{"admin"}}
		ctx := identity.WithActor(context.Background(), want)
		got, ok := identity.ActorFrom(ctx)
		if !ok || got.ID != want.ID || len(got.Roles) != 1 || got.Roles[0] != "admin" {
			t.Errorf("ActorFrom = (%+v, %v), want (%+v, true)", got, ok, want)
		}
	})
}
