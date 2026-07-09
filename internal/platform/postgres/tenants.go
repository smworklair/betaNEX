package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// ErrTenantNotFound — tenant с таким slug'ом не зарегистрирован.
// HTTP-слой отображает её в 400: клиент назвал несуществующую организацию.
var ErrTenantNotFound = errors.New("postgres: tenant not found")

// ResolveTenant приводит идентификатор tenant'а из запроса к UUID:
// UUID проходит как есть, всё остальное трактуется как slug и ищется
// в реестре. Возвращённый UUID кладётся в tenant-контекст запроса,
// и дальше RLS работает только с ним.
func (d *DB) ResolveTenant(ctx context.Context, v string) (string, error) {
	var u pgtype.UUID
	if err := u.Scan(v); err == nil {
		return v, nil
	}
	t, err := db.New(d.pool).GetTenantBySlug(ctx, v)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("%w: %q", ErrTenantNotFound, v)
	}
	if err != nil {
		return "", fmt.Errorf("postgres: resolve tenant %q: %w", v, err)
	}
	return t.ID.String(), nil
}

// EnsureTenant возвращает UUID tenant'а по slug'у, создавая его при
// отсутствии. Используется только в development (см. cmd/nexd): локальная
// разработка не должна начинаться с ручной регистрации организации.
func (d *DB) EnsureTenant(ctx context.Context, slug string) (string, error) {
	id, err := d.ResolveTenant(ctx, slug)
	if !errors.Is(err, ErrTenantNotFound) {
		return id, err
	}
	t, err := db.New(d.pool).CreateTenant(ctx, db.CreateTenantParams{Slug: slug, Name: slug})
	if err != nil {
		return "", fmt.Errorf("postgres: create tenant %q: %w", slug, err)
	}
	return t.ID.String(), nil
}

// CreateTenant регистрирует организацию. Используется подкомандой
// `nexd tenant create` при развёртывании нового tenant'а.
func (d *DB) CreateTenant(ctx context.Context, slug, name string) (string, error) {
	t, err := db.New(d.pool).CreateTenant(ctx, db.CreateTenantParams{Slug: slug, Name: name})
	if err != nil {
		return "", fmt.Errorf("postgres: create tenant %q: %w", slug, err)
	}
	return t.ID.String(), nil
}

// ForEachTenant исполняет fn в контексте каждого зарегистрированного
// tenant'а. Для регламентных задач (пересчёт витрин): задача работает
// под RLS каждого tenant'а по очереди, как работал бы человек.
func (d *DB) ForEachTenant(ctx context.Context, fn func(ctx context.Context) error) error {
	ids, err := db.New(d.pool).ListTenantIDs(ctx)
	if err != nil {
		return fmt.Errorf("postgres: list tenants: %w", err)
	}
	for _, id := range ids {
		if err := fn(tenancy.WithTenant(ctx, id.String())); err != nil {
			return fmt.Errorf("postgres: tenant %s: %w", id.String(), err)
		}
	}
	return nil
}
