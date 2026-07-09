package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/platform/httpapi"
	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// IdempotencyStore хранит клиентские ключи идемпотентности и ответы
// завершённых запросов (см. httpapi.IdempotencyStore).
type IdempotencyStore struct {
	db *DB
}

// Проверка соответствия интерфейсу на этапе компиляции.
var _ httpapi.IdempotencyStore = (*IdempotencyStore)(nil)

// NewIdempotencyStore создаёт хранилище ключей.
func NewIdempotencyStore(d *DB) *IdempotencyStore { return &IdempotencyStore{db: d} }

// Begin атомарно регистрирует ключ. Возвращает состояние: ключ новый
// (запрос надо исполнить), выполняется другим запросом, либо завершён —
// тогда отдаётся сохранённый ответ.
func (s *IdempotencyStore) Begin(ctx context.Context, key string) (httpapi.IdemState, error) {
	tenant, ok := tenancy.TenantFrom(ctx)
	if !ok {
		return httpapi.IdemState{}, ErrNoTenant
	}
	var tu pgtype.UUID
	if err := tu.Scan(tenant); err != nil {
		return httpapi.IdemState{}, fmt.Errorf("%w: %q", ErrInvalidTenant, tenant)
	}

	var state httpapi.IdemState
	err := s.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		n, err := q.TryInsertIdempotencyKey(ctx, db.TryInsertIdempotencyKeyParams{TenantID: tu, Key: key})
		if err != nil {
			return err
		}
		if n == 1 {
			state = httpapi.IdemState{Fresh: true}
			return nil
		}
		row, err := q.GetIdempotencyKey(ctx, key)
		if errors.Is(err, pgx.ErrNoRows) {
			// Гонка с ночной чисткой: ключ исчез между вставкой и
			// чтением. Регистрируем заново и считаем свежим.
			_, err := q.TryInsertIdempotencyKey(ctx, db.TryInsertIdempotencyKeyParams{TenantID: tu, Key: key})
			state = httpapi.IdemState{Fresh: true}
			return err
		}
		if err != nil {
			return err
		}
		if row.Status == 0 {
			state = httpapi.IdemState{InProgress: true}
			return nil
		}
		state = httpapi.IdemState{
			Done:        true,
			Status:      int(row.Status),
			ContentType: row.ContentType,
			Body:        row.Body,
		}
		return nil
	})
	if err != nil {
		return httpapi.IdemState{}, fmt.Errorf("postgres: idempotency begin: %w", err)
	}
	return state, nil
}

// Complete сохраняет ответ завершённого запроса для будущих повторов.
func (s *IdempotencyStore) Complete(ctx context.Context, key string, status int, contentType string, body []byte) error {
	return s.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		return q.CompleteIdempotencyKey(ctx, db.CompleteIdempotencyKeyParams{
			Key:         key,
			Status:      int32(status), // #nosec G115 -- HTTP-статус < 1000
			ContentType: contentType,
			Body:        body,
		})
	})
}

// Forget удаляет ключ: ответ решено не кэшировать (5xx, слишком большое
// тело) — следующий повтор исполнит запрос заново.
func (s *IdempotencyStore) Forget(ctx context.Context, key string) error {
	return s.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		return q.DeleteIdempotencyKey(ctx, key)
	})
}

// CleanupIdempotencyKeys удаляет ключи старше суток. Вызывается ночной
// cron-задачей per-tenant (таблица под FORCE RLS).
func (d *DB) CleanupIdempotencyKeys(ctx context.Context) error {
	return d.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		_, err := q.DeleteOldIdempotencyKeys(ctx)
		return err
	})
}
