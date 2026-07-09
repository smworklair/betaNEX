package httpapi

import "net/http"

// handleHealthz reports process liveness.
//
// It performs no dependency checks on purpose: a 200 here means only that the
// process is running and able to accept and answer HTTP requests. Readiness —
// whether downstream dependencies such as the database are reachable — is a
// separate concern and will be exposed as its own endpoint once those
// dependencies exist. Keeping liveness dependency-free means an orchestrator
// will not kill a process that is healthy but waiting on a slow dependency.
func handleHealthz() http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}
}
