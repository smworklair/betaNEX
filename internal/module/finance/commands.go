package finance

import (
	"errors"
	"fmt"
)

// Права модуля. Ролям их раздаёт композиционный корень (cmd/nexd);
// с вехой M4 раздача переедет в настраиваемую политику tenant'а.
const (
	PermAccountsWrite = "finance:accounts:write"
	PermEntriesPost   = "finance:entries:post"
	// PermRead — право чтения счетов, проводок, отчётов и экспортов.
	PermRead = "finance:read"
)

// Имена команд модуля — стабильные, попадают в журнал аудита.
const (
	CmdAccountCreate = "finance.account.create"
	CmdEntryPost     = "finance.entry.post"
)

// ErrUnbalanced — проводка не сбалансирована (дебет != кредит).
var ErrUnbalanced = errors.New("finance: entry is not balanced")

// CreateAccount — команда «создать счёт в плане счетов».
type CreateAccount struct {
	Code        string
	DisplayName string
	AccountType AccountType
	Currency    string // пусто = RUB
}

// Name возвращает стабильное имя команды для аудита.
func (CreateAccount) Name() string { return CmdAccountCreate }

// Permission возвращает право, требуемое для исполнения.
func (CreateAccount) Permission() string { return PermAccountsWrite }

// Validate проверяет инварианты входа до обращения к хранилищу.
func (c CreateAccount) Validate() error {
	if c.Code == "" {
		return errors.New("finance: account code is required")
	}
	if c.DisplayName == "" {
		return errors.New("finance: account name is required")
	}
	if !c.AccountType.valid() {
		return fmt.Errorf("finance: unknown account type %q", c.AccountType)
	}
	if c.Currency != "" && len(c.Currency) != 3 {
		return fmt.Errorf("finance: currency must be an ISO 4217 code, got %q", c.Currency)
	}
	return nil
}

// PostEntry — команда «провести операцию» (сбалансированную проводку).
type PostEntry struct {
	Memo  string
	Lines []Line
}

// Name возвращает стабильное имя команды для аудита.
func (PostEntry) Name() string { return CmdEntryPost }

// Permission возвращает право, требуемое для исполнения.
func (PostEntry) Permission() string { return PermEntriesPost }

// Validate гарантирует главный инвариант двойной записи: сумма дебетов
// равна сумме кредитов, все суммы положительны, счёта указаны.
func (c PostEntry) Validate() error {
	if len(c.Lines) < 2 {
		return errors.New("finance: entry needs at least two lines")
	}
	var debit, credit int64
	for i, l := range c.Lines {
		if l.AccountID == "" {
			return fmt.Errorf("finance: line %d: account id is required", i)
		}
		if l.Amount <= 0 {
			return fmt.Errorf("finance: line %d: amount must be positive", i)
		}
		switch l.Side {
		case Debit:
			debit += l.Amount
		case Credit:
			credit += l.Amount
		default:
			return fmt.Errorf("finance: line %d: unknown side %q", i, l.Side)
		}
	}
	if debit != credit {
		return fmt.Errorf("%w: debit %d != credit %d", ErrUnbalanced, debit, credit)
	}
	return nil
}
