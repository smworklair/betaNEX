package httpapi

import (
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/smworklair/betakis/internal/kernel/audit"
	"github.com/smworklair/betakis/internal/kernel/identity"
)

// AuditRoutes монтирует вьюер журнала аудита: «кто менял оценки,
// приказы, проводки». Только для роли admin — журнал содержит следы
// действий всех пользователей tenant'а.
//
//	GET /api/v1/audit?limit=100&command=finance.entry.post&actor=<id>
func AuditRoutes(reader audit.Reader) func(mux *http.ServeMux) {
	return func(mux *http.ServeMux) {
		mux.HandleFunc("GET /api/v1/audit", func(w http.ResponseWriter, r *http.Request) {
			if !requireRole(w, r, "admin") {
				return
			}
			limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
			entries, err := reader.Entries(r.Context(), audit.Filter{
				Limit:   limit,
				Command: r.URL.Query().Get("command"),
				ActorID: r.URL.Query().Get("actor"),
			})
			if err != nil {
				WriteProblem(w, http.StatusInternalServerError, "Внутренняя ошибка", err.Error())
				return
			}
			out := make([]auditEntryDTO, 0, len(entries))
			for _, e := range entries {
				out = append(out, auditEntryDTO{
					Command:    e.Command,
					Outcome:    string(e.Outcome),
					ActorID:    e.ActorID,
					Detail:     e.Detail,
					TraceID:    e.TraceID,
					OccurredAt: e.OccurredAt,
				})
			}
			WriteJSON(w, http.StatusOK, out)
		})
	}
}

type auditEntryDTO struct {
	Command    string    `json:"command"`
	Outcome    string    `json:"outcome"`
	ActorID    string    `json:"actor_id,omitempty"`
	Detail     string    `json:"detail,omitempty"`
	TraceID    string    `json:"trace_id,omitempty"`
	OccurredAt time.Time `json:"occurred_at"`
}

// requireRole проверяет, что актор запроса аутентифицирован и несёт
// роль. Для читающих админских маршрутов, которые не проходят через
// шину команд (у них нет команды с Permission()).
func requireRole(w http.ResponseWriter, r *http.Request, role string) bool {
	actor, ok := identity.ActorFrom(r.Context())
	if !ok {
		WriteProblem(w, http.StatusUnauthorized, "Не аутентифицирован", "нет сессии")
		return false
	}
	if !slices.Contains(actor.Roles, role) {
		WriteProblem(w, http.StatusForbidden, "Доступ запрещён", "требуется роль "+role)
		return false
	}
	return true
}
