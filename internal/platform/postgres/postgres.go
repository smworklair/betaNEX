package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// connectTimeout ограничивает первый пинг при старте: неверный DSN или
// упавшая БД диагностируются быстро, а не по сетевому таймауту.
const connectTimeout = 5 * time.Second

// DB — подключение процесса к PostgreSQL: пул pgx плюс операции
// платформенного уровня (транзакции с tenant-контекстом, миграции,
// readiness-пинг). Создаётся один раз в композиционном корне.
type DB struct {
	pool *pgxpool.Pool
}

// Connect создаёт пул соединений и проверяет его первым пингом, чтобы
// ошибка конфигурации проявилась на старте процесса, а не на первом
// запросе пользователя.
func Connect(ctx context.Context, dsn string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("postgres: parse dsn: %w", err)
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("postgres: create pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("postgres: ping: %w", err)
	}
	return &DB{pool: pool}, nil
}

// Close освобождает пул. Вызывается при остановке процесса.
func (d *DB) Close() { d.pool.Close() }

// Pool отдаёт нижележащий пул pgx — для кода, которому нужен прямой
// доступ (тесты, будущие фоновые задачи River). Прикладные запросы
// должны идти через InTenantTx, иначе RLS не увидит tenant'а.
func (d *DB) Pool() *pgxpool.Pool { return d.pool }

// Ready — проверка готовности для /readyz: БД отвечает на пинг.
func (d *DB) Ready(ctx context.Context) error {
	return d.pool.Ping(ctx)
}
