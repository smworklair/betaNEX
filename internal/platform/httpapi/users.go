package httpapi

import (
	"context"
	"net/http"
	"strconv"

	"github.com/smworklair/betakis/internal/kernel/auth"
	"github.com/smworklair/betakis/internal/kernel/authz"
)

// PermUsersRead — право читать справочник пользователей tenant'а
// (выбор исполнителя задачи, получателей рассылки).
const PermUsersRead = "users:read"

// UserLister отдаёт пользователей tenant'а из контекста (без хэшей
// паролей — см. поле PasswordHash, оно остаётся пустым).
type UserLister interface {
	ListUsers(ctx context.Context, limit int) ([]auth.User, error)
}

// UsersRoutes монтирует справочник пользователей:
//
//	GET /api/v1/users?limit=200
func UsersRoutes(lister UserLister, guard *authz.Guard) func(mux *http.ServeMux) {
	return func(mux *http.ServeMux) {
		mux.HandleFunc("GET /api/v1/users", func(w http.ResponseWriter, r *http.Request) {
			if !RequirePermission(w, r, guard, PermUsersRead) {
				return
			}
			limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
			users, err := lister.ListUsers(r.Context(), limit)
			if err != nil {
				WriteProblem(w, http.StatusInternalServerError, "Внутренняя ошибка", err.Error())
				return
			}
			type dto struct {
				ID          string   `json:"id"`
				Email       string   `json:"email"`
				DisplayName string   `json:"display_name"`
				Roles       []string `json:"roles"`
				Active      bool     `json:"active"`
			}
			out := make([]dto, 0, len(users))
			for _, u := range users {
				out = append(out, dto{
					ID: u.ID, Email: u.Email, DisplayName: u.DisplayName,
					Roles: u.Roles, Active: u.Active,
				})
			}
			WriteJSON(w, http.StatusOK, out)
		})
	}
}
