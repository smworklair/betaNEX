// Package outbox — transactional outbox: надёжный мост между доменным
// изменением и побочным эффектом снаружи (уведомление, email, webhook).
//
// Проблема, которую он решает: команда коммитит данные в Postgres, а
// эффект живёт вне транзакции. Отправить эффект до коммита — он может
// уйти для отменённого изменения; после — процесс может умереть между
// коммитом и отправкой. Outbox записывает намерение в ту же транзакцию,
// что и данные (Queue.Enqueue присоединяется к транзакции команды через
// контекст), а Worker разбирает очередь после коммита.
//
// Семантика доставки — at-least-once: сообщение может прийти повторно
// (воркер умер после обработки, но до отметки done), поэтому обработчики
// обязаны быть идемпотентными.
package outbox

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/platform/postgres"
	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// Message — сообщение очереди, каким его видит обработчик.
type Message struct {
	ID       int64
	TenantID string // пустой = системное сообщение вне tenant'а
	Topic    string
	Payload  []byte // JSON, положенный при Enqueue
	Attempts int    // номер текущей попытки, начиная с 1
}

// Handler обрабатывает сообщение темы. Ошибка возвращает сообщение в
// очередь с экспоненциальной задержкой (до maxAttempts попыток).
type Handler func(ctx context.Context, m Message) error

// Queue кладёт сообщения в outbox. Внутри команды Enqueue присоединяется
// к её транзакции — намерение коммитится атомарно с данными.
type Queue struct {
	db *postgres.DB
}

// NewQueue создаёт очередь поверх подключения к БД.
func NewQueue(d *postgres.DB) *Queue { return &Queue{db: d} }

// Enqueue сериализует payload в JSON и ставит сообщение темы topic.
// Tenant берётся из контекста (его нет — сообщение системное).
func (q *Queue) Enqueue(ctx context.Context, topic string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("outbox: marshal %s: %w", topic, err)
	}
	var tenant pgtype.UUID
	if t, ok := tenancy.TenantFrom(ctx); ok {
		_ = tenant.Scan(t) // не-UUID → NULL: сообщение всё равно ставится
	}
	err = q.db.InTx(ctx, func(ctx context.Context, queries *db.Queries) error {
		return queries.EnqueueOutbox(ctx, db.EnqueueOutboxParams{
			TenantID: tenant, Topic: topic, Payload: body, DelaySecs: 0,
		})
	})
	if err != nil {
		return fmt.Errorf("outbox: enqueue %s: %w", topic, err)
	}
	return nil
}

// Worker разбирает очередь: забирает пачки готовых сообщений (SKIP
// LOCKED — несколько инстансов не мешают друг другу), зовёт обработчик
// темы и отмечает исход. Претензия на сообщение сразу сдвигает его
// available_at с backoff'ом — упавший посреди обработки воркер ничего
// не теряет, сообщение вернётся само.
type Worker struct {
	db          *postgres.DB
	log         *slog.Logger
	interval    time.Duration
	batchSize   int
	maxAttempts int
	handlers    map[string]Handler
}

// WorkerOption настраивает воркер при создании.
type WorkerOption func(*Worker)

// WithInterval задаёт период опроса очереди (по умолчанию 5 секунд).
func WithInterval(d time.Duration) WorkerOption {
	return func(w *Worker) { w.interval = d }
}

// WithMaxAttempts задаёт число попыток до захоронения (по умолчанию 10).
func WithMaxAttempts(n int) WorkerOption {
	return func(w *Worker) { w.maxAttempts = n }
}

// NewWorker создаёт воркер очереди. Обработчики подключаются Handle до Run.
func NewWorker(d *postgres.DB, log *slog.Logger, opts ...WorkerOption) *Worker {
	w := &Worker{
		db: d, log: log,
		interval:    5 * time.Second,
		batchSize:   50,
		maxAttempts: 10,
		handlers:    make(map[string]Handler),
	}
	for _, opt := range opts {
		opt(w)
	}
	return w
}

// Handle регистрирует обработчик темы. Вызывается при старте, до Run.
func (w *Worker) Handle(topic string, h Handler) {
	w.handlers[topic] = h
}

// Run крутит цикл опроса до отмены контекста. Каждый тик выгребает
// очередь до пустой пачки, чтобы хвост не ждал следующего тика.
func (w *Worker) Run(ctx context.Context) error {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			for {
				n, err := w.drainBatch(ctx)
				if err != nil {
					w.log.Error("outbox: drain failed", slog.String("error", err.Error()))
					break
				}
				if n == 0 {
					break
				}
			}
		}
	}
}

// drainBatch забирает и обрабатывает одну пачку; возвращает её размер.
func (w *Worker) drainBatch(ctx context.Context) (int, error) {
	var rows []db.Outbox
	err := w.db.InTx(ctx, func(ctx context.Context, q *db.Queries) error {
		var err error
		rows, err = q.ClaimOutboxBatch(ctx, int32(w.batchSize)) // #nosec G115 -- batchSize мал и задаётся кодом
		return err
	})
	if err != nil {
		return 0, fmt.Errorf("outbox: claim: %w", err)
	}
	for _, row := range rows {
		w.process(ctx, row)
	}
	return len(rows), nil
}

// process исполняет обработчик одного сообщения и фиксирует исход.
func (w *Worker) process(ctx context.Context, row db.Outbox) {
	m := Message{
		ID: row.ID, Topic: row.Topic, Payload: row.Payload, Attempts: int(row.Attempts),
	}
	if row.TenantID.Valid {
		m.TenantID = row.TenantID.String()
	}

	h, known := w.handlers[m.Topic]
	if !known {
		// Неизвестная тема ретраев не заслуживает: это ошибка конфигурации,
		// сообщение хоронится сразу с диагнозом.
		w.finish(ctx, m, fmt.Errorf("no handler registered for topic %q", m.Topic), true)
		return
	}

	// Обработчик получает tenant сообщения в контексте — его запросы
	// уходят в InTenantTx как обычно.
	hctx := ctx
	if m.TenantID != "" {
		hctx = tenancy.WithTenant(ctx, m.TenantID)
	}
	err := h(hctx, m)
	w.finish(ctx, m, err, m.Attempts >= w.maxAttempts)
}

// finish отмечает исход обработки: успех, ретрай или захоронение.
func (w *Worker) finish(ctx context.Context, m Message, herr error, last bool) {
	err := w.db.InTx(ctx, func(ctx context.Context, q *db.Queries) error {
		switch {
		case herr == nil:
			return q.MarkOutboxDone(ctx, m.ID)
		case last:
			w.log.Error("outbox: message buried",
				slog.Int64("id", m.ID), slog.String("topic", m.Topic),
				slog.Int("attempts", m.Attempts), slog.String("error", herr.Error()))
			return q.BuryOutbox(ctx, db.BuryOutboxParams{ID: m.ID, LastError: herr.Error()})
		default:
			w.log.Warn("outbox: handler failed, will retry",
				slog.Int64("id", m.ID), slog.String("topic", m.Topic),
				slog.Int("attempts", m.Attempts), slog.String("error", herr.Error()))
			return q.MarkOutboxFailed(ctx, db.MarkOutboxFailedParams{ID: m.ID, LastError: herr.Error()})
		}
	})
	if err != nil {
		w.log.Error("outbox: finish failed", slog.Int64("id", m.ID), slog.String("error", err.Error()))
	}
}

// Cleanup удаляет обработанные сообщения старше 30 дней (ночной кроном).
func (w *Worker) Cleanup(ctx context.Context) error {
	return w.db.InTx(ctx, func(ctx context.Context, q *db.Queries) error {
		n, err := q.DeleteOldOutbox(ctx)
		if err == nil && n > 0 {
			w.log.Info("outbox: cleaned up", slog.Int64("deleted", n))
		}
		return err
	})
}
