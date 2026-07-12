package httpapi

import (
	"net/http"
	"net/url"
	"strings"
)

// CORSConfig описывает кросс-доменную политику API. NEX работает на
// cookie-сессиях, поэтому политика всегда credentialed: wildcard-origin
// невозможен по спецификации, разрешаются только перечисленные origin'ы.
//
// Тот же список служит allowlist'ом CSRF-проверки: мутирующий запрос,
// пришедший из браузера с чужим Origin, отклоняется до хендлера.
type CORSConfig struct {
	// AllowedOrigins — точные origin'ы (scheme://host[:port]) фронтендов,
	// которым разрешён credentialed-доступ. Пусто = только same-origin.
	AllowedOrigins []string
}

// allowedHeaders — заголовки, которые фронтенд шлёт помимо simple headers.
const allowedHeaders = "Content-Type, Accept, Idempotency-Key, X-Request-Id"

// allowedMethods — методы API; перечисляются в ответе preflight.
const allowedMethods = "GET, POST, PATCH, PUT, DELETE, OPTIONS"

// cors отвечает на preflight-запросы и проставляет CORS-заголовки на
// обычных ответах. Ставится внешним слоем цепочки: заголовки нужны и на
// ошибках (401/403/429), иначе браузер не даст фронтенду прочитать тело
// проблемы. Запросы без Origin (curl, серверные клиенты, same-origin
// навигация) проходят нетронутыми.
func cors(cfg CORSConfig) middleware {
	allowed := make(map[string]struct{}, len(cfg.AllowedOrigins))
	for _, o := range cfg.AllowedOrigins {
		allowed[strings.ToLower(strings.TrimSuffix(o, "/"))] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin == "" {
				next.ServeHTTP(w, r)
				return
			}
			// Ответ зависит от Origin — кэши обязаны это учитывать.
			w.Header().Add("Vary", "Origin")

			if _, ok := allowed[strings.ToLower(origin)]; !ok {
				// Чужой origin: заголовки не ставим — браузер сам заблокирует
				// чтение ответа. Мутации дополнительно режет csrfGuard.
				next.ServeHTTP(w, r)
				return
			}

			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Credentials", "true")

			if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				h.Set("Access-Control-Allow-Methods", allowedMethods)
				h.Set("Access-Control-Allow-Headers", allowedHeaders)
				h.Set("Access-Control-Max-Age", "600") // 10 минут без повторных preflight
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// csrfGuard отклоняет мутирующие браузерные запросы с чужим Origin.
// Cookie-аутентификация уязвима к CSRF: чужой сайт может отправить POST
// с cookie жертвы. Современная защита — сверка Origin (браузер выставляет
// его на все не-GET запросы и подделать его скриптом нельзя):
//
//   - Origin совпадает с хостом запроса или входит в allowlist → пропустить;
//   - Origin есть и чужой → 403 до всякой работы;
//   - Origin нет (curl, серверные интеграции, старые клиенты) → пропустить:
//     не-браузерные клиенты не несут cookie жертвы автоматически.
//
// GET/HEAD/OPTIONS не мутируют и не проверяются (SameSite-cookie плюс
// authz на чтение закрывают чтение).
func csrfGuard(cfg CORSConfig) middleware {
	allowed := make(map[string]struct{}, len(cfg.AllowedOrigins))
	for _, o := range cfg.AllowedOrigins {
		allowed[strings.ToLower(strings.TrimSuffix(o, "/"))] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			origin := r.Header.Get("Origin")
			if origin == "" || originMatchesHost(origin, r.Host) {
				next.ServeHTTP(w, r)
				return
			}
			if _, ok := allowed[strings.ToLower(origin)]; ok {
				next.ServeHTTP(w, r)
				return
			}
			WriteProblem(w, http.StatusForbidden, "Запрос отклонён",
				"origin запроса не входит в список разрешённых (CSRF-защита)")
		})
	}
}

// originMatchesHost сравнивает host[:port] заголовка Origin с Host
// запроса — так распознаётся same-origin запрос без настройки.
func originMatchesHost(origin, host string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Host, host)
}
