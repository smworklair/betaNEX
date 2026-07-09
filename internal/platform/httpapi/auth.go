package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"time"

	"github.com/smworklair/betakis/internal/kernel/audit"
	"github.com/smworklair/betakis/internal/kernel/auth"
	"github.com/smworklair/betakis/internal/kernel/identity"
	"github.com/smworklair/betakis/internal/kernel/tenancy"
)

// sessionCookie — имя httpOnly-cookie с opaque-токеном сессии.
const sessionCookie = "nex_session"

// AuthConfig подключает аутентификацию к роутеру: endpoints
// /api/v1/auth/* и middleware, превращающий cookie сессии в актора.
type AuthConfig struct {
	// Service — сценарии аутентификации ядра.
	Service *auth.Service

	// TTL сессии: время жизни cookie (совпадает с TTL сессии в БД).
	TTL time.Duration

	// ResolveTenant переводит tenant из тела логина (slug) в UUID.
	// nil — значение используется как есть.
	ResolveTenant func(ctx context.Context, v string) (string, error)

	// SecureCookie ставит флаг Secure (обязателен в production).
	SecureCookie bool

	// Audit фиксирует входы и отказы (команды auth.login / auth.logout).
	Audit audit.Recorder
}

// authAPI — состояние HTTP-слоя аутентификации.
type authAPI struct {
	cfg     AuthConfig
	limiter *rateLimiter
}

// newAuthAPI создаёт слой с лимитером попыток входа: не более 10 неудач
// за 5 минут на пару IP+email — защита от перебора паролей.
func newAuthAPI(cfg AuthConfig) *authAPI {
	return &authAPI{cfg: cfg, limiter: newRateLimiter(10, 5*time.Minute)}
}

// mount регистрирует маршруты аутентификации.
func (a *authAPI) mount(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/auth/login", a.handleLogin)
	mux.HandleFunc("POST /api/v1/auth/logout", a.handleLogout)
	mux.HandleFunc("GET /api/v1/auth/me", a.handleMe)
}

// --- DTO ----------------------------------------------------------------------

type loginRequest struct {
	Tenant   string `json:"tenant"` // slug или UUID организации
	Email    string `json:"email"`
	Password string `json:"password"`
}

type userResponse struct {
	ID          string   `json:"id"`
	Email       string   `json:"email"`
	DisplayName string   `json:"display_name"`
	Roles       []string `json:"roles"`
	Tenant      string   `json:"tenant"`
}

// --- Хендлеры -----------------------------------------------------------------

func (a *authAPI) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		WriteProblem(w, http.StatusBadRequest, "Некорректный JSON", err.Error())
		return
	}
	if req.Tenant == "" || req.Email == "" || req.Password == "" {
		WriteProblem(w, http.StatusBadRequest, "Некорректный запрос", "tenant, email и password обязательны")
		return
	}

	key := clientIP(r) + "|" + req.Email
	if !a.limiter.allow(key) {
		a.recordLogin(r.Context(), req.Email, audit.OutcomeDenied, "rate limited")
		WriteProblem(w, http.StatusTooManyRequests, "Слишком много попыток",
			"повторите попытку позже")
		return
	}

	ctx := r.Context()
	tenantID := req.Tenant
	if a.cfg.ResolveTenant != nil {
		id, err := a.cfg.ResolveTenant(ctx, req.Tenant)
		if err != nil {
			// Неизвестный tenant не отличим снаружи от неверного пароля:
			// не раскрываем список организаций.
			a.recordLogin(ctx, req.Email, audit.OutcomeDenied, "unknown tenant")
			WriteProblem(w, http.StatusUnauthorized, "Вход отклонён", "неверные учётные данные")
			return
		}
		tenantID = id
	}
	ctx = tenancy.WithTenant(ctx, tenantID)

	token, user, err := a.cfg.Service.Login(ctx, req.Email, req.Password)
	if errors.Is(err, auth.ErrInvalidCredentials) {
		a.recordLogin(ctx, req.Email, audit.OutcomeDenied, "invalid credentials")
		WriteProblem(w, http.StatusUnauthorized, "Вход отклонён", "неверные учётные данные")
		return
	}
	if err != nil {
		WriteProblem(w, http.StatusInternalServerError, "Внутренняя ошибка", err.Error())
		return
	}

	a.limiter.reset(key)
	a.recordLoginAs(ctx, user.ID, audit.OutcomeOK, "")
	http.SetCookie(w, a.cookie(token, a.cfg.TTL))
	WriteJSON(w, http.StatusOK, userResponse{
		ID: user.ID, Email: user.Email, DisplayName: user.DisplayName,
		Roles: user.Roles, Tenant: user.TenantID,
	})
}

func (a *authAPI) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		if err := a.cfg.Service.Logout(r.Context(), c.Value); err != nil {
			WriteProblem(w, http.StatusInternalServerError, "Внутренняя ошибка", err.Error())
			return
		}
		if actor, ok := identity.ActorFrom(r.Context()); ok {
			a.recordLogoutAs(r.Context(), actor.ID)
		}
	}
	// Cookie гасится в любом случае: logout идемпотентен.
	http.SetCookie(w, a.cookie("", -time.Second))
	w.WriteHeader(http.StatusNoContent)
}

func (a *authAPI) handleMe(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		WriteProblem(w, http.StatusUnauthorized, "Не аутентифицирован", "нет сессии")
		return
	}
	user, err := a.cfg.Service.Authenticate(r.Context(), c.Value)
	if errors.Is(err, auth.ErrSessionInvalid) {
		WriteProblem(w, http.StatusUnauthorized, "Не аутентифицирован", "сессия недействительна")
		return
	}
	if err != nil {
		WriteProblem(w, http.StatusInternalServerError, "Внутренняя ошибка", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, userResponse{
		ID: user.ID, Email: user.Email, DisplayName: user.DisplayName,
		Roles: user.Roles, Tenant: user.TenantID,
	})
}

// sessionIdentity — middleware: превращает валидную cookie сессии в
// актора и tenant запроса. Невалидная сессия не обрывает запрос —
// он идёт дальше анонимным, и его остановит авторизация команд.
func (a *authAPI) sessionIdentity() middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			if _, has := identity.ActorFrom(ctx); !has {
				if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
					if user, err := a.cfg.Service.Authenticate(ctx, c.Value); err == nil {
						ctx = identity.WithActor(ctx, identity.Actor{ID: user.ID, Roles: user.Roles})
						ctx = tenancy.WithTenant(ctx, user.TenantID)
					}
				}
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// --- Вспомогательные -----------------------------------------------------------

// cookie строит cookie сессии. Отрицательный ttl гасит её.
// Secure управляется окружением: в production всегда true
// (см. AuthConfig.SecureCookie в композиционном корне), в development
// false — локальная разработка идёт по http.
func (a *authAPI) cookie(token string, ttl time.Duration) *http.Cookie {
	return &http.Cookie{ // #nosec G124 -- HttpOnly/SameSite заданы, Secure=true в production
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   int(ttl.Seconds()),
		HttpOnly: true,
		Secure:   a.cfg.SecureCookie,
		SameSite: http.SameSiteLaxMode,
	}
}

// recordLogin фиксирует исход попытки входа; актор — email (ID ещё нет).
func (a *authAPI) recordLogin(ctx context.Context, email string, outcome audit.Outcome, detail string) {
	a.record(ctx, "auth.login", email, outcome, detail)
}

// recordLoginAs фиксирует успешный вход от имени найденного пользователя.
func (a *authAPI) recordLoginAs(ctx context.Context, userID string, outcome audit.Outcome, detail string) {
	a.record(ctx, "auth.login", userID, outcome, detail)
}

func (a *authAPI) recordLogoutAs(ctx context.Context, userID string) {
	a.record(ctx, "auth.logout", userID, audit.OutcomeOK, "")
}

func (a *authAPI) record(ctx context.Context, cmd, actor string, outcome audit.Outcome, detail string) {
	if a.cfg.Audit == nil {
		return
	}
	e := audit.Entry{
		Command:    cmd,
		Outcome:    outcome,
		ActorID:    actor,
		Detail:     detail,
		OccurredAt: time.Now().UTC(),
	}
	if tenant, ok := tenancy.TenantFrom(ctx); ok {
		e.TenantID = tenant
	}
	_ = a.cfg.Audit.Record(ctx, e) // best-effort: вход важнее следа о нём
}

// clientIP возвращает IP клиента без порта. Заголовки прокси здесь
// сознательно не читаются: доверие к X-Forwarded-For настраивается
// на этапе hardening (M11), когда известна топология прода.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
