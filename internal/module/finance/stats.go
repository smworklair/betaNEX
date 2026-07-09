package finance

import (
	"context"
	"errors"
	"time"

	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// PermStatsRefresh — право пересчёта отчётной витрины.
const PermStatsRefresh = "finance:stats:refresh"

// CmdStatsRefresh — имя команды пересчёта витрины.
const CmdStatsRefresh = "finance.stats.refresh"

// MonthlyTurnover — строка витрины: обороты счёта за месяц.
type MonthlyTurnover struct {
	Month       time.Time
	AccountID   string
	AccountCode string
	AccountName string
	Debit       int64
	Credit      int64
	RefreshedAt time.Time
}

// RefreshStats — команда «пересчитать отчётную витрину». Также
// запускается ночной cron-задачей напрямую через репозиторий.
type RefreshStats struct{}

// Name возвращает стабильное имя команды для аудита.
func (RefreshStats) Name() string { return CmdStatsRefresh }

// Permission возвращает право, требуемое для исполнения.
func (RefreshStats) Permission() string { return PermStatsRefresh }

// Validate подтверждает команду: входных данных у неё нет.
func (RefreshStats) Validate() error { return nil }

// ErrStatsUnsupported — хранилище не поддерживает витрины (in-memory).
var ErrStatsUnsupported = errors.New("finance: stats need Postgres storage")

// RefreshStats пересчитывает витрину оборотов tenant'а: снести и
// перелить одним проходом в транзакции. Для объёмов колледжа это
// секунды; при росте перейдём на инкрементальный пересчёт.
func (r *PostgresRepository) RefreshStats(ctx context.Context) error {
	return mapTenantErr(r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		if err := q.ClearFinanceMonthlyTurnovers(ctx); err != nil {
			return err
		}
		return q.FillFinanceMonthlyTurnovers(ctx)
	}))
}

// MonthlyTurnovers возвращает витрину оборотов tenant'а.
func (r *PostgresRepository) MonthlyTurnovers(ctx context.Context) ([]MonthlyTurnover, error) {
	var out []MonthlyTurnover
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		rows, err := q.ListFinanceMonthlyTurnovers(ctx)
		if err != nil {
			return err
		}
		out = make([]MonthlyTurnover, 0, len(rows))
		for _, row := range rows {
			out = append(out, MonthlyTurnover{
				Month:       row.Month.Time,
				AccountID:   row.AccountID.String(),
				AccountCode: row.Code,
				AccountName: row.Name,
				Debit:       row.Debit,
				Credit:      row.Credit,
				RefreshedAt: row.RefreshedAt.Time,
			})
		}
		return nil
	})
	return out, mapTenantErr(err)
}
