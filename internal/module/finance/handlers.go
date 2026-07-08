package finance

import (
	"context"
	"fmt"
	"time"

	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/kernel/identity"
)

// Registrar — то, что умеет регистрировать хендлеры команд (шина).
// Локальный интерфейс, чтобы модуль не зависел от конкретной реализации.
type Registrar interface {
	Register(name string, h command.HandlerFunc) error
}

// RegisterCommands подключает команды модуля к шине. Вызывается один раз
// из композиционного корня (cmd/nexd).
func RegisterCommands(bus Registrar, repo Repository) error {
	if err := bus.Register(CmdAccountCreate, func(ctx context.Context, cmd command.Command) error {
		c, ok := cmd.(CreateAccount)
		if !ok {
			return fmt.Errorf("finance: %s: unexpected command type %T", CmdAccountCreate, cmd)
		}
		currency := c.Currency
		if currency == "" {
			currency = "RUB"
		}
		return repo.CreateAccount(ctx, Account{
			ID:        newID(),
			Code:      c.Code,
			Name:      c.DisplayName,
			Type:      c.AccountType,
			Currency:  currency,
			CreatedAt: time.Now().UTC(),
		})
	}); err != nil {
		return err
	}

	return bus.Register(CmdEntryPost, func(ctx context.Context, cmd command.Command) error {
		c, ok := cmd.(PostEntry)
		if !ok {
			return fmt.Errorf("finance: %s: unexpected command type %T", CmdEntryPost, cmd)
		}
		e := Entry{
			ID:       newID(),
			Memo:     c.Memo,
			Lines:    c.Lines,
			PostedAt: time.Now().UTC(),
		}
		if actor, ok := identity.ActorFrom(ctx); ok {
			e.PostedBy = actor.ID
		}
		// Событие EntryPosted начнёт публиковаться, когда появится
		// outbox-доставка (веха M2); контракт объявлен в events.go.
		return repo.PostEntry(ctx, e)
	})
}
