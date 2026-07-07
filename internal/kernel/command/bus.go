package command

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/smworklair/betakis/internal/kernel/audit"
	"github.com/smworklair/betakis/internal/kernel/identity"
	"github.com/smworklair/betakis/internal/kernel/tenancy"
)

// HandlerFunc исполняет команду. Хендлеры регистрируются модулями
// при старте приложения (композиционный корень — cmd/nexd).
type HandlerFunc func(ctx context.Context, cmd Command) error

// Authorizer решает, разрешено ли актору из контекста исполнить команду.
// Реализация — authz.PolicyAuthorizer; интерфейс объявлен здесь, чтобы
// пакет command не зависел от authz (зависимости направлены внутрь).
type Authorizer interface {
	Authorize(ctx context.Context, cmd Command) error
}

// Ошибки шины. Проверяются через errors.Is.
var (
	ErrUnknownCommand    = errors.New("command: unknown command")
	ErrAlreadyRegistered = errors.New("command: handler already registered")
)

// MemoryBus — in-memory реализация шины команд: валидация → авторизация →
// исполнение → аудит. Каждый исход (успех, отказ, ошибка) фиксируется
// в журнале.
//
// Транзакционность появится вместе со слоем Postgres (веха M2): тогда
// исполнение, события и запись аудита будут выполняться в одной
// транзакции. Контракт Dispatch при этом не изменится.
type MemoryBus struct {
	authz Authorizer
	rec   audit.Recorder

	mu       sync.RWMutex
	handlers map[string]HandlerFunc
}

// Проверка соответствия интерфейсу на этапе компиляции.
var _ Bus = (*MemoryBus)(nil)

// NewMemoryBus создаёт шину с заданными авторизатором и рекордером аудита.
func NewMemoryBus(authz Authorizer, rec audit.Recorder) *MemoryBus {
	return &MemoryBus{
		authz:    authz,
		rec:      rec,
		handlers: make(map[string]HandlerFunc),
	}
}

// Register связывает имя команды с хендлером. Повторная регистрация
// одного имени — ошибка программиста, поэтому она возвращается явно.
func (b *MemoryBus) Register(name string, h HandlerFunc) error {
	if name == "" || h == nil {
		return fmt.Errorf("command: register %q: empty name or nil handler", name)
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, dup := b.handlers[name]; dup {
		return fmt.Errorf("%w: %s", ErrAlreadyRegistered, name)
	}
	b.handlers[name] = h
	return nil
}

// Dispatch проводит команду по полному циклу. Порядок шагов совпадает
// с контрактом пакета (см. command.go): сначала дешёвые проверки,
// затем исполнение, и любой исход попадает в аудит.
func (b *MemoryBus) Dispatch(ctx context.Context, cmd Command) error {
	b.mu.RLock()
	h, ok := b.handlers[cmd.Name()]
	b.mu.RUnlock()
	if !ok {
		b.record(ctx, cmd, audit.OutcomeError, "handler not registered")
		return fmt.Errorf("%w: %s", ErrUnknownCommand, cmd.Name())
	}

	if err := cmd.Validate(); err != nil {
		b.record(ctx, cmd, audit.OutcomeError, "validation: "+err.Error())
		return fmt.Errorf("command %s: validate: %w", cmd.Name(), err)
	}

	if err := b.authz.Authorize(ctx, cmd); err != nil {
		b.record(ctx, cmd, audit.OutcomeDenied, err.Error())
		return fmt.Errorf("command %s: %w", cmd.Name(), err)
	}

	if err := h(ctx, cmd); err != nil {
		b.record(ctx, cmd, audit.OutcomeError, err.Error())
		return fmt.Errorf("command %s: %w", cmd.Name(), err)
	}

	b.record(ctx, cmd, audit.OutcomeOK, "")
	return nil
}

// record собирает запись журнала из контекста запроса и передаёт её
// рекордеру. Отсутствие актора или tenant'а не ошибка на этом уровне:
// запись честно фиксирует, что их не было.
func (b *MemoryBus) record(ctx context.Context, cmd Command, outcome audit.Outcome, detail string) {
	e := audit.Entry{
		Command:    cmd.Name(),
		Outcome:    outcome,
		Detail:     detail,
		OccurredAt: time.Now().UTC(),
	}
	if actor, ok := identity.ActorFrom(ctx); ok {
		e.ActorID = actor.ID
	}
	if tenant, ok := tenancy.TenantFrom(ctx); ok {
		e.TenantID = tenant
	}
	b.rec.Record(ctx, e)
}
