package finance

import (
	"crypto/rand"
	"encoding/hex"
	"time"
)

// AccountType — тип счёта в плане счетов. Определяет «природу» сальдо:
// у активных и расходных счетов положительное сальдо — дебетовое,
// у пассивных, капитальных и доходных — кредитовое.
type AccountType string

const (
	AccountAsset     AccountType = "asset"     // активы: касса, банк, дебиторка
	AccountLiability AccountType = "liability" // обязательства: авансы, кредиторка
	AccountEquity    AccountType = "equity"    // капитал/фонды
	AccountIncome    AccountType = "income"    // доходы: плата за обучение
	AccountExpense   AccountType = "expense"   // расходы: стипендии, хозрасходы
)

// valid сообщает, известен ли тип счёта.
func (t AccountType) valid() bool {
	switch t {
	case AccountAsset, AccountLiability, AccountEquity, AccountIncome, AccountExpense:
		return true
	}
	return false
}

// Account — счёт леджера: лицевой счёт студента, касса, статья дохода и т.д.
type Account struct {
	ID        string
	Code      string // человекочитаемый код: "50", "62.СТ-1001"
	Name      string
	Type      AccountType
	Currency  string // ISO 4217; по умолчанию RUB
	CreatedAt time.Time
}

// Side — сторона строки проводки.
type Side string

const (
	Debit  Side = "debit"
	Credit Side = "credit"
)

// Line — строка проводки: счёт, сторона и сумма в копейках (строго > 0).
type Line struct {
	AccountID string
	Side      Side
	Amount    int64
}

// Entry — сбалансированная проводка. Проводки append-only: исправление —
// только сторнирующей проводкой, история никогда не переписывается.
type Entry struct {
	ID       string
	Memo     string // назначение: "оплата обучения, июнь"
	Lines    []Line
	PostedBy string // ID актора из контекста команды
	PostedAt time.Time
}

// signFor возвращает знак влияния строки на сальдо счёта данного типа:
// дебет увеличивает активы и расходы, кредит — пассивы, капитал и доходы.
func signFor(t AccountType, s Side) int64 {
	debitPositive := t == AccountAsset || t == AccountExpense
	if (s == Debit) == debitPositive {
		return 1
	}
	return -1
}

// newID генерирует 128-битный случайный идентификатор в hex.
// С переходом на Postgres (веха M2) его заменит gen_random_uuid().
func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("finance: crypto/rand unavailable: " + err.Error())
	}
	return hex.EncodeToString(b[:])
}
