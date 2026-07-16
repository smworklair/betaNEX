package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"
)

// RouterConfig описывает, из чего собирается роутер NEX. Заполняется
// композиционным корнем (cmd/nexd): именно он решает, какие модули
// смонтировать, какие зависимости проверять в /readyz и включать ли
// dev-аутентификацию.
type RouterConfig struct {
	// Readiness — проверки готовности зависимостей для /readyz
	// (Postgres и т.п.). Пустой список означает «готов всегда».
	Readiness []ReadinessCheck

	// DevAuth включает временную подмену аутентификации заголовками
	// X-Dev-* (см. devauth.go). Устанавливается только в development;
	// с появлением настоящих сессий (веха M3) исчезнет.
	DevAuth bool

	// ResolveTenant нормализует идентификатор tenant'а из запроса
	// (например, slug → UUID) до того, как он попадёт в команды и SQL.
	// nil означает «использовать как есть» (in-memory режим).
	ResolveTenant func(ctx context.Context, v string) (string, error)

	// Auth подключает настоящую аутентификацию: endpoints /api/v1/auth/*
	// и session-middleware. nil — без неё (in-memory режим, dev-заголовки).
	Auth *AuthConfig

	// CORS — кросс-доменная политика и allowlist CSRF-проверки.
	// Пустой список origin'ов = только same-origin.
	CORS CORSConfig

	// OpenAPI — YAML-спека контракта; раздаётся по GET /api/v1/openapi.yaml.
	// nil — маршрут не монтируется.
	OpenAPI []byte

	// Observe вызывается по завершении каждого запроса — сюда композиционный
	// корень подставляет запись метрик. route — шаблон маршрута ServeMux
	// ("GET /api/v1/finance/accounts"), а не сырой путь: кардинальность
	// метрик не растёт с числом ID.
	Observe func(route string, status int, dur time.Duration)

	// Pprof монтирует /debug/pprof/* (только development).
	Pprof bool

	// Idempotency включает поддержку заголовка Idempotency-Key для
	// мутирующих запросов (offline-синхронизация, ретраи). nil = выкл.
	Idempotency IdempotencyStore

	// Mount — функции монтирования маршрутов модулей. Каждый модуль
	// отдаёт свою функцию (например, finance.Routes), а корень передаёт
	// их сюда — так httpapi не знает о конкретных модулях.
	Mount []func(mux *http.ServeMux)
}

// NewRouter builds the complete HTTP handler for NEX: the route table wrapped
// in the standard middleware chain. As kernel features and modules are added,
// their routes will be registered here.
//
// Middleware order is deliberate. securityHeaders sits right after cors so
// every response — including ones from requestID/recoverer — carries the
// baseline protection headers. requestID is next so every log line and
// audit record of the request can carry the same identifier. requestLogger
// observes the final status of every request, including a 500 produced by
// recoverer. recoverer sits closest to the handlers so it catches panics from
// any of them.
func NewRouter(log *slog.Logger, cfg RouterConfig) http.Handler {
	mux := http.NewServeMux()

	// Method-based routing (Go 1.22+): a request to /healthz with any method
	// other than GET receives a 405 automatically.
	mux.Handle("GET /healthz", handleHealthz())
	mux.Handle("GET /readyz", handleReadyz(cfg.Readiness))

	var authLayer *authAPI
	if cfg.Auth != nil {
		authLayer = newAuthAPI(*cfg.Auth)
		authLayer.mount(mux)
	}
	if cfg.Pprof {
		mountPprof(mux)
	}
	if cfg.OpenAPI != nil {
		mux.Handle("GET /api/v1/openapi.yaml", handleOpenAPI(cfg.OpenAPI))
	}
	for _, mount := range cfg.Mount {
		mount(mux)
	}

	// Порядок цепочки: сессия аутентифицирует первой; dev-заголовки могут
	// подменить актора только там, где включены; резолвер tenant'а
	// нормализует то, что положили предыдущие слои. csrfGuard режет
	// мутирующие запросы с чужим Origin раньше аутентификации: cookie
	// жертвы не должна успеть превратиться в актора. В development
	// стража нет: Vite-прокси шлёт Origin дев-сервера (5173) на другой
	// Host, а режим и так позволяет подменять актора dev-заголовками —
	// защищать там нечего.
	mws := []middleware{securityHeaders(), requestID(), requestLogger(log), recoverer(log)}
	if !cfg.DevAuth {
		mws = append(mws, csrfGuard(cfg.CORS))
	}
	if cfg.Observe != nil {
		// observer — внешним слоем: recoverer ниже превращает панику в 500,
		// и метрика честно учитывает её как 500.
		mws = append([]middleware{observer(mux, cfg.Observe)}, mws...)
	}
	// CORS — самым внешним слоем: preflight отвечается до логирования
	// метрик по маршрутам, а заголовки доступа стоят даже на панике.
	mws = append([]middleware{cors(cfg.CORS)}, mws...)
	if authLayer != nil {
		mws = append(mws, authLayer.sessionIdentity())
	}
	if cfg.DevAuth {
		mws = append(mws, devIdentity())
	}
	if cfg.ResolveTenant != nil {
		mws = append(mws, tenantResolver(cfg.ResolveTenant))
	}
	if cfg.Idempotency != nil {
		// Внутренним слоем: ключ хранится в разрезе окончательного
		// (уже разрешённого) tenant'а.
		mws = append(mws, idempotency(cfg.Idempotency))
	}
	return chain(mux, mws...)
}
