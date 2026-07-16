# internal/platform/httpapi/cors.go

Реализует кросс-доменную политику (CORS) и защиту от CSRF для API NEX. Оба механизма опираются на один и тот же allowlist разрешённых origin'ов, потому что API работает на cookie-сессиях: credentialed CORS не может использовать wildcard, а CSRF-защита строится на сверке `Origin` мутирующих запросов.

## Ключевое

- `CORSConfig` — конфигурация: `AllowedOrigins []string`, точные origin'ы (`scheme://host[:port]`) фронтендов, которым разрешён доступ с cookie. Пусто = только same-origin.
- `cors(cfg CORSConfig) middleware` — отвечает на preflight-запросы (`OPTIONS` с `Access-Control-Request-Method`) и проставляет `Access-Control-Allow-*` заголовки на всех ответах для разрешённых origin'ов, включая ошибочные (401/403/429) — иначе браузер не даст фронтенду прочитать тело ошибки.
- `csrfGuard(cfg CORSConfig) middleware` — отклоняет (403) мутирующие запросы (не GET/HEAD/OPTIONS), у которых `Origin` присутствует, не совпадает с `Host` запроса и не входит в allowlist.
- `originMatchesHost(origin, host string) bool` — сравнивает host заголовка `Origin` с `Host` запроса для распознавания same-origin без явной настройки.
- `allowedHeaders`, `allowedMethods` — константы для заголовков preflight-ответа.

## Как это работает

`cors` пропускает запросы без заголовка `Origin` без изменений (не браузер — curl, серверные клиенты). Для разрешённого origin'а ставит `Access-Control-Allow-Origin`/`Access-Control-Allow-Credentials`, а на preflight (OPTIONS с `Access-Control-Request-Method`) сразу отвечает 204 с методами/заголовками/`Max-Age`. `csrfGuard` защищает от классической CSRF-атаки: чужой сайт может заставить браузер жертвы отправить мутирующий запрос с её cookie, но не может подделать заголовок `Origin` — поэтому запрос с чужим или отсутствующим (для не-браузерных клиентов — пропускается) Origin проверяется по allowlist.

## Связи

Использует только `net/http`, `net/url`, `strings`. Подключается в `routes.go`: `cors` — самым внешним слоем цепочки middleware (preflight отвечается раньше логирования и метрик), `csrfGuard` — ближе к аутентификации, но раньше `sessionIdentity` (cookie жертвы не должна успеть стать актором). В development (`cfg.DevAuth`) `csrfGuard` не подключается вовсе — комментарий в routes.go объясняет, что Vite-прокси меняет Host, а dev-заголовки и так позволяют подменить актора.

## На что обратить внимание

`csrfGuard` полагается на то, что `Origin` подделать скриптом нельзя (в отличие от кастомных заголовков или тела запроса) — это современная и достаточная защита от CSRF без токенов. Запрос без `Origin` пропускается сознательно: не-браузерные клиенты не несут cookie жертвы автоматически, поэтому угрозы CSRF для них нет.
