package identity

import "context"

// Actor — аутентифицированный субъект: человек, сервисный процесс или
// (в будущем) AI-агент. Ядру не важно, кто именно, — важны идентификатор
// и роли, по которым authz принимает решения.
type Actor struct {
	ID    string   // стабильный идентификатор (uuid пользователя и т.п.)
	Roles []string // роли в текущем tenant'е, напр. "admin", "teacher"
}

// actorKey — неэкспортируемый ключ контекста: положить актора можно
// только через WithActor, достать — только через ActorFrom.
type actorKey struct{}

// WithActor кладёт актора в контекст. Вызывается middleware аутентификации
// после проверки сессии (веха M3).
func WithActor(ctx context.Context, a Actor) context.Context {
	return context.WithValue(ctx, actorKey{}, a)
}

// ActorFrom возвращает актора из контекста. Второе значение — false,
// если запрос не аутентифицирован.
func ActorFrom(ctx context.Context) (Actor, bool) {
	a, ok := ctx.Value(actorKey{}).(Actor)
	return a, ok
}
