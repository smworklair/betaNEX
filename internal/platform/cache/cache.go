// Package cache — in-process кэш с TTL (ADR-008: сетевой кэш появится
// только со вторым инстансом; интерфейс закладывается сейчас, чтобы
// апгрейд на Valkey не трогал вызывающий код).
//
// Ключи, зависящие от организации, обязаны включать tenant
// (cache.TenantKey) — иначе утечка данных между колледжами.
package cache

import (
	"context"
	"sync"
	"time"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
)

// Cache — контракт кэша. Реализации: Memory (сейчас), Valkey (при
// втором инстансе).
type Cache interface {
	Get(ctx context.Context, key string) ([]byte, bool)
	Set(ctx context.Context, key string, val []byte, ttl time.Duration)
	Delete(ctx context.Context, key string)
}

// TenantKey строит ключ, сегментированный по tenant'у из контекста.
// Без tenant'а возвращается false — кэшировать такое значение под общим
// ключом нельзя.
func TenantKey(ctx context.Context, key string) (string, bool) {
	tenant, ok := tenancy.TenantFrom(ctx)
	if !ok {
		return "", false
	}
	return tenant + "\x00" + key, true
}

// Memory — потокобезопасный кэш в памяти процесса с TTL и мягким
// ограничением размера. Достаточен для одного инстанса nexd.
type Memory struct {
	max int
	now func() time.Time

	mu sync.Mutex
	m  map[string]entry
}

type entry struct {
	val []byte
	exp time.Time
}

// Проверка соответствия интерфейсу на этапе компиляции.
var _ Cache = (*Memory)(nil)

// NewMemory создаёт кэш не более чем на max записей (0 = 4096).
func NewMemory(max int) *Memory {
	if max <= 0 {
		max = 4096
	}
	return &Memory{max: max, now: time.Now, m: make(map[string]entry)}
}

// Get возвращает значение, если оно есть и не истекло.
func (c *Memory) Get(_ context.Context, key string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[key]
	if !ok || c.now().After(e.exp) {
		delete(c.m, key)
		return nil, false
	}
	return e.val, true
}

// Set сохраняет значение на ttl. При переполнении сначала выбрасываются
// истёкшие записи, затем — ближайшие к истечению: честного LRU здесь
// нет намеренно, для кэша значений с TTL этого достаточно.
func (c *Memory) Set(_ context.Context, key string, val []byte, ttl time.Duration) {
	if ttl <= 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	if len(c.m) >= c.max {
		c.evict(now)
	}
	c.m[key] = entry{val: val, exp: now.Add(ttl)}
}

// Delete удаляет запись (инвалидация после изменения данных).
func (c *Memory) Delete(_ context.Context, key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.m, key)
}

// evict освобождает место: сперва истёкшие, затем ближайшие к
// истечению. Вызывается под мьютексом.
func (c *Memory) evict(now time.Time) {
	for k, e := range c.m {
		if now.After(e.exp) {
			delete(c.m, k)
		}
	}
	for len(c.m) >= c.max {
		var oldest string
		var oldestExp time.Time
		for k, e := range c.m {
			if oldest == "" || e.exp.Before(oldestExp) {
				oldest, oldestExp = k, e.exp
			}
		}
		delete(c.m, oldest)
	}
}
