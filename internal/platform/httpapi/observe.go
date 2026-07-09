package httpapi

import (
	"net/http"
	"net/http/pprof"
	"time"
)

// observer — middleware метрик. Шаблон маршрута берётся у самого mux
// (ServeMux.Handler сопоставляет запрос без исполнения хендлера):
// в метку попадает "GET /api/v1/finance/accounts", а не сырой путь
// с ID — кардинальность метрик не растёт с данными.
func observer(mux *http.ServeMux, observe func(route string, status int, dur time.Duration)) middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(rec, r)

			_, route := mux.Handler(r)
			if route == "" {
				route = "unmatched"
			}
			observe(route, rec.status, time.Since(start))
		})
	}
}

// mountPprof регистрирует /debug/pprof/* на общем mux. Только для
// development: профилировщик не должен торчать наружу в проде.
func mountPprof(mux *http.ServeMux) {
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
}
