package finance_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"testing"

	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/kernel/identity"
	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/module/finance"
	"github.com/smworklair/betakis/internal/platform/postgres"
	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// pgTestDB подключается к БД из NEX_TEST_DATABASE_URL и применяет
// миграции. Без переменной интеграционные тесты пропускаются, поэтому
// обычный `go test ./...` работает и без Postgres.
//
// Изоляция тестов — через сами tenant'ы: каждый тест создаёт свой
// tenant и работает только в нём, поэтому база не чистится и тесты
// разных пакетов могут гоняться параллельно.
func pgTestDB(t *testing.T) *postgres.DB {
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

// pgTenantCtx создаёт свежий tenant и возвращает контекст бухгалтера в нём.
// Slug дополняется случайным суффиксом: повторные прогоны тестов не должны
// попадать в tenant прошлого прогона с его данными.
func pgTenantCtx(t *testing.T, d *postgres.DB, slug string) context.Context {
	t.Helper()
	var buf [6]byte
	if _, err := rand.Read(buf[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	slug = slug + "-" + hex.EncodeToString(buf[:])
	id, err := d.EnsureTenant(context.Background(), slug)
	if err != nil {
		t.Fatalf("создание tenant %q: %v", slug, err)
	}
	ctx := identity.WithActor(context.Background(), identity.Actor{ID: "u1", Roles: []string{"accountant"}})
	return tenancy.WithTenant(ctx, id)
}

func TestPGFinanceEndToEnd(t *testing.T) {
	d := pgTestDB(t)
	repo := finance.NewPostgresRepository(d)
	bus := newBus(repo)
	ctx := pgTenantCtx(t, d, "pg-e2e-"+t.Name())

	cash := createAccount(t, bus, repo, ctx, "50", "Касса", finance.AccountAsset)
	income := createAccount(t, bus, repo, ctx, "90", "Доход от обучения", finance.AccountIncome)

	err := bus.Dispatch(ctx, finance.PostEntry{
		Memo: "оплата обучения, июнь",
		Lines: []finance.Line{
			{AccountID: cash, Side: finance.Debit, Amount: 4_500_000},
			{AccountID: income, Side: finance.Credit, Amount: 4_500_000},
		},
	})
	if err != nil {
		t.Fatalf("проведение: %v", err)
	}

	balances, err := repo.Accounts(ctx)
	if err != nil {
		t.Fatalf("Accounts: %v", err)
	}
	got := map[string]int64{}
	for _, b := range balances {
		got[b.Account.Code] = b.Amount
	}
	if got["50"] != 4_500_000 || got["90"] != 4_500_000 {
		t.Errorf("сальдо = %v, want 4500000 на счетах 50 и 90", got)
	}

	entries, err := repo.Entries(ctx)
	if err != nil {
		t.Fatalf("Entries: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("проводок = %d, want 1", len(entries))
	}
	if entries[0].PostedBy != "u1" {
		t.Errorf("PostedBy = %q, want u1", entries[0].PostedBy)
	}
	if len(entries[0].Lines) != 2 {
		t.Errorf("строк в проводке = %d, want 2", len(entries[0].Lines))
	}
}

func TestPGTenantIsolation(t *testing.T) {
	d := pgTestDB(t)
	repo := finance.NewPostgresRepository(d)
	bus := newBus(repo)

	ctx1 := pgTenantCtx(t, d, "pg-iso-1-"+t.Name())
	ctx2 := pgTenantCtx(t, d, "pg-iso-2-"+t.Name())
	createAccount(t, bus, repo, ctx1, "50", "Касса", finance.AccountAsset)

	// Второй tenant не видит счетов первого.
	balances, err := repo.Accounts(ctx2)
	if err != nil {
		t.Fatalf("Accounts(tenant2): %v", err)
	}
	if len(balances) != 0 {
		t.Errorf("tenant2 видит %d чужих счетов", len(balances))
	}

	// Запрос без tenant'а отклоняется.
	if _, err := repo.Accounts(context.Background()); !errors.Is(err, finance.ErrNoTenant) {
		t.Errorf("без tenant'а: err = %v, want ErrNoTenant", err)
	}

	// Tenant, не являющийся UUID, до БД не доходит.
	badCtx := tenancy.WithTenant(context.Background(), "not-a-uuid")
	if _, err := repo.Accounts(badCtx); !errors.Is(err, finance.ErrNoTenant) {
		t.Errorf("кривой tenant: err = %v, want ErrNoTenant", err)
	}
}

func TestPGErrors(t *testing.T) {
	d := pgTestDB(t)
	repo := finance.NewPostgresRepository(d)
	bus := newBus(repo)
	ctx := pgTenantCtx(t, d, "pg-err-"+t.Name())

	cash := createAccount(t, bus, repo, ctx, "50", "Касса", finance.AccountAsset)

	// Дубликат кода счёта.
	err := bus.Dispatch(ctx, finance.CreateAccount{Code: "50", DisplayName: "Касса-2", AccountType: finance.AccountAsset})
	if !errors.Is(err, finance.ErrDuplicateCode) {
		t.Errorf("дубликат: err = %v, want ErrDuplicateCode", err)
	}

	// Проводка на несуществующий счёт.
	err = bus.Dispatch(ctx, finance.PostEntry{Lines: []finance.Line{
		{AccountID: "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e", Side: finance.Debit, Amount: 100},
		{AccountID: cash, Side: finance.Credit, Amount: 100},
	}})
	if !errors.Is(err, finance.ErrAccountNotFound) {
		t.Errorf("несуществующий счёт: err = %v, want ErrAccountNotFound", err)
	}

	// Счета в разных валютах в одной проводке.
	if err := bus.Dispatch(ctx, finance.CreateAccount{
		Code: "52", DisplayName: "Валютный счёт", AccountType: finance.AccountAsset, Currency: "USD",
	}); err != nil {
		t.Fatalf("создание валютного счёта: %v", err)
	}
	usd := accountID(t, repo, ctx, "52")
	err = bus.Dispatch(ctx, finance.PostEntry{Lines: []finance.Line{
		{AccountID: usd, Side: finance.Debit, Amount: 100},
		{AccountID: cash, Side: finance.Credit, Amount: 100},
	}})
	if !errors.Is(err, finance.ErrCurrencyMismatch) {
		t.Errorf("смешение валют: err = %v, want ErrCurrencyMismatch", err)
	}
}

// TestPGTransactionalAudit проверяет спайн Commands→Audit на Postgres:
// успех команды оставляет запись «ok» в журнале в той же транзакции,
// а ошибка хендлера откатывает данные, но след «error» в журнале остаётся.
func TestPGTransactionalAudit(t *testing.T) {
	d := pgTestDB(t)
	repo := finance.NewPostgresRepository(d)
	ctx := pgTenantCtx(t, d, "pg-audit")

	policy := authz.NewPolicy()
	policy.Grant("accountant", finance.PermAccountsWrite)
	policy.Grant("accountant", "test:fail")
	bus := command.NewMemoryBus(authz.NewPolicyAuthorizer(policy),
		postgres.NewAuditRecorder(d, nil), command.WithTxRunner(d))
	if err := finance.RegisterCommands(bus, repo); err != nil {
		t.Fatal(err)
	}
	// Хендлер, который меняет данные и затем падает: изменение обязано
	// откатиться вместе с транзакцией шины.
	err := bus.Register("test.fail", func(ctx context.Context, _ command.Command) error {
		if err := repo.CreateAccount(ctx, finance.Account{Code: "66", Name: "x", Type: finance.AccountAsset, Currency: "RUB"}); err != nil {
			return err
		}
		return errors.New("boom")
	})
	if err != nil {
		t.Fatal(err)
	}

	// Успех: счёт создан, в журнале «ok».
	if err := bus.Dispatch(ctx, finance.CreateAccount{Code: "50", DisplayName: "Касса", AccountType: finance.AccountAsset}); err != nil {
		t.Fatalf("создание счёта: %v", err)
	}

	// Ошибка: изменение откатилось, в журнале «error».
	if err := bus.Dispatch(ctx, failCmd{}); err == nil {
		t.Fatal("ожидалась ошибка команды test.fail")
	}
	balances, err := repo.Accounts(ctx)
	if err != nil {
		t.Fatalf("Accounts: %v", err)
	}
	for _, b := range balances {
		if b.Account.Code == "66" {
			t.Error("счёт 66 пережил откат транзакции")
		}
	}

	outcomes := map[string]string{} // команда → исход
	err = d.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		rows, err := q.ListAuditEntries(ctx, 10)
		if err != nil {
			return err
		}
		for _, r := range rows {
			outcomes[r.Command] = r.Outcome
		}
		return nil
	})
	if err != nil {
		t.Fatalf("чтение журнала: %v", err)
	}
	if outcomes[finance.CmdAccountCreate] != "ok" {
		t.Errorf("аудит %s = %q, want ok", finance.CmdAccountCreate, outcomes[finance.CmdAccountCreate])
	}
	if outcomes["test.fail"] != "error" {
		t.Errorf("аудит test.fail = %q, want error", outcomes["test.fail"])
	}
}

// failCmd — тестовая команда для проверки отката.
type failCmd struct{}

func (failCmd) Name() string       { return "test.fail" }
func (failCmd) Permission() string { return "test:fail" }
func (failCmd) Validate() error    { return nil }

// accountID возвращает ID счёта по коду.
func accountID(t *testing.T, repo finance.Repository, ctx context.Context, code string) string {
	t.Helper()
	balances, err := repo.Accounts(ctx)
	if err != nil {
		t.Fatalf("Accounts: %v", err)
	}
	for _, b := range balances {
		if b.Account.Code == code {
			return b.Account.ID
		}
	}
	t.Fatalf("счёт %s не найден", code)
	return ""
}
