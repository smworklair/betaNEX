package finance_test

import (
	"testing"

	"github.com/smworklair/betakis/internal/kernel/audit"
	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/module/finance"
	"github.com/smworklair/betakis/internal/platform/postgres"
)

// TestPGSearch проверяет полнотекстовый поиск: русский стемминг
// («обучения» находится по «обучение»), изоляция tenant'ов через RLS.
func TestPGSearch(t *testing.T) {
	d := pgTestDB(t)
	repo := finance.NewPostgresRepository(d)
	bus := newBus(repo)
	ctx := pgTenantCtx(t, d, "pg-fts")

	cash := createAccount(ctx, t, bus, repo, "50", "Касса", finance.AccountAsset)
	income := createAccount(ctx, t, bus, repo, "90", "Доход от обучения", finance.AccountIncome)
	if err := bus.Dispatch(ctx, finance.PostEntry{
		Memo: "оплата обучения за июнь",
		Lines: []finance.Line{
			{AccountID: cash, Side: finance.Debit, Amount: 100},
			{AccountID: income, Side: finance.Credit, Amount: 100},
		},
	}); err != nil {
		t.Fatalf("проведение: %v", err)
	}

	// Стемминг: запрос «обучение» находит и счёт, и проводку с «обучения».
	hits, err := repo.Search(ctx, "обучение", 10)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	kinds := map[string]int{}
	for _, h := range hits {
		kinds[h.Kind]++
	}
	if kinds["finance.account"] != 1 || kinds["finance.entry"] != 1 {
		t.Errorf("hits = %+v, want счёт и проводка", kinds)
	}

	// Чужой tenant ничего не находит.
	ctx2 := pgTenantCtx(t, d, "pg-fts-other")
	hits, err = repo.Search(ctx2, "обучение", 10)
	if err != nil {
		t.Fatalf("Search(tenant2): %v", err)
	}
	if len(hits) != 0 {
		t.Errorf("tenant2 нашёл %d чужих результатов", len(hits))
	}

	// Минус-слово веб-синтаксиса.
	hits, err = repo.Search(ctx, "обучение -июнь", 10)
	if err != nil {
		t.Fatalf("Search с минус-словом: %v", err)
	}
	for _, h := range hits {
		if h.Kind == "finance.entry" {
			t.Errorf("минус-слово не исключило проводку: %+v", h)
		}
	}
}

// TestPGAuditReader проверяет вьюер журнала: записи текущего tenant'а
// читаются с фильтром по команде.
func TestPGAuditReader(t *testing.T) {
	d := pgTestDB(t)
	repo := finance.NewPostgresRepository(d)
	ctx := pgTenantCtx(t, d, "pg-auditread")

	policy := authz.NewPolicy()
	policy.Grant("accountant", finance.PermAccountsWrite)
	bus := command.NewMemoryBus(authz.NewPolicyAuthorizer(policy),
		postgres.NewAuditRecorder(d, nil), command.WithTxRunner(d))
	if err := finance.RegisterCommands(bus, repo); err != nil {
		t.Fatal(err)
	}
	if err := bus.Dispatch(ctx, finance.CreateAccount{Code: "50", DisplayName: "Касса", AccountType: finance.AccountAsset}); err != nil {
		t.Fatalf("команда: %v", err)
	}

	entries, err := postgres.NewAuditReader(d).Entries(ctx, audit.Filter{Limit: 10, Command: finance.CmdAccountCreate})
	if err != nil {
		t.Fatalf("Entries: %v", err)
	}
	if len(entries) != 1 || string(entries[0].Outcome) != "ok" {
		t.Fatalf("entries = %+v, want одна запись ok", entries)
	}
	if entries[0].ActorID != "u1" {
		t.Errorf("ActorID = %q, want u1", entries[0].ActorID)
	}
}
