package httpapi

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/tenancy"
)

// SearchHit — один результат полнотекстового поиска, независимо от
// модуля-источника.
type SearchHit struct {
	Kind    string    `json:"kind"` // "finance.account", "finance.entry", "file", ...
	ID      string    `json:"id"`
	Title   string    `json:"title"`
	Snippet string    `json:"snippet,omitempty"`
	Rank    float32   `json:"rank"`
	At      time.Time `json:"at,omitempty"`
}

// SearchSource — модуль, умеющий искать по своим данным. Каждый модуль
// реализует поиск сам (tsvector-колонки и запросы — его забота);
// сквозной /api/v1/search только агрегирует результаты.
type SearchSource interface {
	Search(ctx context.Context, query string, limit int) ([]SearchHit, error)
}

// PermSearch — право сквозного поиска. Поиск агрегирует данные многих
// модулей, поэтому право отдельное и выдаётся ролям, у которых есть
// чтение хотя бы части источников.
const PermSearch = "search:read"

// SearchRoutes монтирует сквозной полнотекстовый поиск:
//
//	GET /api/v1/search?q=оплата обучения&limit=20
//
// Требует права PermSearch и tenant'а: поиск ходит в данные организации.
// Синтаксис запроса — websearch (кавычки, минус-слова, or).
func SearchRoutes(guard *authz.Guard, sources ...SearchSource) func(mux *http.ServeMux) {
	return func(mux *http.ServeMux) {
		mux.HandleFunc("GET /api/v1/search", func(w http.ResponseWriter, r *http.Request) {
			if !RequirePermission(w, r, guard, PermSearch) {
				return
			}
			if _, ok := tenancy.TenantFrom(r.Context()); !ok {
				WriteProblem(w, http.StatusBadRequest, "Не указан tenant", "поиск работает в данных организации")
				return
			}
			query := r.URL.Query().Get("q")
			if query == "" {
				WriteProblem(w, http.StatusBadRequest, "Пустой запрос", "параметр q обязателен")
				return
			}
			limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
			if limit <= 0 || limit > 100 {
				limit = 20
			}

			hits := make([]SearchHit, 0, limit)
			for _, src := range sources {
				part, err := src.Search(r.Context(), query, limit)
				if err != nil {
					WriteProblem(w, http.StatusInternalServerError, "Ошибка поиска", err.Error())
					return
				}
				hits = append(hits, part...)
			}
			WriteJSON(w, http.StatusOK, map[string]any{"query": query, "hits": hits})
		})
	}
}
