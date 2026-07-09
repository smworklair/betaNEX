package tasks

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/platform/httpapi"
)

// Routes монтирует маршруты модуля.
//
//	POST   /api/v1/tasks                 {title, note, due_on, assignee}
//	GET    /api/v1/tasks                 ?status=&assignee=&q=&sort=&limit=&offset=
//	POST   /api/v1/tasks/{id}/complete
//	DELETE /api/v1/tasks/{id}
func Routes(bus command.Bus, repo *Repository) func(mux *http.ServeMux) {
	return func(mux *http.ServeMux) {
		mux.HandleFunc("POST /api/v1/tasks", func(w http.ResponseWriter, r *http.Request) {
			var req struct {
				Title    string `json:"title"`
				Note     string `json:"note"`
				DueOn    string `json:"due_on"` // YYYY-MM-DD
				Assignee string `json:"assignee"`
			}
			r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			if err := dec.Decode(&req); err != nil {
				httpapi.WriteProblem(w, http.StatusBadRequest, "Некорректный JSON", err.Error())
				return
			}
			cmd := Create{Title: req.Title, Note: req.Note, Assignee: req.Assignee}
			if req.DueOn != "" {
				t, err := time.Parse("2006-01-02", req.DueOn)
				if err != nil {
					httpapi.WriteProblem(w, http.StatusBadRequest, "Некорректная дата", err.Error())
					return
				}
				cmd.DueOn = t
			}
			dispatch(w, r, bus, cmd, http.StatusCreated)
		})

		mux.HandleFunc("GET /api/v1/tasks", func(w http.ResponseWriter, r *http.Request) {
			q := r.URL.Query()
			limit, _ := strconv.Atoi(q.Get("limit"))
			offset, _ := strconv.Atoi(q.Get("offset"))
			items, err := repo.List(r.Context(), Filter{
				Status: q.Get("status"), Assignee: q.Get("assignee"),
				Query: q.Get("q"), Sort: q.Get("sort"), Limit: limit, Offset: offset,
			})
			if err != nil {
				writeErr(w, err)
				return
			}
			out := make([]taskDTO, 0, len(items))
			for _, t := range items {
				out = append(out, toDTO(t))
			}
			httpapi.WriteJSON(w, http.StatusOK, out)
		})

		mux.HandleFunc("POST /api/v1/tasks/{id}/complete", func(w http.ResponseWriter, r *http.Request) {
			dispatch(w, r, bus, Complete{ID: r.PathValue("id")}, http.StatusOK)
		})

		mux.HandleFunc("DELETE /api/v1/tasks/{id}", func(w http.ResponseWriter, r *http.Request) {
			dispatch(w, r, bus, Delete{ID: r.PathValue("id")}, http.StatusNoContent)
		})
	}
}

type taskDTO struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Note      string    `json:"note,omitempty"`
	Status    string    `json:"status"`
	DueOn     string    `json:"due_on,omitempty"`
	Assignee  string    `json:"assignee,omitempty"`
	CreatedBy string    `json:"created_by,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	DoneAt    string    `json:"done_at,omitempty"`
}

func toDTO(t Task) taskDTO {
	d := taskDTO{
		ID: t.ID, Title: t.Title, Note: t.Note, Status: t.Status,
		Assignee: t.Assignee, CreatedBy: t.CreatedBy, CreatedAt: t.CreatedAt,
	}
	if !t.DueOn.IsZero() {
		d.DueOn = t.DueOn.Format("2006-01-02")
	}
	if !t.DoneAt.IsZero() {
		d.DoneAt = t.DoneAt.Format(time.RFC3339)
	}
	return d
}

func dispatch(w http.ResponseWriter, r *http.Request, bus command.Bus, cmd command.Command, okStatus int) {
	if err := cmd.Validate(); err != nil {
		httpapi.WriteProblem(w, http.StatusBadRequest, "Некорректный запрос", err.Error())
		return
	}
	if err := bus.Dispatch(r.Context(), cmd); err != nil {
		writeErr(w, err)
		return
	}
	if okStatus == http.StatusNoContent {
		w.WriteHeader(okStatus)
		return
	}
	httpapi.WriteJSON(w, okStatus, map[string]string{"status": "ok"})
}

func writeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, authz.ErrDenied):
		httpapi.WriteProblem(w, http.StatusForbidden, "Доступ запрещён", err.Error())
	case errors.Is(err, ErrNoTenant):
		httpapi.WriteProblem(w, http.StatusBadRequest, "Не указан tenant", err.Error())
	case errors.Is(err, ErrNotFound):
		httpapi.WriteProblem(w, http.StatusNotFound, "Задача не найдена", err.Error())
	default:
		httpapi.WriteProblem(w, http.StatusInternalServerError, "Внутренняя ошибка", err.Error())
	}
}
