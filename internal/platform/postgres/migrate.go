package postgres

import (
	"context"
	"database/sql"
	"fmt"

	// Регистрирует драйвер database/sql "pgx" для goose: сам goose
	// работает поверх database/sql, а не pgx-пула.
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/smworklair/betakis/migrations"
)

// migrateLockID — ключ advisory-блокировки миграций (произвольная
// константа, общая для всех процессов NEX).
const migrateLockID = 874002319

// Migrate применяет все недостающие SQL-миграции из встроенной
// файловой системы (migrations.FS). Вызывается при старте nexd и из
// подкоманды `nexd migrate`: единственный инстанс монолита может
// мигрировать сам себя, отдельный шаг деплоя не нужен.
//
// Конкурентные вызовы сериализуются advisory-блокировкой Postgres:
// без неё два процесса (или тестовые пакеты, которые go test гоняет
// параллельно) наперегонки применяют одну миграцию к свежей БД и
// падают на «relation already exists».
func Migrate(ctx context.Context, dsn string) error {
	sqldb, err := sql.Open("pgx", dsn)
	if err != nil {
		return fmt.Errorf("postgres: open for migrate: %w", err)
	}
	defer func() { _ = sqldb.Close() }()

	// Блокировка живёт на выделенном соединении: advisory-lock привязан
	// к сессии, а пул database/sql раздаёт соединения произвольно.
	lockConn, err := sqldb.Conn(ctx)
	if err != nil {
		return fmt.Errorf("postgres: migrate lock conn: %w", err)
	}
	defer func() { _ = lockConn.Close() }()
	if _, err := lockConn.ExecContext(ctx, "SELECT pg_advisory_lock($1)", migrateLockID); err != nil {
		return fmt.Errorf("postgres: acquire migrate lock: %w", err)
	}
	defer func() {
		_, _ = lockConn.ExecContext(ctx, "SELECT pg_advisory_unlock($1)", migrateLockID)
	}()

	goose.SetBaseFS(migrations.FS)
	goose.SetLogger(goose.NopLogger()) // итог логирует вызывающий
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("postgres: goose dialect: %w", err)
	}
	if err := goose.UpContext(ctx, sqldb, "."); err != nil {
		return fmt.Errorf("postgres: migrate up: %w", err)
	}
	return nil
}

// MigrateDown откатывает одну последнюю применённую миграцию. Используется
// подкомандой `nexd migrate down` (см. migrations/README.md, make migrate-down)
// для локальной разработки — та же блокировка и та же встроенная FS, что и
// в Migrate.
func MigrateDown(ctx context.Context, dsn string) error {
	sqldb, err := sql.Open("pgx", dsn)
	if err != nil {
		return fmt.Errorf("postgres: open for migrate down: %w", err)
	}
	defer func() { _ = sqldb.Close() }()

	lockConn, err := sqldb.Conn(ctx)
	if err != nil {
		return fmt.Errorf("postgres: migrate down lock conn: %w", err)
	}
	defer func() { _ = lockConn.Close() }()
	if _, err := lockConn.ExecContext(ctx, "SELECT pg_advisory_lock($1)", migrateLockID); err != nil {
		return fmt.Errorf("postgres: acquire migrate lock: %w", err)
	}
	defer func() {
		_, _ = lockConn.ExecContext(ctx, "SELECT pg_advisory_unlock($1)", migrateLockID)
	}()

	goose.SetBaseFS(migrations.FS)
	goose.SetLogger(goose.NopLogger())
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("postgres: goose dialect: %w", err)
	}
	if err := goose.DownContext(ctx, sqldb, "."); err != nil {
		return fmt.Errorf("postgres: migrate down: %w", err)
	}
	return nil
}
