package httpapi

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
)

// gatewaySecretHeader — заголовок, которым nexd подписывает запрос к
// ai-gateway (см. ai-gateway/app/deps.py:GATEWAY_SECRET_HEADER — имя
// должно совпадать дословно на обеих сторонах).
const gatewaySecretHeader = "X-Gateway-Secret"

// AIGatewayConfig описывает прокси nexd → ai-gateway.
//
// До этого браузер обращался к ai-gateway напрямую, а тот доверял
// заголовку X-Tenant-Id как есть — любой клиент, достучавшийся до
// шлюза, мог вписать туда чужого тенанта и обойти его бюджет (см.
// ai-gateway/app/deps.py:get_tenant_id). Теперь браузер ходит только в
// nexd — тот же origin, что и остальной /api/v1/*, с той же
// cookie-сессией, — а nexd сам подставляет tenant_id из уже
// аутентифицированного актора и подписывает запрос секретом, общим с
// ai-gateway (NEX_AI_GATEWAY_SECRET). Подделать заголовок с уровня
// браузера так же нельзя, как подделать чужой актор в остальном API.
type AIGatewayConfig struct {
	// URL — внутренний адрес ai-gateway (например http://ai-gateway:8090
	// в docker-сети, см. deploy/compose.prod.yaml). Пусто = прокси не
	// монтируется вовсе, и ИИ-эндпоинты не регистрируются — так демо/дев
	// окружения без ai-gateway продолжают работать как раньше.
	URL string

	// Secret — общий с ai-gateway секрет (см. ai-gateway .env:
	// NEX_AI_GATEWAY_SECRET / Settings.gateway_shared_secret). Пусто —
	// заголовок X-Gateway-Secret не проставляется: совместимо с
	// ai-gateway, у которого секрет тоже не настроен (локальная
	// разработка без общего секрета).
	Secret string
}

// MountAIGateway строит функцию монтирования обратного прокси
// /api/v1/ai/* → ai-gateway. cfg.URL пустой — ничего не монтирует.
//
// Маршруты 1:1 повторяют собственные пути ai-gateway (см.
// ai-gateway/app/api/routes.py), кроме /healthz: у ai-gateway он без
// префикса, а фронтенд ходит по единому префиксу /api/v1/ai/*, поэтому
// путь переписывается в Director.
func MountAIGateway(cfg AIGatewayConfig, log *slog.Logger) func(mux *http.ServeMux) {
	if cfg.URL == "" {
		return func(*http.ServeMux) {}
	}

	target, err := url.Parse(cfg.URL)
	if err != nil {
		// Композиционный корень обязан провалидировать NEX_AI_GATEWAY_URL
		// до вызова (см. config.validate) — сюда попадает уже
		// гарантированно разбираемый URL; ошибка тут означает баг сборки,
		// а не рантайм-состояние.
		panic(fmt.Sprintf("httpapi: invalid AIGatewayConfig.URL %q: %v", cfg.URL, err))
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	baseDirector := proxy.Director
	proxy.Director = func(r *http.Request) {
		baseDirector(r)
		if r.URL.Path == "/api/v1/ai/healthz" {
			r.URL.Path = "/healthz"
		}
		// tenant всегда присутствует: handler ниже уже проверил его через
		// requireActor/tenancy до вызова proxy.ServeHTTP.
		tenant, _ := tenancy.TenantFrom(r.Context())
		r.Header.Set("X-Tenant-Id", tenant)
		// Тот же request_id, что nexd использует в своих логах (requestID
		// middleware, requestid.go) — сквозной идентификатор запроса
		// пробрасывается в ai-gateway тем же заголовком, чтобы одна
		// строка в логах nexd и одна строка в логах ai-gateway отвечали
		// одному и тому же запросу пользователя. Перезаписываем заголовок
		// явно (а не полагаемся на то, что клиент его уже прислал):
		// requestID мог сгенерировать новый id, если входящий был пуст
		// или подозрительно длинный.
		r.Header.Set(requestIDHeader, RequestIDFrom(r.Context()))
		if cfg.Secret != "" {
			r.Header.Set(gatewaySecretHeader, cfg.Secret)
		}
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.LogAttrs(r.Context(), slog.LevelError, "ai-gateway proxy error", slog.String("error", err.Error()))
		WriteProblem(w, http.StatusBadGateway, "ИИ-шлюз недоступен", "")
	}

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !requireActor(w, r) {
			return
		}
		if _, ok := tenancy.TenantFrom(r.Context()); !ok {
			WriteProblem(w, http.StatusBadRequest, "Не указан tenant", "")
			return
		}
		// Общий WriteTimeout сервера (NEX_HTTP_WRITE_TIMEOUT, по
		// умолчанию 15с — см. server.go) рассчитан на обычные API-ответы
		// и оборвал бы более долгий ответ модели или SSE-стрим
		// на середине. Именно для /ask и /stream это единственный
		// маршрут, которому нужен более долгий бюджет — снимаем дедлайн
		// точечно, не трогая защиту остальных ~30 маршрутов API.
		_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
		proxy.ServeHTTP(w, r)
	})

	return func(mux *http.ServeMux) {
		mux.Handle("POST /api/v1/ai/ask", handler)
		mux.Handle("POST /api/v1/ai/stream", handler)
		mux.Handle("GET /api/v1/ai/providers", handler)
		mux.Handle("GET /api/v1/ai/healthz", handler)
	}
}
