package httpapi

import "net/http"

// handleOpenAPI раздаёт встроенную OpenAPI-спеку контракта API.
// Спека публична: она не содержит данных, а клиентам (генераторы,
// Bruno/Postman, будущие внешние интеграции) нужен доступ до входа.
func handleOpenAPI(spec []byte) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
		_, _ = w.Write(spec)
	})
}
