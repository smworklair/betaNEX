package httpapi

import (
	"sync"
	"time"
)

// rateLimiter — счётчик с фиксированным окном: не более limit событий
// на ключ за window. Достаточен против перебора паролей на одном
// инстансе; распределённый лимитер появится вместе со вторым инстансом
// (тогда же, когда и Valkey — ADR-008).
type rateLimiter struct {
	limit  int
	window time.Duration
	now    func() time.Time

	mu      sync.Mutex
	buckets map[string]*bucket
}

type bucket struct {
	count int
	start time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{
		limit:   limit,
		window:  window,
		now:     time.Now,
		buckets: make(map[string]*bucket),
	}
}

// allow сообщает, разрешено ли ещё одно событие для ключа, и учитывает его.
func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	l.sweep(now)

	b := l.buckets[key]
	if b == nil || now.Sub(b.start) >= l.window {
		l.buckets[key] = &bucket{count: 1, start: now}
		return true
	}
	b.count++
	return b.count <= l.limit
}

// reset забывает ключ — вызывается после успешного входа, чтобы
// легитимный пользователь не упирался в лимит из-за старых опечаток.
func (l *rateLimiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.buckets, key)
}

// sweep удаляет истёкшие окна, не давая карте расти бесконечно.
// Вызывается под мьютексом.
func (l *rateLimiter) sweep(now time.Time) {
	if len(l.buckets) < 4096 {
		return
	}
	for k, b := range l.buckets {
		if now.Sub(b.start) >= l.window {
			delete(l.buckets, k)
		}
	}
}
