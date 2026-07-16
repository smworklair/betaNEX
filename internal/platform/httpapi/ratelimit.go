package httpapi

import (
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"

	"github.com/smworklair/betakis/internal/kernel/identity"
)

// rateLimiter — лимитер по ключу поверх golang.org/x/time/rate:
// token bucket на каждый ключ (IP+email для логина). Живёт в памяти
// процесса — достаточен против перебора паролей на одном инстансе;
// при втором инстансе счётчики переедут в Valkey (ADR-008).
type rateLimiter struct {
	limit rate.Limit
	burst int
	now   func() time.Time

	mu       sync.Mutex
	limiters map[string]*limiterEntry
}

type limiterEntry struct {
	lim  *rate.Limiter
	seen time.Time
}

// newRateLimiter создаёт лимитер: burst попыток сразу, дальше пополнение
// со скоростью limit.
func newRateLimiter(burst int, per time.Duration) *rateLimiter {
	return &rateLimiter{
		limit:    rate.Every(per / time.Duration(burst)),
		burst:    burst,
		now:      time.Now,
		limiters: make(map[string]*limiterEntry),
	}
}

// allow сообщает, разрешено ли ещё одно событие для ключа, и учитывает его.
func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	l.sweep(now)

	e := l.limiters[key]
	if e == nil {
		e = &limiterEntry{lim: rate.NewLimiter(l.limit, l.burst)}
		l.limiters[key] = e
	}
	e.seen = now
	return e.lim.Allow()
}

// reset забывает ключ — вызывается после успешного входа, чтобы
// легитимный пользователь не упирался в лимит из-за старых опечаток.
func (l *rateLimiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.limiters, key)
}

// sweep удаляет давно не встречавшиеся ключи, не давая карте расти
// бесконечно. Вызывается под мьютексом.
func (l *rateLimiter) sweep(now time.Time) {
	if len(l.limiters) < 4096 {
		return
	}
	for k, e := range l.limiters {
		if now.Sub(e.seen) > time.Hour {
			delete(l.limiters, k)
		}
	}
}

// mutationBurst/mutationWindow — лимит на мутирующие запросы вне
// /auth/login (у которого свой, более строгий лимитер, см. auth.go).
// Достаточно щедрый, чтобы не мешать обычной работе (массовый импорт
// финансов, пакетная загрузка файлов) — это страховка от скриптового
// злоупотребления/DoS, а не троттлинг легитимной нагрузки.
const (
	mutationBurst  = 120
	mutationWindow = time.Minute
)

// mutationRateLimit — общий лимитер на все мутирующие запросы
// (POST/PUT/PATCH/DELETE), которых раньше не касался ни один лимитер
// (см. аудит: finance/files/tasks/campus/terminal exec были без единой
// защиты от злоупотребления). Ключ — ID аутентифицированного актора,
// если он есть; иначе IP.
//
// Актор, а не IP — намеренно: прод стоит за Caddy (см. clientIP,
// комментарий про X-Forwarded-For), и все запросы приходят с одного и
// того же внутреннего IP реверс-прокси. Лимитер по IP там выродился бы
// в общий лимит на всё приложение сразу — троттлинг по актору не имеет
// этой проблемы и вдобавок точнее: он бьёт по конкретному
// скомпрометированному/скриптовому аккаунту, а не по всем, кто сидит
// за одним IP.
func mutationRateLimit(limiter *rateLimiter) middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			key := clientIP(r)
			if actor, ok := identity.ActorFrom(r.Context()); ok && actor.ID != "" {
				key = "actor:" + actor.ID
			}
			if !limiter.allow(key) {
				WriteProblem(w, http.StatusTooManyRequests, "Слишком много запросов", "повторите чуть позже")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
