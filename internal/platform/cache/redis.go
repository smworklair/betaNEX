package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Redis — сетевая реализация Cache (ADR-008: интерфейс был заложен
// заранее именно ради такого апгрейда без переписывания вызывающего
// кода). Работает поверх любого сервера, говорящего протоколом Redis
// (RESP) — как с самим Redis, так и с его open-source форком Valkey
// (см. compose.yaml, сервис valkey и обновлённый ADR-008 в
// docs/decision-log.md про причину выбора образа Valkey при клиенте
// go-redis).
//
// Нужна, когда nexd работает больше чем одним инстансом: Memory
// (memory.go) кэширует данные только в своём процессе, и второй
// инстанс за балансировщиком видел бы половину кэш-хитов и мог отдать
// устаревшие данные после инвалидации на первом.
type Redis struct {
	client *redis.Client
}

// Проверка соответствия интерфейсу на этапе компиляции.
var _ Cache = (*Redis)(nil)

// NewRedis оборачивает уже сконфигурированный клиент. Владение клиентом
// (в частности, Close при остановке процесса) остаётся у вызывающего —
// composition root создаёт клиент и должен его же закрыть.
func NewRedis(client *redis.Client) *Redis {
	return &Redis{client: client}
}

// Get возвращает значение, если оно есть и не истекло. Любая ошибка
// (включая cache-miss redis.Nil и обрыв соединения) трактуется как
// промах: кэш — это оптимизация, а не источник истины, отказ Redis не
// должен ронять запрос, который и без кэша можно обслужить.
func (c *Redis) Get(ctx context.Context, key string) ([]byte, bool) {
	val, err := c.client.Get(ctx, key).Bytes()
	if err != nil {
		return nil, false
	}
	return val, true
}

// Set сохраняет значение с TTL. Ошибка записи молча проглатывается по
// той же причине, что и в Get — см. её докстринг.
func (c *Redis) Set(ctx context.Context, key string, val []byte, ttl time.Duration) {
	if ttl <= 0 {
		return
	}
	_ = c.client.Set(ctx, key, val, ttl).Err()
}

// Delete удаляет запись (инвалидация после изменения данных).
func (c *Redis) Delete(ctx context.Context, key string) {
	_ = c.client.Del(ctx, key).Err()
}

// Ping — проверка готовности для /readyz (см. httpapi.ReadinessCheck в
// cmd/nexd/main.go): если Redis недоступен, инстанс не должен
// объявлять себя готовым принимать трафик, который зависит от кэша.
func (c *Redis) Ping(ctx context.Context) error {
	if err := c.client.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis: %w", err)
	}
	return nil
}
