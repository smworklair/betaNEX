package command_test

import (
	"context"
	"errors"
	"testing"

	"github.com/smworklair/betakis/internal/kernel/audit"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/kernel/identity"
	"github.com/smworklair/betakis/internal/kernel/tenancy"
)

// testCmd — минимальная команда для тестов шины.
type testCmd struct {
	name        string
	perm        string
	validateErr error
}

func (c testCmd) Name() string       { return c.name }
func (c testCmd) Permission() string { return c.perm }
func (c testCmd) Validate() error    { return c.validateErr }

// allowAll разрешает всё; denyAll отклоняет всё с заданной ошибкой.
type allowAll struct{}

func (allowAll) Authorize(context.Context, command.Command) error { return nil }

type denyAll struct{ err error }

func (d denyAll) Authorize(context.Context, command.Command) error { return d.err }

// ctxWithActor — контекст с актором и tenant'ом, как после middleware.
func ctxWithActor() context.Context {
	ctx := identity.WithActor(context.Background(), identity.Actor{ID: "user-1", Roles: []string{"admin"}})
	return tenancy.WithTenant(ctx, "tenant-1")
}

// lastEntry возвращает последнюю запись аудита или падает.
func lastEntry(t *testing.T, rec *audit.MemoryRecorder) audit.Entry {
	t.Helper()
	entries := rec.Entries()
	if len(entries) == 0 {
		t.Fatal("аудит пуст, ожидалась хотя бы одна запись")
	}
	return entries[len(entries)-1]
}

func TestDispatchSuccess(t *testing.T) {
	rec := &audit.MemoryRecorder{}
	bus := command.NewMemoryBus(allowAll{}, rec)

	handled := false
	if err := bus.Register("test.do", func(context.Context, command.Command) error {
		handled = true
		return nil
	}); err != nil {
		t.Fatalf("Register: %v", err)
	}

	if err := bus.Dispatch(ctxWithActor(), testCmd{name: "test.do", perm: "test:do"}); err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if !handled {
		t.Error("хендлер не был вызван")
	}

	e := lastEntry(t, rec)
	if e.Outcome != audit.OutcomeOK {
		t.Errorf("outcome = %q, want %q", e.Outcome, audit.OutcomeOK)
	}
	if e.ActorID != "user-1" || e.TenantID != "tenant-1" {
		t.Errorf("актор/tenant не попали в аудит: %+v", e)
	}
}

func TestDispatchValidationError(t *testing.T) {
	rec := &audit.MemoryRecorder{}
	bus := command.NewMemoryBus(allowAll{}, rec)

	handled := false
	_ = bus.Register("test.do", func(context.Context, command.Command) error {
		handled = true
		return nil
	})

	wantErr := errors.New("bad input")
	err := bus.Dispatch(ctxWithActor(), testCmd{name: "test.do", perm: "test:do", validateErr: wantErr})
	if !errors.Is(err, wantErr) {
		t.Fatalf("Dispatch err = %v, want wrap of %v", err, wantErr)
	}
	if handled {
		t.Error("хендлер вызван несмотря на ошибку валидации")
	}
	if e := lastEntry(t, rec); e.Outcome != audit.OutcomeError {
		t.Errorf("outcome = %q, want %q", e.Outcome, audit.OutcomeError)
	}
}

func TestDispatchDenied(t *testing.T) {
	rec := &audit.MemoryRecorder{}
	denied := errors.New("authz: access denied")
	bus := command.NewMemoryBus(denyAll{err: denied}, rec)

	handled := false
	_ = bus.Register("test.do", func(context.Context, command.Command) error {
		handled = true
		return nil
	})

	err := bus.Dispatch(ctxWithActor(), testCmd{name: "test.do", perm: "test:do"})
	if !errors.Is(err, denied) {
		t.Fatalf("Dispatch err = %v, want wrap of %v", err, denied)
	}
	if handled {
		t.Error("хендлер вызван несмотря на отказ авторизации")
	}
	if e := lastEntry(t, rec); e.Outcome != audit.OutcomeDenied {
		t.Errorf("outcome = %q, want %q", e.Outcome, audit.OutcomeDenied)
	}
}

func TestDispatchHandlerError(t *testing.T) {
	rec := &audit.MemoryRecorder{}
	bus := command.NewMemoryBus(allowAll{}, rec)

	wantErr := errors.New("db is down")
	_ = bus.Register("test.do", func(context.Context, command.Command) error {
		return wantErr
	})

	err := bus.Dispatch(ctxWithActor(), testCmd{name: "test.do", perm: "test:do"})
	if !errors.Is(err, wantErr) {
		t.Fatalf("Dispatch err = %v, want wrap of %v", err, wantErr)
	}
	if e := lastEntry(t, rec); e.Outcome != audit.OutcomeError {
		t.Errorf("outcome = %q, want %q", e.Outcome, audit.OutcomeError)
	}
}

func TestDispatchUnknownCommand(t *testing.T) {
	rec := &audit.MemoryRecorder{}
	bus := command.NewMemoryBus(allowAll{}, rec)

	err := bus.Dispatch(ctxWithActor(), testCmd{name: "test.missing", perm: "test:do"})
	if !errors.Is(err, command.ErrUnknownCommand) {
		t.Fatalf("Dispatch err = %v, want ErrUnknownCommand", err)
	}
	if e := lastEntry(t, rec); e.Outcome != audit.OutcomeError {
		t.Errorf("outcome = %q, want %q", e.Outcome, audit.OutcomeError)
	}
}

func TestRegisterDuplicate(t *testing.T) {
	bus := command.NewMemoryBus(allowAll{}, &audit.MemoryRecorder{})

	noop := func(context.Context, command.Command) error { return nil }
	if err := bus.Register("test.do", noop); err != nil {
		t.Fatalf("первая регистрация: %v", err)
	}
	if err := bus.Register("test.do", noop); !errors.Is(err, command.ErrAlreadyRegistered) {
		t.Fatalf("повторная регистрация: err = %v, want ErrAlreadyRegistered", err)
	}
}

func TestRegisterInvalid(t *testing.T) {
	bus := command.NewMemoryBus(allowAll{}, &audit.MemoryRecorder{})

	if err := bus.Register("", func(context.Context, command.Command) error { return nil }); err == nil {
		t.Error("регистрация с пустым именем должна возвращать ошибку")
	}
	if err := bus.Register("test.do", nil); err == nil {
		t.Error("регистрация nil-хендлера должна возвращать ошибку")
	}
}
