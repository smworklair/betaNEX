# internal/kernel/auth/auth.go

Ядро аутентификации NEX: сервис `Service`, реализующий сценарии логина, проверки токена сессии и логаута поверх абстрактного хранилища `Store`. Это доменная логика без HTTP — транспорт (cookie, роуты) находится в `internal/platform/httpapi`, а хранение — в `internal/platform/postgres`.

## Ключевое

- `ErrInvalidCredentials`, `ErrSessionInvalid`, `ErrNoUser` — ошибки аутентификации, проверяемые через `errors.Is`. `ErrInvalidCredentials` единая на все причины отказа логина (пользователь не найден, неверный пароль, деактивирован), чтобы ответ не раскрывал, что именно не так.
- `User` — учётная запись в tenant'е: ID, TenantID, Email, DisplayName, Roles, PasswordHash, Active.
- `Session` — server-side сессия: TenantID, UserID, хэш токена (`TokenHash`, не сам токен), время истечения.
- `Store` — интерфейс хранилища пользователей и сессий (реализация в `platform/postgres`): поиск пользователя по email/ID, создание/чтение/отзыв/продление сессии.
- `Service` / `NewService(store, ttl)` — конструктор сервиса аутентификации с заданным TTL сессии.
- `(*Service) Login(ctx, email, password) (token string, u User, err error)` — проверяет учётные данные в tenant'е из контекста, создаёт сессию, возвращает opaque-токен (единственный раз в открытом виде).
- `(*Service) Authenticate(ctx, token) (User, error)` — проверяет токен, возвращает пользователя сессии.
- `(*Service) AuthenticateTouch(ctx, token) (User, refreshed bool, error)` — то же, что `Authenticate`, но со скользящим продлением сессии; `refreshed=true` означает, что cookie стоит перевыпустить.
- `(*Service) Logout(ctx, token) error` — отзывает сессию (идемпотентно).
- `dummyHash` — заранее вычисленный argon2-хэш фиктивного пароля, используемый для выравнивания времени ответа, когда пользователь не найден.
- `newToken()`, `hashToken()` — генерация 256-битного opaque-токена и его sha256-хэша (в БД хранится только хэш).

## Как это работает

`Login` берёт tenant из контекста (`tenancy.TenantFrom`), ищет пользователя по email; если пользователь не найден, всё равно прогоняет `VerifyPassword` против `dummyHash`, чтобы время ответа не отличалось от случая неверного пароля (защита от timing-атак, раскрывающих существование email). При успешной проверке пароля и активности пользователя генерируется случайный токен, в БД сохраняется только его sha256-хэш вместе с временем истечения. `AuthenticateTouch` ищет сессию по хэшу токена, находит пользователя уже в tenant'е сессии (`tenancy.WithTenant`), и если до истечения TTL осталось меньше половины срока — продлевает сессию best-effort (неудача продления не рвёт запрос, следующий запрос попробует снова). Таким образом активный пользователь никогда не разлогинивается, а украденный токен всё равно умирает не позже TTL после последнего использования.

## Связи

Зависит от `internal/kernel/tenancy` (получение/установка tenant'а в контексте) и от `password.go` того же пакета (`HashPassword`, `VerifyPassword`). От него зависят: `internal/platform/httpapi` (использует `Service` для HTTP-эндпоинтов логина/логаута/middleware), `internal/platform/postgres` (реализует интерфейс `Store`), `cmd/nexd/main.go` (создаёт `auth.NewService` и вызывает `auth.HashPassword` в CLI-подкоманде `user create`).

## На что обратить внимание

Единая ошибка `ErrInvalidCredentials` плюс `dummyHash`-трюк — это сознательная защита от enumeration-атак и timing-атак: злоумышленник не должен по разнице во времени ответа или тексту ошибки понять, существует ли аккаунт с данным email.
