package finance

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
)

// MemoryRepository — хранилище леджера в памяти процесса: для локальной
// разработки и тестов, пока нет Postgres-реализации (веха M2). Данные
// теряются при рестарте — это осознанное ограничение текущего этапа.
type MemoryRepository struct {
	mu      sync.RWMutex
	tenants map[string]*tenantLedger
}

// tenantLedger — данные одного tenant'а: изоляция по ключу карты повторяет
// будущую изоляцию по tenant_id + RLS в Postgres.
type tenantLedger struct {
	accounts map[string]Account // id → счёт
	byCode   map[string]string  // код → id
	entries  []Entry
}

// Проверка соответствия интерфейсу на этапе компиляции.
var _ Repository = (*MemoryRepository)(nil)

// NewMemoryRepository создаёт пустое хранилище.
func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{tenants: make(map[string]*tenantLedger)}
}

// ledger возвращает (создавая при необходимости) леджер tenant'а из
// контекста. Вызывается под мьютексом.
func (r *MemoryRepository) ledger(ctx context.Context) (*tenantLedger, error) {
	tenant, ok := tenancy.TenantFrom(ctx)
	if !ok {
		return nil, ErrNoTenant
	}
	l := r.tenants[tenant]
	if l == nil {
		l = &tenantLedger{
			accounts: make(map[string]Account),
			byCode:   make(map[string]string),
		}
		r.tenants[tenant] = l
	}
	return l, nil
}

// CreateAccount сохраняет счёт, следя за уникальностью кода в tenant'е.
func (r *MemoryRepository) CreateAccount(ctx context.Context, a Account) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	l, err := r.ledger(ctx)
	if err != nil {
		return err
	}
	if _, dup := l.byCode[a.Code]; dup {
		return fmt.Errorf("%w: %s", ErrDuplicateCode, a.Code)
	}
	l.accounts[a.ID] = a
	l.byCode[a.Code] = a.ID
	return nil
}

// Account возвращает счёт по ID.
func (r *MemoryRepository) Account(ctx context.Context, id string) (Account, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	tenant, ok := tenancy.TenantFrom(ctx)
	if !ok {
		return Account{}, ErrNoTenant
	}
	l := r.tenants[tenant]
	if l == nil {
		return Account{}, fmt.Errorf("%w: %s", ErrAccountNotFound, id)
	}
	a, found := l.accounts[id]
	if !found {
		return Account{}, fmt.Errorf("%w: %s", ErrAccountNotFound, id)
	}
	return a, nil
}

// Accounts возвращает счета tenant'а с сальдо, отсортированные по коду.
func (r *MemoryRepository) Accounts(ctx context.Context) ([]Balance, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	tenant, ok := tenancy.TenantFrom(ctx)
	if !ok {
		return nil, ErrNoTenant
	}
	l := r.tenants[tenant]
	if l == nil {
		return []Balance{}, nil
	}

	// Сальдо считаем проходом по всем проводкам: для объёмов разработки
	// этого достаточно, в Postgres это станет одним агрегирующим запросом.
	sums := make(map[string]int64, len(l.accounts))
	for _, e := range l.entries {
		for _, line := range e.Lines {
			a := l.accounts[line.AccountID]
			sums[line.AccountID] += signFor(a.Type, line.Side) * line.Amount
		}
	}

	out := make([]Balance, 0, len(l.accounts))
	for id, a := range l.accounts {
		out = append(out, Balance{Account: a, Amount: sums[id]})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Account.Code < out[j].Account.Code })
	return out, nil
}

// PostEntry сохраняет проводку, проверив существование счетов и единство
// валюты. Балансировку строк уже гарантировала PostEntry.Validate.
func (r *MemoryRepository) PostEntry(ctx context.Context, e Entry) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	l, err := r.ledger(ctx)
	if err != nil {
		return err
	}

	currency := ""
	for _, line := range e.Lines {
		a, found := l.accounts[line.AccountID]
		if !found {
			return fmt.Errorf("%w: %s", ErrAccountNotFound, line.AccountID)
		}
		if currency == "" {
			currency = a.Currency
		} else if a.Currency != currency {
			return fmt.Errorf("%w: %s vs %s", ErrCurrencyMismatch, a.Currency, currency)
		}
	}

	l.entries = append(l.entries, e)
	return nil
}

// Entries возвращает копию списка проводок tenant'а.
func (r *MemoryRepository) Entries(ctx context.Context) ([]Entry, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	tenant, ok := tenancy.TenantFrom(ctx)
	if !ok {
		return nil, ErrNoTenant
	}
	l := r.tenants[tenant]
	if l == nil {
		return []Entry{}, nil
	}
	out := make([]Entry, len(l.entries))
	copy(out, l.entries)
	return out, nil
}
