package httpapi

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
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
