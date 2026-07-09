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

// Migrate применяет все недостающие SQL-миграции из встроенной
// файловой системы (migrations.FS). Вызывается при старте nexd и из
// подкоманды `nexd migrate`: единственный инстанс монолита может
// мигрировать сам себя, отдельный шаг деплоя не нужен.
func Migrate(ctx context.Context, dsn string) error {
	sqldb, err := sql.Open("pgx", dsn)
	if err != nil {
		return fmt.Errorf("postgres: open for migrate: %w", err)
	}
	defer func() { _ = sqldb.Close() }()

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
