package campus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/kernel/identity"
	"github.com/smworklair/betakis/internal/platform/httpapi"
)

// RegisterCommands подключает команды модуля к шине.
func RegisterCommands(bus interface {
	Register(name string, h command.HandlerFunc) error
}, repo *Repository,
) error {
	if err := bus.Register(CmdGroupCreate, func(ctx context.Context, cmd command.Command) error {
		c, ok := cmd.(CreateGroup)
		if !ok {
			return fmt.Errorf("campus: %s: unexpected command type %T", CmdGroupCreate, cmd)
		}
		_, err := repo.CreateGroup(ctx, c.Code, c.Title)
		return err
	}); err != nil {
		return err
	}
	if err := bus.Register(CmdStudentEnroll, func(ctx context.Context, cmd command.Command) error {
		c, ok := cmd.(EnrollStudent)
		if !ok {
			return fmt.Errorf("campus: %s: unexpected command type %T", CmdStudentEnroll, cmd)
		}
		_, err := repo.CreateStudent(ctx, Student{FullName: c.FullName, Email: c.Email, GroupID: c.GroupID})
		return err
	}); err != nil {
		return err
	}
	if err := bus.Register(CmdStudentUpdate, func(ctx context.Context, cmd command.Command) error {
		c, ok := cmd.(UpdateStudent)
		if !ok {
			return fmt.Errorf("campus: %s: unexpected command type %T", CmdStudentUpdate, cmd)
		}
		return repo.UpdateStudent(ctx, Student{
			ID: c.ID, FullName: c.FullName, Email: c.Email,
			GroupID: c.GroupID, Status: c.Status,
		})
	}); err != nil {
		return err
	}
	return bus.Register(CmdGradeRecord, func(ctx context.Context, cmd command.Command) error {
		c, ok := cmd.(RecordGrade)
		if !ok {
			return fmt.Errorf("campus: %s: unexpected command type %T", CmdGradeRecord, cmd)
		}
		g := Grade{
			StudentID: c.StudentID, Subject: c.Subject, Grade: c.Grade,
			GradedOn: c.GradedOn, Note: c.Note,
		}
		if actor, ok := identity.ActorFrom(ctx); ok {
			g.GradedBy = actor.ID
		}
		return repo.RecordGrade(ctx, g)
	})
}

// Routes монтирует маршруты модуля.
//
//	POST  /api/v1/campus/groups            {code, name}
//	GET   /api/v1/campus/groups            группы + число студентов
//	POST  /api/v1/campus/students          {full_name, email, group_id}
//	GET   /api/v1/campus/students          ?group=&status=&q=&sort=&limit=&offset=
//	PATCH /api/v1/campus/students/{id}     {full_name, email, group_id, status}
//	POST  /api/v1/campus/grades            {student_id, subject, grade, graded_on, note}
//	GET   /api/v1/campus/journal           ?group=&student=&subject=&limit=
func Routes(bus command.Bus, repo *Repository) func(mux *http.ServeMux) {
	return func(mux *http.ServeMux) {
		mux.HandleFunc("POST /api/v1/campus/groups", func(w http.ResponseWriter, r *http.Request) {
			var req struct{ Code, Name string }
			if !decode(w, r, &req) {
				return
			}
			dispatch(w, r, bus, CreateGroup{Code: req.Code, Title: req.Name})
		})

		mux.HandleFunc("GET /api/v1/campus/groups", func(w http.ResponseWriter, r *http.Request) {
			groups, err := repo.Groups(r.Context())
			if err != nil {
				writeErr(w, err)
				return
			}
			type dto struct {
				ID             string `json:"id"`
				Code           string `json:"code"`
				Name           string `json:"name"`
				ActiveStudents int    `json:"active_students"`
			}
			out := make([]dto, 0, len(groups))
			for _, g := range groups {
				out = append(out, dto{g.ID, g.Code, g.Name, g.ActiveStudents})
			}
			httpapi.WriteJSON(w, http.StatusOK, out)
		})

		mux.HandleFunc("POST /api/v1/campus/students", func(w http.ResponseWriter, r *http.Request) {
			var req struct {
				FullName string `json:"full_name"`
				Email    string `json:"email"`
				GroupID  string `json:"group_id"`
			}
			if !decode(w, r, &req) {
				return
			}
			dispatch(w, r, bus, EnrollStudent{FullName: req.FullName, Email: req.Email, GroupID: req.GroupID})
		})

		mux.HandleFunc("GET /api/v1/campus/students", func(w http.ResponseWriter, r *http.Request) {
			q := r.URL.Query()
			limit, _ := strconv.Atoi(q.Get("limit"))
			offset, _ := strconv.Atoi(q.Get("offset"))
			students, err := repo.Students(r.Context(), StudentFilter{
				GroupID: q.Get("group"), Status: q.Get("status"), Query: q.Get("q"),
				Sort: q.Get("sort"), Limit: limit, Offset: offset,
			})
			if err != nil {
				writeErr(w, err)
				return
			}
			out := make([]studentDTO, 0, len(students))
			for _, s := range students {
				out = append(out, toStudentDTO(s))
			}
			httpapi.WriteJSON(w, http.StatusOK, out)
		})

		mux.HandleFunc("PATCH /api/v1/campus/students/{id}", func(w http.ResponseWriter, r *http.Request) {
			var req struct {
				FullName string `json:"full_name"`
				Email    string `json:"email"`
				GroupID  string `json:"group_id"`
				Status   string `json:"status"`
			}
			if !decode(w, r, &req) {
				return
			}
			if req.Status == "" {
				req.Status = string(StatusActive)
			}
			dispatch(w, r, bus, UpdateStudent{
				ID: r.PathValue("id"), FullName: req.FullName, Email: req.Email,
				GroupID: req.GroupID, Status: StudentStatus(req.Status),
			})
		})

		mux.HandleFunc("POST /api/v1/campus/grades", func(w http.ResponseWriter, r *http.Request) {
			var req struct {
				StudentID string `json:"student_id"`
				Subject   string `json:"subject"`
				Grade     int    `json:"grade"`
				GradedOn  string `json:"graded_on"` // YYYY-MM-DD, пусто = сегодня
				Note      string `json:"note"`
			}
			if !decode(w, r, &req) {
				return
			}
			cmd := RecordGrade{StudentID: req.StudentID, Subject: req.Subject, Grade: req.Grade, Note: req.Note}
			if req.GradedOn != "" {
				t, err := time.Parse("2006-01-02", req.GradedOn)
				if err != nil {
					httpapi.WriteProblem(w, http.StatusBadRequest, "Некорректная дата", err.Error())
					return
				}
				cmd.GradedOn = t
			}
			dispatch(w, r, bus, cmd)
		})

		mux.HandleFunc("GET /api/v1/campus/journal", func(w http.ResponseWriter, r *http.Request) {
			q := r.URL.Query()
			limit, _ := strconv.Atoi(q.Get("limit"))
			grades, err := repo.Journal(r.Context(), JournalFilter{
				GroupID: q.Get("group"), StudentID: q.Get("student"),
				Subject: q.Get("subject"), Limit: limit,
			})
			if err != nil {
				writeErr(w, err)
				return
			}
			type dto struct {
				ID        string `json:"id"`
				StudentID string `json:"student_id"`
				FullName  string `json:"full_name"`
				GroupCode string `json:"group_code,omitempty"`
				Subject   string `json:"subject"`
				Grade     int    `json:"grade"`
				GradedOn  string `json:"graded_on"`
				GradedBy  string `json:"graded_by,omitempty"`
				Note      string `json:"note,omitempty"`
			}
			out := make([]dto, 0, len(grades))
			for _, g := range grades {
				out = append(out, dto{
					g.ID, g.StudentID, g.FullName, g.GroupCode, g.Subject,
					g.Grade, g.GradedOn.Format("2006-01-02"), g.GradedBy, g.Note,
				})
			}
			httpapi.WriteJSON(w, http.StatusOK, out)
		})
	}
}

type studentDTO struct {
	ID        string    `json:"id"`
	FullName  string    `json:"full_name"`
	Email     string    `json:"email,omitempty"`
	GroupID   string    `json:"group_id,omitempty"`
	GroupCode string    `json:"group_code,omitempty"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

func toStudentDTO(s Student) studentDTO {
	return studentDTO{
		ID: s.ID, FullName: s.FullName, Email: s.Email,
		GroupID: s.GroupID, GroupCode: s.GroupCode,
		Status: string(s.Status), CreatedAt: s.CreatedAt,
	}
}

// dispatch валидирует и проводит команду, отвечая 201/ошибкой.
func dispatch(w http.ResponseWriter, r *http.Request, bus command.Bus, cmd command.Command) {
	if err := cmd.Validate(); err != nil {
		httpapi.WriteProblem(w, http.StatusBadRequest, "Некорректный запрос", err.Error())
		return
	}
	if err := bus.Dispatch(r.Context(), cmd); err != nil {
		writeErr(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusCreated, map[string]string{"status": "ok"})
}

func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		httpapi.WriteProblem(w, http.StatusBadRequest, "Некорректный JSON", err.Error())
		return false
	}
	return true
}

func writeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, authz.ErrDenied):
		httpapi.WriteProblem(w, http.StatusForbidden, "Доступ запрещён", err.Error())
	case errors.Is(err, ErrNoTenant):
		httpapi.WriteProblem(w, http.StatusBadRequest, "Не указан tenant", err.Error())
	case errors.Is(err, ErrDuplicateGroup):
		httpapi.WriteProblem(w, http.StatusConflict, "Код группы занят", err.Error())
	case errors.Is(err, ErrUnknownGroup), errors.Is(err, ErrUnknownStudent), errors.Is(err, ErrNotFound):
		httpapi.WriteProblem(w, http.StatusNotFound, "Не найдено", err.Error())
	default:
		httpapi.WriteProblem(w, http.StatusInternalServerError, "Внутренняя ошибка", err.Error())
	}
}
