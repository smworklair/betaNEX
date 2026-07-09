package postgres

import (
	"context"
	"fmt"

	"github.com/smworklair/betakis/internal/kernel/audit"
	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// AuditReader читает журнал аудита текущего tenant'а — данные для
// вьюера «кто менял оценки/приказы». RLS сама ограничивает выборку
// tenant'ом транзакции; отдельного фильтра в коде нет.
type AuditReader struct {
	db *DB
}

// Проверка соответствия интерфейсу на этапе компиляции.
var _ audit.Reader = (*AuditReader)(nil)

// NewAuditReader создаёт читателя журнала.
func NewAuditReader(d *DB) *AuditReader { return &AuditReader{db: d} }

// Entries возвращает записи журнала, свежие первыми.
func (r *AuditReader) Entries(ctx context.Context, f audit.Filter) ([]audit.Entry, error) {
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	params := db.ListAuditEntriesFilteredParams{Limit: int32(limit)} // #nosec G115 -- limit ограничен 500 выше
	if f.Command != "" {
		params.Command = &f.Command
	}
	if f.ActorID != "" {
		params.ActorID = &f.ActorID
	}

	var out []audit.Entry
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		rows, err := q.ListAuditEntriesFiltered(ctx, params)
		if err != nil {
			return err
		}
		out = make([]audit.Entry, 0, len(rows))
		for _, row := range rows {
			out = append(out, audit.Entry{
				Command:    row.Command,
				Outcome:    audit.Outcome(row.Outcome),
				ActorID:    row.ActorID,
				TenantID:   row.TenantID.String(),
				Detail:     row.Detail,
				TraceID:    row.TraceID,
				OccurredAt: row.OccurredAt.Time,
			})
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("postgres: audit entries: %w", err)
	}
	return out, nil
}
