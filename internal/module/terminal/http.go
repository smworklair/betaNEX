package terminal

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/platform/httpapi"
)

// Routes монтирует маршруты терминала.
//
//	POST /api/v1/terminal/exec  {line}
//
// Один вход для всех команд: guard проверяет право terminal:exec (только
// admin), мутации внутри дополнительно авторизует шина команд.
func Routes(deps Deps, guard *authz.Guard) func(mux *http.ServeMux) {
	return func(mux *http.ServeMux) {
		mux.HandleFunc("POST /api/v1/terminal/exec", func(w http.ResponseWriter, r *http.Request) {
			if !httpapi.RequirePermission(w, r, guard, PermExec) {
				return
			}
			var req struct {
				Line string `json:"line"`
			}
			r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			if err := dec.Decode(&req); err != nil {
				httpapi.WriteProblem(w, http.StatusBadRequest, "Некорректный JSON", err.Error())
				return
			}
			res, err := deps.Exec(r.Context(), req.Line)
			switch {
			case errors.Is(err, ErrUnknown):
				httpapi.WriteProblem(w, http.StatusUnprocessableEntity, "Неизвестная команда", "наберите help")
			case errors.Is(err, authz.ErrDenied):
				httpapi.WriteProblem(w, http.StatusForbidden, "Доступ запрещён", err.Error())
			case err != nil:
				httpapi.WriteProblem(w, http.StatusInternalServerError, "Ошибка терминала", err.Error())
			default:
				httpapi.WriteJSON(w, http.StatusOK, res)
			}
		})
	}
}
