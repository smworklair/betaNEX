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

// TxRunner исполняет функцию в транзакции хранилища: открытая транзакция
// передаётся через контекст, и репозитории с рекордером аудита
// присоединяются к ней (см. platform/postgres). Интерфейс объявлен здесь,
// чтобы пакет command не зависел от конкретного хранилища.
type TxRunner interface {
	RunTx(ctx context.Context, fn func(ctx context.Context) error) error
}

// Ошибки шины. Проверяются через errors.Is.
var (
	ErrUnknownCommand    = errors.New("command: unknown command")
	ErrAlreadyRegistered = errors.New("command: handler already registered")
)

// MemoryBus — реализация шины команд: валидация → авторизация →
// исполнение → аудит. Каждый исход (успех, отказ, ошибка) фиксируется
// в журнале.
//
// С TxRunner (WithTxRunner) исполнение хендлера и запись аудита успеха
// происходят в одной транзакции: изменение данных без записи журнала
// невозможно, и наоборот. Без TxRunner шина работает в памяти — для
// тестов и in-memory режима.
type MemoryBus struct {
	authz Authorizer
	rec   audit.Recorder
	tx    TxRunner // nil = без транзакций

	mu       sync.RWMutex
	handlers map[string]HandlerFunc
}

// Проверка соответствия интерфейсу на этапе компиляции.
var _ Bus = (*MemoryBus)(nil)

// Option настраивает шину при создании.
type Option func(*MemoryBus)

// WithTxRunner заставляет шину исполнять хендлер и аудит успеха в одной
// транзакции хранилища.
func WithTxRunner(tx TxRunner) Option {
	return func(b *MemoryBus) { b.tx = tx }
}

// NewMemoryBus создаёт шину с заданными авторизатором и рекордером аудита.
func NewMemoryBus(authz Authorizer, rec audit.Recorder, opts ...Option) *MemoryBus {
	b := &MemoryBus{
		authz:    authz,
		rec:      rec,
		handlers: make(map[string]HandlerFunc),
	}
	for _, opt := range opts {
		opt(b)
	}
	return b
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

	if err := b.execute(ctx, h, cmd); err != nil {
		// Запись об ошибке — после отката, отдельной транзакцией: внутри
		// откатившейся она исчезла бы вместе с изменениями.
		b.record(ctx, cmd, audit.OutcomeError, err.Error())
		return fmt.Errorf("command %s: %w", cmd.Name(), err)
	}
	return nil
}

// execute исполняет хендлер и фиксирует успех. С TxRunner оба шага идут
// в одной транзакции: не записался аудит — откатилось и изменение.
func (b *MemoryBus) execute(ctx context.Context, h HandlerFunc, cmd Command) error {
	run := func(ctx context.Context) error {
		if err := h(ctx, cmd); err != nil {
			return err
		}
		return b.recordErr(ctx, cmd, audit.OutcomeOK, "")
	}
	if b.tx == nil {
		return run(ctx)
	}
	return b.tx.RunTx(ctx, run)
}

// record — как recordErr, но для исходов denied/error: там запись
// журнала best-effort (основная ошибка уже возвращается вызывающему,
// а провал самой записи фиксировать некуда).
func (b *MemoryBus) record(ctx context.Context, cmd Command, outcome audit.Outcome, detail string) {
	_ = b.recordErr(ctx, cmd, outcome, detail)
}

// recordErr собирает запись журнала из контекста запроса и передаёт её
// рекордеру. Отсутствие актора или tenant'а не ошибка на этом уровне:
// запись честно фиксирует, что их не было.
func (b *MemoryBus) recordErr(ctx context.Context, cmd Command, outcome audit.Outcome, detail string) error {
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
	if err := b.rec.Record(ctx, e); err != nil {
		return fmt.Errorf("command: audit record: %w", err)
	}
	return nil
}
