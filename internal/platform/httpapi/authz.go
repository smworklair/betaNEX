package httpapi

import (
	"errors"
	"net/http"

	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/identity"
)

// RequirePermission — страж читающих маршрутов: пропускает запрос, только
// если актор аутентифицирован и несёт право permission. При отказе сам
// пишет problem-ответ (401 без сессии, 403 без права) и возвращает false.
//
// Мутации сюда не ходят: их авторизует шина команд. Guard == nil означает
// «проверка не подключена» (in-memory режим без политики) — тогда
// требуется хотя бы аутентифицированный актор.
func RequirePermission(w http.ResponseWriter, r *http.Request, g *authz.Guard, permission string) bool {
	if g == nil {
		return requireActor(w, r)
	}
	err := g.Require(r.Context(), permission)
	switch {
	case errors.Is(err, authz.ErrUnauthenticated):
		WriteProblem(w, http.StatusUnauthorized, "Не аутентифицирован", "нет сессии")
		return false
	case errors.Is(err, authz.ErrDenied):
		WriteProblem(w, http.StatusForbidden, "Доступ запрещён", err.Error())
		return false
	case err != nil:
		WriteProblem(w, http.StatusInternalServerError, "Внутренняя ошибка", err.Error())
		return false
	}
	return true
}

// requireActor пропускает запрос при любом аутентифицированном акторе.
func requireActor(w http.ResponseWriter, r *http.Request) bool {
	if _, ok := identity.ActorFrom(r.Context()); !ok {
		WriteProblem(w, http.StatusUnauthorized, "Не аутентифицирован", "нет сессии")
		return false
	}
	return true
}
