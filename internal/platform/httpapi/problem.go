package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// Problem — тело ошибки API в формате RFC 9457 (Problem Details).
// Единый формат для всех модулей: клиент всегда разбирает ошибку одинаково.
type Problem struct {
	Type   string `json:"type,omitempty"`
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail,omitempty"`
}

// WriteProblem пишет ошибку как application/problem+json. Используется
// HTTP-хендлерами модулей для всех неуспешных ответов.
//
// Для 5xx detail в ответ клиенту не попадает: по всему бэкенду вызывающие
// передают сюда err.Error() необработанных внутренних ошибок (pgx —
// имена таблиц/колонок/constraint'ов, пути и т.п.), и это была бы прямая
// утечка внутреннего устройства системы наружу. Настоящая причина уходит
// в лог через slog.Default() (composition root настраивает его как
// единый логгер процесса — см. slog.SetDefault в cmd/nexd) — оператор
// найдёт её в логах по времени рядом со строкой requestLogger, где есть
// путь и request id. 4xx (клиентские ошибки — например, невалидный JSON)
// detail не трогает: там в detail собственная же ошибка клиента.
func WriteProblem(w http.ResponseWriter, status int, title, detail string) {
	if status >= http.StatusInternalServerError {
		if detail != "" {
			slog.Error("internal error", slog.String("title", title), slog.String("detail", detail))
		}
		detail = ""
	}
	w.Header().Set("Content-Type", "application/problem+json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Problem{
		Type:   "about:blank",
		Title:  title,
		Status: status,
		Detail: detail,
	})
}

// WriteJSON пишет успешный ответ в формате application/json.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
