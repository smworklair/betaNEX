package postgres_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/platform/postgres"
	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// testDB подключается к БД из NEX_TEST_DATABASE_URL (без переменной тест
// пропускается) и применяет миграции.
func testDB(t *testing.T) *postgres.DB {
	t.Helper()
	dsn := os.Getenv("NEX_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("NEX_TEST_DATABASE_URL не задан — пропускаю интеграционный тест")
	}
	ctx := context.Background()
	if err := postgres.Migrate(ctx, dsn); err != nil {
		t.Fatalf("миграции: %v", err)
	}
	d, err := postgres.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("подключение: %v", err)
	}
	t.Cleanup(d.Close)
	return d
}

// newTenant регистрирует свежий tenant со случайным slug'ом и возвращает
// его UUID и контекст с ним.
func newTenant(t *testing.T, d *postgres.DB) (string, context.Context) {
	t.Helper()
	var buf [6]byte
	if _, err := rand.Read(buf[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	id, err := d.EnsureTenant(context.Background(), "rls-test-"+hex.EncodeToString(buf[:]))
	if err != nil {
		t.Fatalf("создание tenant: %v", err)
	}
	return id, tenancy.WithTenant(context.Background(), id)
}

// mustUUID переводит строку в pgtype.UUID.
func mustUUID(t *testing.T, s string) pgtype.UUID {
	t.Helper()
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		t.Fatalf("uuid %q: %v", s, err)
	}
	return u
}

// createAccount вставляет счёт от имени tenant'а через InTenantTx.
func createAccount(t *testing.T, d *postgres.DB, ctx context.Context, tenantID, code string) {
	t.Helper()
	err := d.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		_, err := q.CreateFinanceAccount(ctx, db.CreateFinanceAccountParams{
			TenantID: mustUUID(t, tenantID),
			Code:     code,
			Name:     "RLS-тест",
			Type:     "asset",
			Currency: "RUB",
		})
		return err
	})
	if err != nil {
		t.Fatalf("создание счёта: %v", err)
	}
}

// TestRLSSecondLine проверяет RLS как второй рубеж изоляции: даже запрос,
// в котором приложение забыло фильтр по tenant_id, не пересекает границу
// tenant'а.
func TestRLSSecondLine(t *testing.T) {
	d := testDB(t)
	tenant1, ctx1 := newTenant(t, d)
	_, ctx2 := newTenant(t, d)

	createAccount(t, d, ctx1, tenant1, "50")

	t.Run("без app.tenant_id не видно ни строки", func(t *testing.T) {
		// Запрос мимо InTenantTx — на «голом» пуле, без set_config.
		var n int
		err := d.Pool().QueryRow(context.Background(),
			"SELECT count(*) FROM finance_accounts").Scan(&n)
		if err != nil {
			t.Fatalf("count: %v", err)
		}
		if n != 0 {
			t.Errorf("без tenant'а видно %d счетов, want 0", n)
		}
	})

	t.Run("чужой tenant не видит строк", func(t *testing.T) {
		err := d.InTenantTx(ctx2, func(ctx context.Context, q *db.Queries) error {
			rows, err := q.ListFinanceAccountsWithBalances(ctx)
			if err != nil {
				return err
			}
			if len(rows) != 0 {
				t.Errorf("tenant2 видит %d чужих счетов", len(rows))
			}
			return nil
		})
		if err != nil {
			t.Fatalf("листинг: %v", err)
		}
	})

	t.Run("вставка в чужой tenant отклоняется политикой", func(t *testing.T) {
		// Транзакция от имени tenant2 пытается вставить строку tenant1.
		err := d.InTenantTx(ctx2, func(ctx context.Context, q *db.Queries) error {
			_, err := q.CreateFinanceAccount(ctx, db.CreateFinanceAccountParams{
				TenantID: mustUUID(t, tenant1),
				Code:     "99",
				Name:     "взлом",
				Type:     "asset",
				Currency: "RUB",
			})
			return err
		})
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
			t.Errorf("вставка в чужой tenant: err = %v, want SQLSTATE 42501 (RLS)", err)
		}
	})
}

// TestResolveTenant проверяет резолвер: UUID проходит как есть, slug
// ищется в реестре, незнакомый slug — ошибка.
func TestResolveTenant(t *testing.T) {
	d := testDB(t)
	id, _ := newTenant(t, d)

	got, err := d.ResolveTenant(context.Background(), id)
	if err != nil || got != id {
		t.Errorf("ResolveTenant(uuid) = %q, %v; want %q, nil", got, err, id)
	}

	if _, err := d.ResolveTenant(context.Background(), "no-such-slug-anywhere"); !errors.Is(err, postgres.ErrTenantNotFound) {
		t.Errorf("незнакомый slug: err = %v, want ErrTenantNotFound", err)
	}
}
