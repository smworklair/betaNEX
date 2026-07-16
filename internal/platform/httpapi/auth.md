# internal/platform/httpapi/auth.go

HTTP-слой аутентификации по cookie-сессиям: логин, логаут, "кто я" и middleware, превращающий валидную cookie в актора запроса. Это основной (production) механизм аутентификации, в отличие от временных dev-заголовков из devauth.go.

## Ключевое

- `AuthConfig` — конфигурация слоя: сервис аутентификации ядра (`*auth.Service`), TTL сессии/cookie, резолвер tenant'а (slug → UUID), флаги `SecureCookie`/`SameSite`, писатель аудита.
- `authAPI` — состояние HTTP-слоя: конфиг плюс лимитер попыток входа.
- `newAuthAPI(cfg AuthConfig) *authAPI` — создаёт слой с лимитером: не более 10 неудачных попыток за 5 минут на пару IP+email (защита от перебора паролей).
- `(*authAPI) mount(mux)` — регистрирует `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`.
- `(*authAPI) sessionIdentity() middleware` — по cookie `nex_session` кладёт в контекст запроса актора и tenant, если сессия ещё не была установлена вышестоящим слоем. Невалидная cookie не обрывает запрос — он идёт дальше анонимным.
- `sessionCookie = "nex_session"` — имя httpOnly-cookie сессии.
- `clientIP(r) string` — извлекает IP клиента из `RemoteAddr` (без чтения заголовков прокси — сознательно отложено до hardening).

## Как это работает

`handleLogin` валидирует тело запроса, проверяет rate limit по ключу IP+email, резолвит tenant (если задан `ResolveTenant`), вызывает `auth.Service.Login`, при успехе сбрасывает лимитер, пишет аудит-запись и ставит cookie сессии. Ошибки неизвестного tenant'а и неверного пароля намеренно возвращают одинаковый ответ 401 — чтобы не раскрывать список организаций снаружи. `handleLogout` гасит cookie независимо от результата вызова сервиса (логаут идемпотентен). `handleMe` проверяет cookie через `AuthenticateTouch`, при необходимости продлевает и cookie, и серверную сессию (скользящее окно). `sessionIdentity` делает то же самое как middleware для всех остальных маршрутов, только не перезаписывает актора, если он уже есть в контексте (например, из dev-заголовков).

## Связи

Зависит от `internal/kernel/auth` (`*auth.Service`, `ErrInvalidCredentials`, `ErrSessionInvalid`), `internal/kernel/identity` (`Actor`, `WithActor`, `ActorFrom`), `internal/kernel/tenancy` (`WithTenant`, `TenantFrom`), `internal/kernel/audit` (`Recorder`, `Entry`, `Outcome`). Использует `rateLimiter` из ratelimit.go и `WriteProblem`/`WriteJSON` из problem.go. Монтируется и подключается в цепочку middleware из routes.go (`cfg.Auth`, `authLayer.sessionIdentity()`). Конкурирует по смыслу с devauth.go — оба слоя кладут актора в контекст, но `sessionIdentity` уважает уже установленного актора.

## На что обратить внимание

`SameSite=None` (для кросс-доменного фронтенда на другом домене) автоматически форсирует `Secure=true` в `cookie()` — так требуют браузеры, иначе cookie с `SameSite=None` без `Secure` отвергается целиком. Порядок в `routes.go` важен: `sessionIdentity` должен идти после `csrfGuard`, чтобы cookie жертвы не успела превратиться в актора при CSRF-атаке.
