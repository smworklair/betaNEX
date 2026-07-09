package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
)

// Ошибки аутентификации. ErrInvalidCredentials намеренно одна на все
// причины отказа (нет пользователя, неверный пароль, отключён): ответ
// не должен раскрывать, какая часть пары email/пароль неверна.
var (
	ErrInvalidCredentials = errors.New("auth: invalid credentials")
	ErrSessionInvalid     = errors.New("auth: session invalid or expired")
)

// User — учётная запись в tenant'е, как её видит ядро.
type User struct {
	ID           string
	TenantID     string
	Email        string
	DisplayName  string
	Roles        []string
	PasswordHash string
	Active       bool
}

// Session — server-side сессия. Токен хранится только как sha256-хэш.
type Session struct {
	TenantID  string
	UserID    string
	TokenHash []byte
	ExpiresAt time.Time
}

// Store — хранилище пользователей и сессий (реализация: platform/postgres).
// Методы, читающие users, требуют tenant в контексте — таблица под RLS.
type Store interface {
	// UserByEmail возвращает пользователя tenant'а из контекста.
	UserByEmail(ctx context.Context, email string) (User, error)
	// UserByID возвращает пользователя tenant'а из контекста.
	UserByID(ctx context.Context, id string) (User, error)
	// CreateSession сохраняет новую сессию.
	CreateSession(ctx context.Context, s Session) error
	// SessionByTokenHash возвращает живую (не отозванную, не истёкшую)
	// сессию или ErrSessionInvalid.
	SessionByTokenHash(ctx context.Context, hash []byte) (Session, error)
	// RevokeSession отзывает сессию по хэшу токена. Отзыв уже отозванной
	// сессии не ошибка.
	RevokeSession(ctx context.Context, hash []byte) error
}

// ErrNoUser возвращается Store, когда пользователя нет; сервис
// переводит её в ErrInvalidCredentials, чтобы наружу ушёл один ответ.
var ErrNoUser = errors.New("auth: user not found")

// Service — сценарии аутентификации поверх Store.
type Service struct {
	store Store
	ttl   time.Duration
	now   func() time.Time
}

// NewService создаёт сервис с заданным временем жизни сессии.
func NewService(store Store, ttl time.Duration) *Service {
	return &Service{store: store, ttl: ttl, now: time.Now}
}

// dummyHash — хэш несуществующего пароля. Проверяется, когда пользователь
// не найден: время ответа не выдаёт, существует ли email.
var dummyHash = func() string {
	h, err := HashPassword("nex-timing-equalizer")
	if err != nil {
		panic("auth: init dummy hash: " + err.Error())
	}
	return h
}()

// Login проверяет пару email/пароль в tenant'е из контекста и открывает
// сессию. Возвращает opaque-токен (единственный раз, когда он существует
// в открытом виде) и пользователя.
func (s *Service) Login(ctx context.Context, email, password string) (string, User, error) {
	tenant, ok := tenancy.TenantFrom(ctx)
	if !ok {
		return "", User{}, fmt.Errorf("%w: no tenant", ErrInvalidCredentials)
	}

	u, err := s.store.UserByEmail(ctx, email)
	if errors.Is(err, ErrNoUser) {
		// Выравнивание времени: прогоняем argon2 и для «нет пользователя».
		_, _ = VerifyPassword(password, dummyHash)
		return "", User{}, ErrInvalidCredentials
	}
	if err != nil {
		return "", User{}, fmt.Errorf("auth: login: %w", err)
	}

	match, err := VerifyPassword(password, u.PasswordHash)
	if err != nil {
		return "", User{}, fmt.Errorf("auth: login: %w", err)
	}
	if !match || !u.Active {
		return "", User{}, ErrInvalidCredentials
	}

	token, hash, err := newToken()
	if err != nil {
		return "", User{}, err
	}
	err = s.store.CreateSession(ctx, Session{
		TenantID:  tenant,
		UserID:    u.ID,
		TokenHash: hash,
		ExpiresAt: s.now().Add(s.ttl),
	})
	if err != nil {
		return "", User{}, fmt.Errorf("auth: create session: %w", err)
	}
	return token, u, nil
}

// Authenticate проверяет токен и возвращает пользователя сессии.
// Пользователь ищется в tenant'е сессии — вызывающему остаётся положить
// актора и tenant в контекст запроса.
func (s *Service) Authenticate(ctx context.Context, token string) (User, error) {
	sess, err := s.store.SessionByTokenHash(ctx, hashToken(token))
	if err != nil {
		return User{}, err
	}
	u, err := s.store.UserByID(tenancy.WithTenant(ctx, sess.TenantID), sess.UserID)
	if errors.Is(err, ErrNoUser) {
		return User{}, ErrSessionInvalid
	}
	if err != nil {
		return User{}, fmt.Errorf("auth: authenticate: %w", err)
	}
	if !u.Active {
		return User{}, ErrSessionInvalid
	}
	return u, nil
}

// Logout отзывает сессию токена. Идемпотентен.
func (s *Service) Logout(ctx context.Context, token string) error {
	return s.store.RevokeSession(ctx, hashToken(token))
}

// newToken генерирует 256-битный opaque-токен и его sha256-хэш.
func newToken() (string, []byte, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("auth: token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	return token, hashToken(token), nil
}

// hashToken возвращает sha256 от токена — только он попадает в БД.
func hashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
