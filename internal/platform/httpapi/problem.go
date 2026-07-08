package httpapi

import (
	"encoding/json"
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
func WriteProblem(w http.ResponseWriter, status int, title, detail string) {
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
