package files

import (
	"context"
	"fmt"

	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/kernel/identity"
)

// Registrar — то, что умеет регистрировать хендлеры команд (шина).
type Registrar interface {
	Register(name string, h command.HandlerFunc) error
}

// RegisterCommands подключает команды модуля к шине. Вызывается один
// раз из композиционного корня.
func RegisterCommands(bus Registrar, repo *Repository) error {
	if err := bus.Register(CmdAttach, func(ctx context.Context, cmd command.Command) error {
		c, ok := cmd.(Attach)
		if !ok {
			return fmt.Errorf("files: %s: unexpected command type %T", CmdAttach, cmd)
		}
		f := File{
			Name:        c.FileName,
			ContentType: c.ContentType,
			Size:        c.Size,
			SHA256:      c.SHA256,
			EntityType:  c.EntityType,
			EntityID:    c.EntityID,
		}
		if actor, ok := identity.ActorFrom(ctx); ok {
			f.UploadedBy = actor.ID
		}
		_, err := repo.Create(ctx, f)
		return err
	}); err != nil {
		return err
	}

	return bus.Register(CmdDelete, func(ctx context.Context, cmd command.Command) error {
		c, ok := cmd.(Delete)
		if !ok {
			return fmt.Errorf("files: %s: unexpected command type %T", CmdDelete, cmd)
		}
		_, _, err := repo.Delete(ctx, c.ID)
		return err
	})
}
