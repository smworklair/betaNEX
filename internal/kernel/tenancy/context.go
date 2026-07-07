package tenancy

import "context"

// tenantKey — неэкспортируемый ключ контекста tenant'а.
type tenantKey struct{}

// WithTenant кладёт идентификатор tenant'а в контекст. Вызывается
// middleware после определения организации запроса (веха M2).
func WithTenant(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, tenantKey{}, id)
}

// TenantFrom возвращает идентификатор tenant'а из контекста. Второе
// значение — false, если tenant не установлен: такой запрос не имеет
// права трогать доменные данные.
func TenantFrom(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(tenantKey{}).(string)
	return id, ok
}
