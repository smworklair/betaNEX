package authz

import (
	"context"
	"fmt"

	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/kernel/identity"
)

// PolicyAuthorizer реализует command.Authorizer поверх статической
// RBAC-политики: право команды сверяется с ролями актора из контекста.
type PolicyAuthorizer struct {
	policy *Policy
}

// Проверка соответствия интерфейсу на этапе компиляции.
var _ command.Authorizer = (*PolicyAuthorizer)(nil)

// NewPolicyAuthorizer создаёт авторизатор поверх политики.
func NewPolicyAuthorizer(p *Policy) *PolicyAuthorizer {
	return &PolicyAuthorizer{policy: p}
}

// Authorize разрешает исполнение команды, если у актора из контекста
// есть требуемое командой право. Запрос без актора отклоняется всегда.
func (a *PolicyAuthorizer) Authorize(ctx context.Context, cmd command.Command) error {
	actor, ok := identity.ActorFrom(ctx)
	if !ok {
		return fmt.Errorf("%w: no actor in context", ErrDenied)
	}
	if !a.policy.Allows(actor.Roles, cmd.Permission()) {
		return fmt.Errorf("%w: permission %q", ErrDenied, cmd.Permission())
	}
	return nil
}
