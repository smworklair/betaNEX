package httpapi

import (
	"context"
	"net/http"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
)

// tenantResolver — middleware: нормализует идентификатор tenant'а в
// контексте запроса через переданную функцию (обычно slug → UUID по
// реестру tenant'ов). Запрос с неизвестным tenant'ом обрывается здесь
// с 400, не доходя до команд и SQL.
func tenantResolver(resolve func(ctx context.Context, v string) (string, error)) middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			if tenant, ok := tenancy.TenantFrom(ctx); ok {
				id, err := resolve(ctx, tenant)
				if err != nil {
					WriteProblem(w, http.StatusBadRequest, "Неизвестный tenant", err.Error())
					return
				}
				ctx = tenancy.WithTenant(ctx, id)
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
