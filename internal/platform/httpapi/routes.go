package httpapi

import (
	"log/slog"
	"net/http"
)

// NewRouter builds the complete HTTP handler for NEX: the route table wrapped
// in the standard middleware chain. As kernel features and modules are added,
// their routes will be registered here.
//
// Middleware order is deliberate. requestLogger is outermost so it observes the
// final status of every request, including a 500 produced by recoverer.
// recoverer sits closest to the handlers so it catches panics from any of them.
func NewRouter(log *slog.Logger) http.Handler {
	mux := http.NewServeMux()

	// Method-based routing (Go 1.22+): a request to /healthz with any method
	// other than GET receives a 405 automatically.
	mux.Handle("GET /healthz", handleHealthz())

	return chain(mux, requestLogger(log), recoverer(log))
}
