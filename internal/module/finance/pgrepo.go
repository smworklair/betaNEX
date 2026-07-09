package finance

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/platform/postgres"
	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// PostgresRepository — хранилище леджера в PostgreSQL поверх кода,
// сгенерированного sqlc. Каждый метод работает в транзакции с
// app.tenant_id (postgres.InTenantTx): фильтр по tenant'у обеспечивает
// RLS, поэтому в самих запросах его нет.
type PostgresRepository struct {
	db *postgres.DB
}

// Проверка соответствия интерфейсу на этапе компиляции.
var _ Repository = (*PostgresRepository)(nil)

// NewPostgresRepository создаёт репозиторий поверх подключения к БД.
func NewPostgresRepository(d *postgres.DB) *PostgresRepository {
	return &PostgresRepository{db: d}
}

// CreateAccount сохраняет счёт. ID, переданный доменом, игнорируется:
// его генерирует БД (gen_random_uuid) — единый источник идентификаторов.
func (r *PostgresRepository) CreateAccount(ctx context.Context, a Account) error {
	return mapTenantErr(r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		tenant, err := tenantUUID(ctx)
		if err != nil {
			return err
		}
		_, err = q.CreateFinanceAccount(ctx, db.CreateFinanceAccountParams{
			TenantID: tenant,
			Code:     a.Code,
			Name:     a.Name,
			Type:     string(a.Type),
			Currency: a.Currency,
		})
		if isUniqueViolation(err) {
			return fmt.Errorf("%w: %s", ErrDuplicateCode, a.Code)
		}
		return err
	}))
}

// Account возвращает счёт по ID.
func (r *PostgresRepository) Account(ctx context.Context, id string) (Account, error) {
	var u pgtype.UUID
	if err := u.Scan(id); err != nil {
		// Не-UUID заведомо не существует в БД; это не ошибка запроса.
		return Account{}, fmt.Errorf("%w: %s", ErrAccountNotFound, id)
	}
	var out Account
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		row, err := q.GetFinanceAccount(ctx, u)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: %s", ErrAccountNotFound, id)
		}
		if err != nil {
			return err
		}
		out = accountFromRow(row)
		return nil
	})
	return out, mapTenantErr(err)
}

// Accounts возвращает счета tenant'а с сальдо, отсортированные по коду.
func (r *PostgresRepository) Accounts(ctx context.Context) ([]Balance, error) {
	var out []Balance
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		rows, err := q.ListFinanceAccountsWithBalances(ctx)
		if err != nil {
			return err
		}
		out = make([]Balance, 0, len(rows))
		for _, row := range rows {
			out = append(out, Balance{
				Account: accountFromRow(db.FinanceAccount{
					ID:        row.ID,
					TenantID:  row.TenantID,
					Code:      row.Code,
					Name:      row.Name,
					Type:      row.Type,
					Currency:  row.Currency,
					CreatedAt: row.CreatedAt,
				}),
				Amount: row.Balance,
			})
		}
		return nil
	})
	return out, mapTenantErr(err)
}

// PostEntry сохраняет проводку: проверяет существование счетов и единство
// валюты, затем пишет заголовок и строки в одной транзакции. Балансировку
// строк уже гарантировала PostEntry.Validate; на стороне БД её дублирует
// отложенный constraint-триггер.
func (r *PostgresRepository) PostEntry(ctx context.Context, e Entry) error {
	return mapTenantErr(r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		tenant, err := tenantUUID(ctx)
		if err != nil {
			return err
		}

		ids := make([]pgtype.UUID, 0, len(e.Lines))
		for _, line := range e.Lines {
			var u pgtype.UUID
			if err := u.Scan(line.AccountID); err != nil {
				return fmt.Errorf("%w: %s", ErrAccountNotFound, line.AccountID)
			}
			ids = append(ids, u)
		}
		accounts, err := q.ListFinanceAccountsByIDs(ctx, ids)
		if err != nil {
			return err
		}
		currencies := make(map[string]string, len(accounts)) // id → валюта
		for _, a := range accounts {
			currencies[a.ID.String()] = a.Currency
		}
		currency := ""
		for _, line := range e.Lines {
			c, found := currencies[line.AccountID]
			if !found {
				return fmt.Errorf("%w: %s", ErrAccountNotFound, line.AccountID)
			}
			if currency == "" {
				currency = c
			} else if c != currency {
				return fmt.Errorf("%w: %s vs %s", ErrCurrencyMismatch, c, currency)
			}
		}

		entry, err := q.CreateFinanceEntry(ctx, db.CreateFinanceEntryParams{
			TenantID: tenant,
			Memo:     e.Memo,
			PostedBy: e.PostedBy,
		})
		if err != nil {
			return err
		}
		for i, line := range e.Lines {
			if err := q.CreateFinanceLine(ctx, db.CreateFinanceLineParams{
				TenantID:  tenant,
				EntryID:   entry.ID,
				AccountID: ids[i],
				Side:      string(line.Side),
				Amount:    line.Amount,
			}); err != nil {
				return err
			}
		}
		return nil
	}))
}

// Entries возвращает проводки tenant'а со строками в порядке проведения.
func (r *PostgresRepository) Entries(ctx context.Context) ([]Entry, error) {
	var out []Entry
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		entries, err := q.ListFinanceEntries(ctx)
		if err != nil {
			return err
		}
		lines, err := q.ListFinanceLines(ctx)
		if err != nil {
			return err
		}
		byEntry := make(map[string][]Line, len(entries))
		for _, l := range lines {
			id := l.EntryID.String()
			byEntry[id] = append(byEntry[id], Line{
				AccountID: l.AccountID.String(),
				Side:      Side(l.Side),
				Amount:    l.Amount,
			})
		}
		out = make([]Entry, 0, len(entries))
		for _, e := range entries {
			out = append(out, Entry{
				ID:       e.ID.String(),
				Memo:     e.Memo,
				Lines:    byEntry[e.ID.String()],
				PostedBy: e.PostedBy,
				PostedAt: e.PostedAt.Time,
			})
		}
		return nil
	})
	return out, mapTenantErr(err)
}

// --- Вспомогательные ---------------------------------------------------------

// tenantUUID достаёт tenant из контекста в виде pgtype.UUID для параметров
// INSERT. Валидность UUID уже проверил InTenantTx.
func tenantUUID(ctx context.Context) (pgtype.UUID, error) {
	var u pgtype.UUID
	tenant, ok := tenancy.TenantFrom(ctx)
	if !ok {
		return u, ErrNoTenant
	}
	if err := u.Scan(tenant); err != nil {
		return u, fmt.Errorf("%w: %q", ErrNoTenant, tenant)
	}
	return u, nil
}

// mapTenantErr переводит tenant-ошибки платформы в доменную ErrNoTenant,
// чтобы вызывающие видели единый словарь ошибок модуля.
func mapTenantErr(err error) error {
	if errors.Is(err, postgres.ErrNoTenant) || errors.Is(err, postgres.ErrInvalidTenant) {
		return fmt.Errorf("%w: %v", ErrNoTenant, err)
	}
	return err
}

// isUniqueViolation распознаёт нарушение уникальности (SQLSTATE 23505).
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// accountFromRow переводит строку БД в доменный тип.
func accountFromRow(row db.FinanceAccount) Account {
	return Account{
		ID:        row.ID.String(),
		Code:      row.Code,
		Name:      row.Name,
		Type:      AccountType(row.Type),
		Currency:  row.Currency,
		CreatedAt: row.CreatedAt.Time,
	}
}
