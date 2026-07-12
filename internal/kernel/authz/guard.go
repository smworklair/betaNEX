package authz

import (
	"context"
	"errors"
	"fmt"

	"github.com/smworklair/betakis/internal/kernel/identity"
)

// ErrUnauthenticated — в контексте нет актора. Отличается от ErrDenied,
// чтобы HTTP-слой честно отвечал 401 (войдите), а не 403 (нельзя).
var ErrUnauthenticated = errors.New("authz: unauthenticated")

// Guard проверяет права актора вне шины команд — для читающих маршрутов,
// у которых нет команды с Permission(). Политика та же, что у
// PolicyAuthorizer: матрица «роль × право» — единственный источник истины
// доступа и для записи, и для чтения.
type Guard struct {
	policy *Policy
}

// NewGuard создаёт проверку чтения поверх политики.
func NewGuard(p *Policy) *Guard { return &Guard{policy: p} }

// Require разрешает доступ, если актор из контекста несёт право
// permission. Без актора — ErrUnauthenticated, без права — ErrDenied.
func (g *Guard) Require(ctx context.Context, permission string) error {
	actor, ok := identity.ActorFrom(ctx)
	if !ok {
		return fmt.Errorf("%w: no actor in context", ErrUnauthenticated)
	}
	if !g.policy.Allows(actor.Roles, permission) {
		return fmt.Errorf("%w: permission %q", ErrDenied, permission)
	}
	return nil
}
