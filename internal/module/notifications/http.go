package notifications

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/kernel/identity"
	"github.com/smworklair/betakis/internal/platform/httpapi"
)

// Routes монтирует маршруты модуля. Лента строго личная: пользователь
// видит и отмечает только свои уведомления, id актора берётся из сессии.
//
//	GET  /api/v1/notifications              ?unread=1&limit=&offset=
//	GET  /api/v1/notifications/unread-count
//	POST /api/v1/notifications/{id}/read
//	POST /api/v1/notifications/read-all
func Routes(bus command.Bus, repo *Repository, guard *authz.Guard) func(mux *http.ServeMux) {
	return func(mux *http.ServeMux) {
		mux.HandleFunc("GET /api/v1/notifications", func(w http.ResponseWriter, r *http.Request) {
			if !httpapi.RequirePermission(w, r, guard, PermRead) {
				return
			}
			actor, _ := identity.ActorFrom(r.Context())
			q := r.URL.Query()
			limit, _ := strconv.Atoi(q.Get("limit"))
			offset, _ := strconv.Atoi(q.Get("offset"))
			unread := q.Get("unread") == "1" || q.Get("unread") == "true"
			items, err := repo.List(r.Context(), actor.ID, unread, limit, offset)
			if err != nil {
				writeErr(w, err)
				return
			}
			out := make([]notificationDTO, 0, len(items))
			for _, n := range items {
				out = append(out, toDTO(n))
			}
			httpapi.WriteJSON(w, http.StatusOK, out)
		})

		mux.HandleFunc("GET /api/v1/notifications/unread-count", func(w http.ResponseWriter, r *http.Request) {
			if !httpapi.RequirePermission(w, r, guard, PermRead) {
				return
			}
			actor, _ := identity.ActorFrom(r.Context())
			n, err := repo.CountUnread(r.Context(), actor.ID)
			if err != nil {
				writeErr(w, err)
				return
			}
			httpapi.WriteJSON(w, http.StatusOK, map[string]int64{"unread": n})
		})

		mux.HandleFunc("POST /api/v1/notifications/{id}/read", func(w http.ResponseWriter, r *http.Request) {
			dispatch(w, r, bus, MarkRead{ID: r.PathValue("id")})
		})

		mux.HandleFunc("POST /api/v1/notifications/read-all", func(w http.ResponseWriter, r *http.Request) {
			dispatch(w, r, bus, MarkAllRead{})
		})
	}
}

type notificationDTO struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Title     string    `json:"title"`
	Body      string    `json:"body,omitempty"`
	RefType   string    `json:"ref_type,omitempty"`
	RefID     string    `json:"ref_id,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	ReadAt    string    `json:"read_at,omitempty"`
}

func toDTO(n Notification) notificationDTO {
	d := notificationDTO{
		ID: n.ID, Kind: n.Kind, Title: n.Title, Body: n.Body,
		RefType: n.RefType, RefID: n.RefID, CreatedAt: n.CreatedAt,
	}
	if !n.ReadAt.IsZero() {
		d.ReadAt = n.ReadAt.Format(time.RFC3339)
	}
	return d
}

func dispatch(w http.ResponseWriter, r *http.Request, bus command.Bus, cmd command.Command) {
	if err := cmd.Validate(); err != nil {
		httpapi.WriteProblem(w, http.StatusBadRequest, "Некорректный запрос", err.Error())
		return
	}
	if err := bus.Dispatch(r.Context(), cmd); err != nil {
		writeErr(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func writeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, authz.ErrDenied):
		httpapi.WriteProblem(w, http.StatusForbidden, "Доступ запрещён", err.Error())
	case errors.Is(err, ErrNoActor):
		httpapi.WriteProblem(w, http.StatusUnauthorized, "Не аутентифицирован", err.Error())
	case errors.Is(err, ErrNoTenant):
		httpapi.WriteProblem(w, http.StatusBadRequest, "Не указан tenant", err.Error())
	case errors.Is(err, ErrUserNotFound):
		httpapi.WriteProblem(w, http.StatusUnprocessableEntity, "Получатель не найден", err.Error())
	default:
		httpapi.WriteProblem(w, http.StatusInternalServerError, "Внутренняя ошибка", err.Error())
	}
}
