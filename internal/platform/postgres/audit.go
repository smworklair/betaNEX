package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/smworklair/betakis/internal/kernel/audit"
	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// AuditRecorder пишет журнал аудита в Postgres. Внутри команды запись
// присоединяется к транзакции шины (InTx находит её в контексте) —
// изменение данных и его след в журнале коммитятся атомарно. Записи
// об отказах и ошибках приходят вне транзакции и пишутся своей короткой
// транзакцией.
type AuditRecorder struct {
	db *DB
	// traceID достаёт идентификатор запроса из контекста (обычно
	// httpapi.RequestIDFrom); передаётся функцией, чтобы postgres не
	// зависел от HTTP-слоя.
	traceID func(ctx context.Context) string
}

// Проверка соответствия интерфейсу на этапе компиляции.
var _ audit.Recorder = (*AuditRecorder)(nil)

// NewAuditRecorder создаёт рекордер. traceID может быть nil.
func NewAuditRecorder(d *DB, traceID func(ctx context.Context) string) *AuditRecorder {
	return &AuditRecorder{db: d, traceID: traceID}
}

// Record сохраняет запись журнала. Tenant, не являющийся UUID, пишется
// как NULL: сам факт события важнее ссылочной целостности с реестром.
func (r *AuditRecorder) Record(ctx context.Context, e audit.Entry) error {
	var tenant pgtype.UUID
	_ = tenant.Scan(e.TenantID) // невалидный → Valid=false → NULL

	trace := ""
	if r.traceID != nil {
		trace = r.traceID(ctx)
	}

	err := r.db.InTx(ctx, func(ctx context.Context, q *db.Queries) error {
		return q.CreateAuditEntry(ctx, db.CreateAuditEntryParams{
			TenantID:   tenant,
			ActorID:    e.ActorID,
			Command:    e.Command,
			Outcome:    string(e.Outcome),
			Detail:     e.Detail,
			TraceID:    trace,
			OccurredAt: pgtype.Timestamptz{Time: e.OccurredAt, Valid: true},
		})
	})
	if err != nil {
		return fmt.Errorf("postgres: audit record: %w", err)
	}
	return nil
}
