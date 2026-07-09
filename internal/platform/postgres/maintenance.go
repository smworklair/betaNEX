package postgres

import (
	"context"
	"fmt"

	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// CleanupSessions удаляет давно истёкшие и отозванные сессии.
// Вызывается ночной cron-задачей: таблица не растёт бесконечно, а
// недельный лаг оставляет след для разбора инцидентов.
func (d *DB) CleanupSessions(ctx context.Context) error {
	n, err := db.New(d.pool).DeleteExpiredSessions(ctx)
	if err != nil {
		return fmt.Errorf("postgres: cleanup sessions: %w", err)
	}
	_ = n // количество попадает в лог задачи через cron
	return nil
}
