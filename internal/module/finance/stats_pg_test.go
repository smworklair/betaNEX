package finance_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/module/finance"
	"github.com/smworklair/betakis/internal/platform/httpapi"
)

// TestPGStatsAndExports: проводки → пересчёт витрины → обороты по
// месяцам; изоляция tenant'ов сохраняется и в витрине.
func TestPGStatsAndExports(t *testing.T) {
	d := pgTestDB(t)
	repo := finance.NewPostgresRepository(d)
	bus := newBus(repo)
	ctx := pgTenantCtx(t, d, "pg-stats")

	cash := createAccount(ctx, t, bus, repo, "50", "Касса", finance.AccountAsset)
	income := createAccount(ctx, t, bus, repo, "90", "Доход", finance.AccountIncome)
	for _, amount := range []int64{100_000, 250_000} {
		if err := bus.Dispatch(ctx, finance.PostEntry{
			Memo: "оплата",
			Lines: []finance.Line{
				{AccountID: cash, Side: finance.Debit, Amount: amount},
				{AccountID: income, Side: finance.Credit, Amount: amount},
			},
		}); err != nil {
			t.Fatalf("проведение: %v", err)
		}
	}

	if err := repo.RefreshStats(ctx); err != nil {
		t.Fatalf("RefreshStats: %v", err)
	}
	rows, err := repo.MonthlyTurnovers(ctx)
	if err != nil {
		t.Fatalf("MonthlyTurnovers: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("строк витрины = %d, want 2 (по счёту на месяц)", len(rows))
	}
	byCode := map[string]finance.MonthlyTurnover{}
	for _, r := range rows {
		byCode[r.AccountCode] = r
	}
	if byCode["50"].Debit != 350_000 || byCode["50"].Credit != 0 {
		t.Errorf("касса: debit=%d credit=%d, want 350000/0", byCode["50"].Debit, byCode["50"].Credit)
	}
	if byCode["90"].Credit != 350_000 {
		t.Errorf("доход: credit=%d, want 350000", byCode["90"].Credit)
	}

	// Чужой tenant видит пустую витрину.
	ctx2 := pgTenantCtx(t, d, "pg-stats-other")
	rows, err = repo.MonthlyTurnovers(ctx2)
	if err != nil {
		t.Fatalf("MonthlyTurnovers(tenant2): %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("tenant2 видит %d чужих строк витрины", len(rows))
	}

	// Повторный пересчёт идемпотентен.
	if err := repo.RefreshStats(ctx); err != nil {
		t.Fatalf("повторный RefreshStats: %v", err)
	}
	rows, _ = repo.MonthlyTurnovers(ctx)
	if len(rows) != 2 {
		t.Errorf("после повторного пересчёта строк = %d, want 2", len(rows))
	}
}

// TestCSVImportParsing — импорт плана счетов из CSV через шину:
// валидные строки создаются, ошибочные попадают в отчёт.
func TestCSVImportParsing(t *testing.T) {
	d := pgTestDB(t)
	repo := finance.NewPostgresRepository(d)
	bus := newBus(repo)
	ctx := pgTenantCtx(t, d, "pg-csvimp")

	csvBody := strings.Join([]string{
		"code,name,type,currency",
		"50,Касса,asset,RUB",
		"90,Доход от обучения,income",
		"XX,Кривой,badtype", // невалидный тип — в отчёт ошибок
	}, "\n")

	rec := doImport(ctx, t, bus, repo, csvBody)
	if rec.Created != 2 || len(rec.Errors) != 1 {
		t.Fatalf("импорт: created=%d errors=%d, want 2/1", rec.Created, len(rec.Errors))
	}
	balances, err := repo.Accounts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(balances) != 2 {
		t.Errorf("счетов после импорта = %d, want 2", len(balances))
	}
}

type importResult struct {
	Created int `json:"created"`
	Errors  []struct {
		Line  int    `json:"line"`
		Error string `json:"error"`
	} `json:"errors"`
}

// doImport гоняет CSV через HTTP-маршрут импорта с dev-заголовками.
func doImport(ctx context.Context, t *testing.T, bus *command.MemoryBus, repo *finance.PostgresRepository, body string) importResult {
	t.Helper()
	tenant, _ := tenancy.TenantFrom(ctx)
	router := httpapi.NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), httpapi.RouterConfig{
		DevAuth: true,
		Mount:   []func(*http.ServeMux){finance.ReportRoutes(bus, repo)},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/finance/import/accounts", strings.NewReader(body))
	req.Header.Set("X-Dev-Actor", "u1")
	req.Header.Set("X-Dev-Roles", "accountant")
	req.Header.Set("X-Dev-Tenant", tenant)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("импорт: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out importResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}
