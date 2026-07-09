package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// Ошибки tenant-контекста. Модули маппят их в свои доменные ошибки.
var (
	// ErrNoTenant — в контексте нет tenant'а, а операция его требует.
	ErrNoTenant = errors.New("postgres: no tenant in context")
	// ErrInvalidTenant — идентификатор tenant'а в контексте не является
	// UUID: до БД такой запрос не доходит.
	ErrInvalidTenant = errors.New("postgres: tenant id is not a uuid")
)

// txKey — неэкспортируемый ключ контекста открытой транзакции. Позволяет
// вложенным вызовам (репозиторий внутри хендлера команды, аудит внутри
// шины) присоединяться к транзакции, открытой выше по стеку.
type txKey struct{}

// txFrom возвращает транзакцию из контекста, если она открыта.
func txFrom(ctx context.Context) (pgx.Tx, bool) {
	tx, ok := ctx.Value(txKey{}).(pgx.Tx)
	return tx, ok
}

// InTenantTx исполняет fn в транзакции, у которой app.tenant_id взят из
// контекста (tenancy.TenantFrom) — RLS-политики видят только данные этого
// tenant'а. Если транзакция уже открыта выше по стеку (шиной команд),
// fn присоединяется к ней; иначе открывается новая, и она коммитится
// при nil-ошибке либо откатывается целиком.
//
// Каждый SQL-запрос NEX обязан идти через InTenantTx или InTx: запрос на
// «голом» пуле не имеет app.tenant_id, и RLS не вернёт ему ни строки.
func (d *DB) InTenantTx(ctx context.Context, fn func(ctx context.Context, q *db.Queries) error) error {
	tenant, ok := tenancy.TenantFrom(ctx)
	if !ok {
		return ErrNoTenant
	}
	var u pgtype.UUID
	if err := u.Scan(tenant); err != nil {
		return fmt.Errorf("%w: %q", ErrInvalidTenant, tenant)
	}
	return d.inTx(ctx, tenant, fn)
}

// InTx исполняет fn в транзакции без tenant-контекста: для системных
// операций вне tenant'а (запись аудита отклонённого запроса и т.п.).
// Если tenant в контексте всё же есть, он устанавливается — это делает
// InTx безопасным выбором для кода, работающего в обоих режимах.
func (d *DB) InTx(ctx context.Context, fn func(ctx context.Context, q *db.Queries) error) error {
	tenant, _ := tenancy.TenantFrom(ctx)
	return d.inTx(ctx, tenant, fn)
}

// RunTx реализует command.TxRunner: исполняет fn в транзакции с
// tenant-контекстом (если он есть). Шина команд оборачивает в неё
// хендлер и запись аудита; репозитории внутри fn присоединяются к
// транзакции через контекст.
func (d *DB) RunTx(ctx context.Context, fn func(ctx context.Context) error) error {
	return d.InTx(ctx, func(ctx context.Context, _ *db.Queries) error { return fn(ctx) })
}

func (d *DB) inTx(ctx context.Context, tenant string, fn func(ctx context.Context, q *db.Queries) error) error {
	if tx, ok := txFrom(ctx); ok {
		return fn(ctx, db.New(tx))
	}

	tx, err := d.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("postgres: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }() // no-op после успешного Commit

	if tenant != "" {
		// set_config(..., true) действует до конца транзакции (SET LOCAL);
		// параметризация исключает SQL-инъекцию через идентификатор.
		if _, err := tx.Exec(ctx, "SELECT set_config('app.tenant_id', $1, true)", tenant); err != nil {
			return fmt.Errorf("postgres: set tenant: %w", err)
		}
	}

	if err := fn(context.WithValue(ctx, txKey{}, tx), db.New(tx)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("postgres: commit: %w", err)
	}
	return nil
}
