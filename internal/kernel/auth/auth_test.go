package auth

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
)

func TestPasswordHashAndVerify(t *testing.T) {
	hash, err := HashPassword("s3cret-пароль")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Errorf("хэш не в формате PHC: %s", hash)
	}

	ok, err := VerifyPassword("s3cret-пароль", hash)
	if err != nil || !ok {
		t.Errorf("верный пароль: ok=%v, err=%v", ok, err)
	}
	ok, err = VerifyPassword("не тот пароль", hash)
	if err != nil || ok {
		t.Errorf("неверный пароль: ok=%v, err=%v", ok, err)
	}
	if _, err := VerifyPassword("x", "$md5$broken"); !errors.Is(err, ErrHashFormat) {
		t.Errorf("кривой хэш: err=%v, want ErrHashFormat", err)
	}

	// Одинаковые пароли дают разные хэши (соль).
	hash2, _ := HashPassword("s3cret-пароль")
	if hash == hash2 {
		t.Error("два хэша одного пароля совпали — соль не работает")
	}
}

// memStore — минимальный Store в памяти для тестов сервиса.
type memStore struct {
	users    map[string]User // email → user
	sessions map[string]Session
}

func (m *memStore) key(hash []byte) string { return string(hash) }

func (m *memStore) UserByEmail(ctx context.Context, email string) (User, error) {
	tenant, _ := tenancy.TenantFrom(ctx)
	u, ok := m.users[email]
	if !ok || u.TenantID != tenant {
		return User{}, ErrNoUser
	}
	return u, nil
}

func (m *memStore) UserByID(ctx context.Context, id string) (User, error) {
	tenant, _ := tenancy.TenantFrom(ctx)
	for _, u := range m.users {
		if u.ID == id && u.TenantID == tenant {
			return u, nil
		}
	}
	return User{}, ErrNoUser
}

func (m *memStore) CreateSession(_ context.Context, s Session) error {
	m.sessions[m.key(s.TokenHash)] = s
	return nil
}

func (m *memStore) SessionByTokenHash(_ context.Context, hash []byte) (Session, error) {
	s, ok := m.sessions[m.key(hash)]
	if !ok || time.Now().After(s.ExpiresAt) {
		return Session{}, ErrSessionInvalid
	}
	return s, nil
}

func (m *memStore) RevokeSession(_ context.Context, hash []byte) error {
	delete(m.sessions, m.key(hash))
	return nil
}

func (m *memStore) ExtendSession(_ context.Context, hash []byte, expiresAt time.Time) error {
	if s, ok := m.sessions[m.key(hash)]; ok {
		s.ExpiresAt = expiresAt
		m.sessions[m.key(hash)] = s
	}
	return nil
}

func newTestService(t *testing.T) (*Service, *memStore, context.Context) {
	t.Helper()
	hash, err := HashPassword("верный-пароль")
	if err != nil {
		t.Fatal(err)
	}
	store := &memStore{
		users: map[string]User{
			"admin@college.ru": {
				ID: "u-1", TenantID: "t-1", Email: "admin@college.ru",
				Roles: []string{"admin"}, PasswordHash: hash, Active: true,
			},
		},
		sessions: map[string]Session{},
	}
	return NewService(store, time.Hour), store, tenancy.WithTenant(context.Background(), "t-1")
}

func TestLoginLogoutFlow(t *testing.T) {
	svc, _, ctx := newTestService(t)

	token, u, err := svc.Login(ctx, "admin@college.ru", "верный-пароль")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if u.ID != "u-1" || token == "" {
		t.Fatalf("Login: user=%+v, token=%q", u, token)
	}

	got, err := svc.Authenticate(context.Background(), token)
	if err != nil || got.ID != "u-1" {
		t.Fatalf("Authenticate: user=%+v, err=%v", got, err)
	}

	if err := svc.Logout(context.Background(), token); err != nil {
		t.Fatalf("Logout: %v", err)
	}
	if _, err := svc.Authenticate(context.Background(), token); !errors.Is(err, ErrSessionInvalid) {
		t.Errorf("после Logout: err=%v, want ErrSessionInvalid", err)
	}
}

func TestLoginRejections(t *testing.T) {
	svc, store, ctx := newTestService(t)

	cases := []struct {
		name            string
		ctx             context.Context
		email, password string
	}{
		{"неверный пароль", ctx, "admin@college.ru", "не тот"},
		{"неизвестный email", ctx, "ghost@college.ru", "верный-пароль"},
		{"чужой tenant", tenancy.WithTenant(context.Background(), "t-2"), "admin@college.ru", "верный-пароль"},
		{"без tenant'а", context.Background(), "admin@college.ru", "верный-пароль"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := svc.Login(tc.ctx, tc.email, tc.password); !errors.Is(err, ErrInvalidCredentials) {
				t.Errorf("err = %v, want ErrInvalidCredentials", err)
			}
		})
	}

	t.Run("отключённый пользователь", func(t *testing.T) {
		u := store.users["admin@college.ru"]
		u.Active = false
		store.users["admin@college.ru"] = u
		if _, _, err := svc.Login(ctx, "admin@college.ru", "верный-пароль"); !errors.Is(err, ErrInvalidCredentials) {
			t.Errorf("err = %v, want ErrInvalidCredentials", err)
		}
	})
}

func TestSlidingSessionRefresh(t *testing.T) {
	svc, store, ctx := newTestService(t)
	token, _, err := svc.Login(ctx, "admin@college.ru", "верный-пароль")
	if err != nil {
		t.Fatal(err)
	}

	// Свежая сессия (осталось больше половины TTL) не продлевается.
	if _, refreshed, err := svc.AuthenticateTouch(context.Background(), token); err != nil || refreshed {
		t.Fatalf("свежая сессия: refreshed=%v, err=%v, want false, nil", refreshed, err)
	}

	// Сессия во второй половине TTL продлевается на полный TTL.
	for k, s := range store.sessions {
		s.ExpiresAt = time.Now().Add(10 * time.Minute) // TTL часа осталось 10 минут
		store.sessions[k] = s
	}
	_, refreshed, err := svc.AuthenticateTouch(context.Background(), token)
	if err != nil || !refreshed {
		t.Fatalf("старая сессия: refreshed=%v, err=%v, want true, nil", refreshed, err)
	}
	for _, s := range store.sessions {
		if until := time.Until(s.ExpiresAt); until < 55*time.Minute {
			t.Errorf("сессия продлена лишь до %v, ждали полный TTL", until)
		}
	}
}

func TestTokenHashedInStore(t *testing.T) {
	svc, store, ctx := newTestService(t)
	token, _, err := svc.Login(ctx, "admin@college.ru", "верный-пароль")
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range store.sessions {
		if bytes.Contains(s.TokenHash, []byte(token)) {
			t.Error("в хранилище лежит сырой токен, а не хэш")
		}
	}
}
