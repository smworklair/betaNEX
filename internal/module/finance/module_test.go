package finance_test

import (
	"context"
	"errors"
	"testing"

	"github.com/smworklair/betakis/internal/kernel/audit"
	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/kernel/identity"
	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/module/finance"
)

// newBus собирает шину с политикой, где роль accountant имеет права
// финансов, — как в композиционном корне.
func newBus(repo finance.Repository) *command.MemoryBus {
	policy := authz.NewPolicy()
	policy.Grant("accountant", finance.PermAccountsWrite)
	policy.Grant("accountant", finance.PermEntriesPost)
	bus := command.NewMemoryBus(authz.NewPolicyAuthorizer(policy), &audit.MemoryRecorder{})
	if err := finance.RegisterCommands(bus, repo); err != nil {
		panic(err)
	}
	return bus
}

func accountantCtx(tenant string) context.Context {
	ctx := identity.WithActor(context.Background(), identity.Actor{ID: "u1", Roles: []string{"accountant"}})
	return tenancy.WithTenant(ctx, tenant)
}

// createAccount — хелпер: создаёт счёт и возвращает его ID из репозитория.
func createAccount(t *testing.T, bus *command.MemoryBus, repo finance.Repository, ctx context.Context, code, name string, typ finance.AccountType) string {
	t.Helper()
	if err := bus.Dispatch(ctx, finance.CreateAccount{Code: code, DisplayName: name, AccountType: typ}); err != nil {
		t.Fatalf("создание счёта %s: %v", code, err)
	}
	balances, err := repo.Accounts(ctx)
	if err != nil {
		t.Fatalf("Accounts: %v", err)
	}
	for _, b := range balances {
		if b.Account.Code == code {
			return b.Account.ID
		}
	}
	t.Fatalf("счёт %s не найден после создания", code)
	return ""
}

func TestFinanceEndToEnd(t *testing.T) {
	repo := finance.NewMemoryRepository()
	bus := newBus(repo)
	ctx := accountantCtx("college-1")

	cash := createAccount(t, bus, repo, ctx, "50", "Касса", finance.AccountAsset)
	income := createAccount(t, bus, repo, ctx, "90", "Доход от обучения", finance.AccountIncome)

	// Студент оплатил обучение: 45 000 ₽ = 4 500 000 копеек.
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
	if got["50"] != 4_500_000 {
		t.Errorf("сальдо кассы = %d, want 4500000", got["50"])
	}
	if got["90"] != 4_500_000 {
		t.Errorf("сальдо дохода = %d, want 4500000", got["90"])
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
}

func TestTenantIsolation(t *testing.T) {
	repo := finance.NewMemoryRepository()
	bus := newBus(repo)

	ctx1 := accountantCtx("college-1")
	createAccount(t, bus, repo, ctx1, "50", "Касса", finance.AccountAsset)

	// Второй tenant не видит счетов первого.
	balances, err := repo.Accounts(accountantCtx("college-2"))
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
}

func TestDeniedWithoutRole(t *testing.T) {
	repo := finance.NewMemoryRepository()
	bus := newBus(repo)

	ctx := tenancy.WithTenant(
		identity.WithActor(context.Background(), identity.Actor{ID: "s1", Roles: []string{"student"}}),
		"college-1",
	)
	err := bus.Dispatch(ctx, finance.CreateAccount{Code: "50", DisplayName: "Касса", AccountType: finance.AccountAsset})
	if !errors.Is(err, authz.ErrDenied) {
		t.Errorf("err = %v, want ErrDenied", err)
	}
}

func TestDuplicateCodeAndMissingAccount(t *testing.T) {
	repo := finance.NewMemoryRepository()
	bus := newBus(repo)
	ctx := accountantCtx("college-1")

	createAccount(t, bus, repo, ctx, "50", "Касса", finance.AccountAsset)

	// Дубликат кода.
	err := bus.Dispatch(ctx, finance.CreateAccount{Code: "50", DisplayName: "Касса-2", AccountType: finance.AccountAsset})
	if !errors.Is(err, finance.ErrDuplicateCode) {
		t.Errorf("дубликат: err = %v, want ErrDuplicateCode", err)
	}

	// Проводка на несуществующий счёт.
	err = bus.Dispatch(ctx, finance.PostEntry{Lines: []finance.Line{
		{AccountID: "ghost-1", Side: finance.Debit, Amount: 100},
		{AccountID: "ghost-2", Side: finance.Credit, Amount: 100},
	}})
	if !errors.Is(err, finance.ErrAccountNotFound) {
		t.Errorf("несуществующий счёт: err = %v, want ErrAccountNotFound", err)
	}
}
