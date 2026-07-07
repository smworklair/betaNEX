package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// readinessTimeout ограничивает суммарное время проверок готовности,
// чтобы медленная зависимость не подвешивала /readyz.
const readinessTimeout = 5 * time.Second

// ReadinessCheck — именованная проверка готовности одной зависимости
// (база данных, очередь и т.п.). Регистрируется в композиционном корне.
type ReadinessCheck struct {
	Name  string
	Check func(ctx context.Context) error
}

// handleReadyz сообщает готовность процесса принимать трафик: 200, если
// все проверки зависимостей прошли, и 503 со списком проваленных — иначе.
//
// В отличие от /healthz (liveness), сюда смотрят балансировщик и
// оркестратор перед тем, как направить трафик на инстанс.
func handleReadyz(checks []ReadinessCheck) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), readinessTimeout)
		defer cancel()

		failed := make(map[string]string)
		for _, c := range checks {
			if err := c.Check(ctx); err != nil {
				failed[c.Name] = err.Error()
			}
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if len(failed) > 0 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "unavailable",
				"failed": failed,
			})
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}
}
