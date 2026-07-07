package httpapi

import (
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"
)

// middleware decorates an http.Handler with cross-cutting behaviour.
type middleware func(http.Handler) http.Handler

// chain wraps h with the given middlewares. The first middleware listed becomes
// the outermost layer, so chain(h, a, b) produces a(b(h)) and a request passes
// through a, then b, then h.
func chain(h http.Handler, mws ...middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

// statusRecorder wraps http.ResponseWriter to remember the status code that was
// written, so middleware can report the outcome of a request. It defaults to
// 200, the status net/http sends if a handler writes a body without calling
// WriteHeader.
type statusRecorder struct {
	http.ResponseWriter
	status  int
	written bool
}

func (r *statusRecorder) WriteHeader(code int) {
	if !r.written {
		r.status = code
		r.written = true
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if !r.written {
		r.status = http.StatusOK
		r.written = true
	}
	return r.ResponseWriter.Write(b)
}

// requestLogger emits one structured log line per request, recording the
// method, path, resulting status and how long the request took.
func requestLogger(log *slog.Logger) middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(rec, r)

			log.LogAttrs(r.Context(), slog.LevelInfo, "http request",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", rec.status),
				slog.Duration("duration", time.Since(start)),
				slog.String("remote", r.RemoteAddr),
			)
		})
	}
}

// recoverer turns a panic in a downstream handler into a 500 response and an
// error log, so a single failing request cannot crash the whole process. It is
// installed closest to the handlers so it catches panics from all of them,
// while requestLogger sits further out and still records the resulting 500.
func recoverer(log *slog.Logger) middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					log.LogAttrs(r.Context(), slog.LevelError, "panic recovered",
						slog.Any("panic", rec),
						slog.String("stack", string(debug.Stack())),
					)
					w.WriteHeader(http.StatusInternalServerError)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}
