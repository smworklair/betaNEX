package authz_test

import (
	"context"
	"errors"
	"testing"

	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/identity"
)

// stubCmd — команда-заглушка с фиксированным правом.
type stubCmd struct{ perm string }

func (c stubCmd) Name() string       { return "stub" }
func (c stubCmd) Permission() string { return c.perm }
func (c stubCmd) Validate() error    { return nil }

func TestPolicyAllows(t *testing.T) {
	p := authz.NewPolicy()
	p.Grant("teacher", "grades:write")
	p.Grant("admin", "grades:write")
	p.Grant("admin", "users:manage")

	cases := []struct {
		name  string
		roles []string
		perm  string
		want  bool
	}{
		{"роль с правом", []string{"teacher"}, "grades:write", true},
		{"одна из ролей с правом", []string{"student", "admin"}, "users:manage", true},
		{"роль без права", []string{"student"}, "grades:write", false},
		{"нет ролей", nil, "grades:write", false},
		{"неизвестное право", []string{"admin"}, "does:not:exist", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := p.Allows(tc.roles, tc.perm); got != tc.want {
				t.Errorf("Allows(%v, %q) = %v, want %v", tc.roles, tc.perm, got, tc.want)
			}
		})
	}
}

func TestPolicyAuthorizer(t *testing.T) {
	p := authz.NewPolicy()
	p.Grant("admin", "users:manage")
	a := authz.NewPolicyAuthorizer(p)

	t.Run("без актора — отказ", func(t *testing.T) {
		err := a.Authorize(context.Background(), stubCmd{perm: "users:manage"})
		if !errors.Is(err, authz.ErrDenied) {
			t.Errorf("err = %v, want ErrDenied", err)
		}
	})

	t.Run("актор с правом — разрешено", func(t *testing.T) {
		ctx := identity.WithActor(context.Background(), identity.Actor{ID: "u1", Roles: []string{"admin"}})
		if err := a.Authorize(ctx, stubCmd{perm: "users:manage"}); err != nil {
			t.Errorf("err = %v, want nil", err)
		}
	})

	t.Run("актор без права — отказ", func(t *testing.T) {
		ctx := identity.WithActor(context.Background(), identity.Actor{ID: "u2", Roles: []string{"student"}})
		err := a.Authorize(ctx, stubCmd{perm: "users:manage"})
		if !errors.Is(err, authz.ErrDenied) {
			t.Errorf("err = %v, want ErrDenied", err)
		}
	})
}
