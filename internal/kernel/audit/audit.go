package audit

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// Outcome — исход команды, зафиксированный в журнале.
type Outcome string

// Возможные исходы.
const (
	OutcomeOK     Outcome = "ok"     // команда исполнена
	OutcomeDenied Outcome = "denied" // отказ авторизации
	OutcomeError  Outcome = "error"  // ошибка валидации или исполнения
)

// Entry — одна запись журнала: кто, что, когда и с каким исходом.
type Entry struct {
	Command    string    // имя команды, напр. "college.student.enroll"
	Outcome    Outcome   // исход
	ActorID    string    // кто (пусто = аноним/система)
	TenantID   string    // в каком tenant'е
	Detail     string    // подробности (текст ошибки, причина отказа)
	TraceID    string    // X-Request-Id запроса; заполняется при чтении
	OccurredAt time.Time // момент фиксации (UTC)
}

// Filter — параметры выборки журнала для вьюера «кто что менял».
type Filter struct {
	Limit   int    // максимум записей (0 = разумный дефолт реализации)
	Command string // пусто = любые команды
	ActorID string // пусто = любые акторы
}

// Reader отдаёт записи журнала текущего tenant'а, свежие первыми.
// Реализация — поверх Postgres (RLS сама ограничит tenant'ом).
type Reader interface {
	Entries(ctx context.Context, f Filter) ([]Entry, error)
}

// Recorder фиксирует записи журнала. Postgres-реализация пишет в той же
// транзакции, что и изменение данных (см. platform/postgres), поэтому
// Record возвращает ошибку: несохранённый аудит обязан откатить и само
// изменение — журнал не может разойтись с данными.
type Recorder interface {
	Record(ctx context.Context, e Entry) error
}

// SlogRecorder — временная реализация Recorder: пишет журнал в структурный
// лог процесса. Используется, пока нет слоя Postgres.
type SlogRecorder struct {
	log *slog.Logger
}

// NewSlogRecorder создаёт рекордер поверх переданного логгера.
func NewSlogRecorder(log *slog.Logger) *SlogRecorder {
	return &SlogRecorder{log: log}
}

// Record пишет запись журнала одной строкой лога.
func (r *SlogRecorder) Record(ctx context.Context, e Entry) error {
	r.log.LogAttrs(ctx, slog.LevelInfo, "audit",
		slog.String("command", e.Command),
		slog.String("outcome", string(e.Outcome)),
		slog.String("actor_id", e.ActorID),
		slog.String("tenant_id", e.TenantID),
		slog.String("detail", e.Detail),
		slog.Time("occurred_at", e.OccurredAt),
	)
	return nil
}

// MemoryRecorder накапливает записи в памяти. Предназначен для тестов.
type MemoryRecorder struct {
	mu      sync.Mutex
	entries []Entry
}

// Record добавляет запись в память.
func (r *MemoryRecorder) Record(_ context.Context, e Entry) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.entries = append(r.entries, e)
	return nil
}

// Entries возвращает копию накопленных записей.
func (r *MemoryRecorder) Entries() []Entry {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Entry, len(r.entries))
	copy(out, r.entries)
	return out
}
