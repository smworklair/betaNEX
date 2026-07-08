package httpapi

import (
	"log/slog"
	"net/http"
)

// RouterConfig описывает, из чего собирается роутер NEX. Заполняется
// композиционным корнем (cmd/nexd): именно он решает, какие модули
// смонтировать, какие зависимости проверять в /readyz и включать ли
// dev-аутентификацию.
type RouterConfig struct {
	// Readiness — проверки готовности зависимостей для /readyz
	// (Postgres и т.п.). Пустой список означает «готов всегда».
	Readiness []ReadinessCheck

	// DevAuth включает временную подмену аутентификации заголовками
	// X-Dev-* (см. devauth.go). Устанавливается только в development;
	// с появлением настоящих сессий (веха M3) исчезнет.
	DevAuth bool

	// Mount — функции монтирования маршрутов модулей. Каждый модуль
	// отдаёт свою функцию (например, finance.Routes), а корень передаёт
	// их сюда — так httpapi не знает о конкретных модулях.
	Mount []func(mux *http.ServeMux)
}

// NewRouter builds the complete HTTP handler for NEX: the route table wrapped
// in the standard middleware chain. As kernel features and modules are added,
// their routes will be registered here.
//
// Middleware order is deliberate. requestID is outermost so every log line and
// audit record of the request can carry the same identifier. requestLogger
// observes the final status of every request, including a 500 produced by
// recoverer. recoverer sits closest to the handlers so it catches panics from
// any of them.
func NewRouter(log *slog.Logger, cfg RouterConfig) http.Handler {
	mux := http.NewServeMux()

	// Method-based routing (Go 1.22+): a request to /healthz with any method
	// other than GET receives a 405 automatically.
	mux.Handle("GET /healthz", handleHealthz())
	mux.Handle("GET /readyz", handleReadyz(cfg.Readiness))

	for _, mount := range cfg.Mount {
		mount(mux)
	}

	mws := []middleware{requestID(), requestLogger(log), recoverer(log)}
	if cfg.DevAuth {
		mws = append(mws, devIdentity())
	}
	return chain(mux, mws...)
}
