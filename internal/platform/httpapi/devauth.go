package httpapi

import (
	"net/http"
	"strings"

	"github.com/smworklair/betakis/internal/kernel/identity"
	"github.com/smworklair/betakis/internal/kernel/tenancy"
)

// devIdentity — ВРЕМЕННАЯ подмена аутентификации для локальной разработки,
// пока нет настоящих сессий (веха M3). Актор и tenant берутся из заголовков:
//
//	X-Dev-Actor:  user-1
//	X-Dev-Roles:  admin,accountant
//	X-Dev-Tenant: college-1
//
// Middleware включается только когда NEX_ENV=development (см. main и
// RouterConfig.DevAuth); в production он не устанавливается вовсе.
// С появлением identity-сессий этот файл удаляется целиком.
func devIdentity() middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			if actorID := r.Header.Get("X-Dev-Actor"); actorID != "" {
				var roles []string
				for _, role := range strings.Split(r.Header.Get("X-Dev-Roles"), ",") {
					if role = strings.TrimSpace(role); role != "" {
						roles = append(roles, role)
					}
				}
				ctx = identity.WithActor(ctx, identity.Actor{ID: actorID, Roles: roles})
			}
			if tenant := r.Header.Get("X-Dev-Tenant"); tenant != "" {
				ctx = tenancy.WithTenant(ctx, tenant)
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
