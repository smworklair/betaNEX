package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/smworklair/betakis/internal/kernel/auth"
	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// AuthStore — реализация auth.Store поверх Postgres. Запросы к users
// идут через InTenantTx (таблица под FORCE RLS); сессии ищутся напрямую
// по хэшу токена — их таблица сознательно без RLS, потому что tenant
// на этом шаге ещё неизвестен.
type AuthStore struct {
	db *DB
}

// Проверка соответствия интерфейсу на этапе компиляции.
var _ auth.Store = (*AuthStore)(nil)

// NewAuthStore создаёт хранилище поверх подключения к БД.
func NewAuthStore(d *DB) *AuthStore { return &AuthStore{db: d} }

// UserByEmail возвращает пользователя tenant'а из контекста.
func (s *AuthStore) UserByEmail(ctx context.Context, email string) (auth.User, error) {
	return s.user(ctx, func(q *db.Queries) (db.User, error) {
		return q.GetUserByEmail(ctx, email)
	})
}

// UserByID возвращает пользователя tenant'а из контекста.
func (s *AuthStore) UserByID(ctx context.Context, id string) (auth.User, error) {
	var u pgtype.UUID
	if err := u.Scan(id); err != nil {
		return auth.User{}, auth.ErrNoUser
	}
	return s.user(ctx, func(q *db.Queries) (db.User, error) {
		return q.GetUserByID(ctx, u)
	})
}

func (s *AuthStore) user(ctx context.Context, get func(q *db.Queries) (db.User, error)) (auth.User, error) {
	var out auth.User
	err := s.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		row, err := get(q)
		if errors.Is(err, pgx.ErrNoRows) {
			return auth.ErrNoUser
		}
		if err != nil {
			return err
		}
		out = userFromRow(row)
		return nil
	})
	if errors.Is(err, ErrNoTenant) || errors.Is(err, ErrInvalidTenant) {
		return auth.User{}, auth.ErrNoUser
	}
	return out, err
}

// CreateUser регистрирует пользователя в tenant'е из контекста.
// Используется подкомандой `nexd user create`.
func (s *AuthStore) CreateUser(ctx context.Context, u auth.User) (auth.User, error) {
	var out auth.User
	err := s.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		var tenant pgtype.UUID
		if err := tenant.Scan(u.TenantID); err != nil {
			return fmt.Errorf("%w: %q", ErrInvalidTenant, u.TenantID)
		}
		row, err := q.CreateUser(ctx, db.CreateUserParams{
			TenantID:     tenant,
			Email:        u.Email,
			PasswordHash: u.PasswordHash,
			DisplayName:  u.DisplayName,
			Roles:        u.Roles,
		})
		if err != nil {
			return err
		}
		out = userFromRow(row)
		return nil
	})
	return out, err
}

// CreateSession сохраняет новую сессию.
func (s *AuthStore) CreateSession(ctx context.Context, sess auth.Session) error {
	var tenant, user pgtype.UUID
	if err := tenant.Scan(sess.TenantID); err != nil {
		return fmt.Errorf("%w: %q", ErrInvalidTenant, sess.TenantID)
	}
	if err := user.Scan(sess.UserID); err != nil {
		return fmt.Errorf("postgres: session user id: %q", sess.UserID)
	}
	return db.New(s.db.pool).CreateSession(ctx, db.CreateSessionParams{
		TenantID:  tenant,
		UserID:    user,
		TokenHash: sess.TokenHash,
		ExpiresAt: pgtype.Timestamptz{Time: sess.ExpiresAt, Valid: true},
	})
}

// SessionByTokenHash возвращает живую сессию или auth.ErrSessionInvalid.
func (s *AuthStore) SessionByTokenHash(ctx context.Context, hash []byte) (auth.Session, error) {
	row, err := db.New(s.db.pool).GetLiveSessionByTokenHash(ctx, hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.Session{}, auth.ErrSessionInvalid
	}
	if err != nil {
		return auth.Session{}, fmt.Errorf("postgres: session lookup: %w", err)
	}
	return auth.Session{
		TenantID:  row.TenantID.String(),
		UserID:    row.UserID.String(),
		TokenHash: row.TokenHash,
		ExpiresAt: row.ExpiresAt.Time,
	}, nil
}

// RevokeSession отзывает сессию по хэшу токена. Идемпотентен.
func (s *AuthStore) RevokeSession(ctx context.Context, hash []byte) error {
	return db.New(s.db.pool).RevokeSessionByTokenHash(ctx, hash)
}

// userFromRow переводит строку БД в тип ядра.
func userFromRow(row db.User) auth.User {
	return auth.User{
		ID:           row.ID.String(),
		TenantID:     row.TenantID.String(),
		Email:        row.Email,
		DisplayName:  row.DisplayName,
		Roles:        row.Roles,
		PasswordHash: row.PasswordHash,
		Active:       row.IsActive,
	}
}
