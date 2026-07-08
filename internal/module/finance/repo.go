package finance

import (
	"context"
	"errors"
)

// Ошибки хранилища. Проверяются через errors.Is; HTTP-слой маппит их
// в статусы (404, 409, 422).
var (
	ErrNoTenant         = errors.New("finance: no tenant in context")
	ErrAccountNotFound  = errors.New("finance: account not found")
	ErrDuplicateCode    = errors.New("finance: account code already exists")
	ErrCurrencyMismatch = errors.New("finance: entry mixes account currencies")
)

// Balance — счёт с текущим сальдо в копейках. Знак сальдо соответствует
// природе счёта (см. signFor): положительное значение — «нормальное»
// сальдо счёта этого типа.
type Balance struct {
	Account Account
	Amount  int64
}

// Repository — хранилище леджера. Все методы требуют tenant в контексте
// (tenancy.WithTenant) и видят только данные этого tenant'а.
//
// Реализации: MemoryRepository (сейчас) и Postgres на sqlc (веха M2).
type Repository interface {
	// CreateAccount сохраняет счёт; код счёта уникален в tenant'е.
	CreateAccount(ctx context.Context, a Account) error
	// Account возвращает счёт по ID или ErrAccountNotFound.
	Account(ctx context.Context, id string) (Account, error)
	// Accounts возвращает все счета tenant'а с сальдо, отсортированные по коду.
	Accounts(ctx context.Context) ([]Balance, error)
	// PostEntry сохраняет проводку; все счета строк должны существовать
	// и иметь одну валюту.
	PostEntry(ctx context.Context, e Entry) error
	// Entries возвращает проводки tenant'а в порядке проведения.
	Entries(ctx context.Context) ([]Entry, error)
}
