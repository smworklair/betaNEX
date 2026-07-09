package httpapi

import (
	"bytes"
	"context"
	"net/http"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
)

// idemMaxBody — предел размера ответа, который сохраняется для повтора.
const idemMaxBody = 1 << 20 // 1 МБ

// IdemState — состояние клиентского ключа идемпотентности.
type IdemState struct {
	Fresh      bool // ключ новый: запрос исполняется
	InProgress bool // тот же ключ сейчас выполняется другим запросом
	Done       bool // запрос уже завершён: отдаём сохранённый ответ

	Status      int
	ContentType string
	Body        []byte
}

// IdempotencyStore хранит ключи и ответы завершённых запросов.
// Реализация — platform/postgres (переживает рестарт процесса,
// что и требуется офлайн-клиентам).
type IdempotencyStore interface {
	Begin(ctx context.Context, key string) (IdemState, error)
	Complete(ctx context.Context, key string, status int, contentType string, body []byte) error
	Forget(ctx context.Context, key string) error
}

// idempotency — middleware: запись с заголовком Idempotency-Key
// исполняется не более одного раза на ключ в пределах tenant'а.
// Повтор (очередь офлайн-клиента, сетевой ретрай) получает сохранённый
// ответ с пометкой Idempotency-Replayed. Ответы 5xx не кэшируются —
// повтор честно исполняет запрос заново.
func idempotency(store IdempotencyStore) middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := r.Header.Get("Idempotency-Key")
			if key == "" || len(key) > 200 || !isMutating(r.Method) {
				next.ServeHTTP(w, r)
				return
			}
			if _, ok := tenancy.TenantFrom(r.Context()); !ok {
				next.ServeHTTP(w, r) // без tenant'а ключ негде хранить
				return
			}

			state, err := store.Begin(r.Context(), key)
			if err != nil {
				WriteProblem(w, http.StatusInternalServerError, "Внутренняя ошибка", err.Error())
				return
			}
			switch {
			case state.Done:
				w.Header().Set("Idempotency-Replayed", "true")
				if state.ContentType != "" {
					w.Header().Set("Content-Type", state.ContentType)
				}
				w.WriteHeader(state.Status)
				_, _ = w.Write(state.Body)
				return
			case state.InProgress:
				WriteProblem(w, http.StatusConflict, "Запрос уже выполняется",
					"повторите позже с тем же Idempotency-Key")
				return
			}

			rec := &bufferingRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)

			switch {
			case rec.status >= 500 || rec.tooBig:
				// Не кэшируем: клиент имеет право повторить и получить
				// новую попытку исполнения.
				_ = store.Forget(r.Context(), key)
			default:
				_ = store.Complete(r.Context(), key, rec.status,
					rec.Header().Get("Content-Type"), rec.buf.Bytes())
			}
		})
	}
}

func isMutating(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	}
	return false
}

// bufferingRecorder пропускает ответ клиенту и параллельно копит его
// (до idemMaxBody) для сохранения в хранилище ключей.
type bufferingRecorder struct {
	http.ResponseWriter
	status  int
	written bool
	buf     bytes.Buffer
	tooBig  bool
}

func (r *bufferingRecorder) WriteHeader(code int) {
	if !r.written {
		r.status = code
		r.written = true
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *bufferingRecorder) Write(b []byte) (int, error) {
	if !r.written {
		r.status = http.StatusOK
		r.written = true
	}
	if !r.tooBig {
		if r.buf.Len()+len(b) > idemMaxBody {
			r.tooBig = true
			r.buf.Reset()
		} else {
			r.buf.Write(b)
		}
	}
	return r.ResponseWriter.Write(b)
}
