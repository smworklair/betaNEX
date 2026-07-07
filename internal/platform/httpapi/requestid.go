package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
)

// requestIDHeader — заголовок, в котором идентификатор запроса приходит
// от клиента (или обратного прокси) и возвращается в ответе.
const requestIDHeader = "X-Request-Id"

// requestIDKey — неэкспортируемый ключ контекста идентификатора запроса.
type requestIDKey struct{}

// RequestIDFrom возвращает идентификатор запроса из контекста или пустую
// строку, если middleware requestID не был установлен.
func RequestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

// requestID — middleware: принимает X-Request-Id клиента (если он разумной
// длины) или генерирует новый, кладёт его в контекст запроса и в заголовок
// ответа. Один идентификатор связывает строку доступа, записи аудита и
// ответ клиенту — по нему инцидент ищется во всех логах сразу.
func requestID() middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.Header.Get(requestIDHeader)
			if id == "" || len(id) > 64 {
				id = newRequestID()
			}
			w.Header().Set(requestIDHeader, id)
			ctx := context.WithValue(r.Context(), requestIDKey{}, id)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// newRequestID генерирует 128-битный случайный идентификатор в hex.
func newRequestID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand на практике не отказывает; заглушка нужна,
		// чтобы запрос не падал из-за телеметрии.
		return "0000000000000000"
	}
	return hex.EncodeToString(b[:])
}
