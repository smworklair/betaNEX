// Package notifications — внутренние уведомления пользователям
// («колокольчик»): назначение задачи, приглашение на событие, напоминание.
//
// Лента пишется в той же транзакции, что и породившее её доменное
// изменение (Service.Notify присоединяется к транзакции команды через
// контекст), а доставка по внешним каналам (email и т.п.) уходит через
// transactional outbox — упавший SMTP не откатывает доменную команду.
package notifications

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/kernel/identity"
	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/platform/postgres"
	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// Права модуля.
const (
	// PermRead — право читать собственную ленту уведомлений.
	PermRead = "notifications:read"
	// PermWrite — право отмечать собственные уведомления прочитанными.
	PermWrite = "notifications:write"
)

// Имена команд.
const (
	CmdMarkRead    = "notifications.mark_read"
	CmdMarkAllRead = "notifications.mark_all_read"
)

// TopicCreated — тема outbox-сообщения о новом уведомлении. Обработчик
// темы отвечает за доставку по внешним каналам (email — веха M7+).
const TopicCreated = "notification.created"

// Ошибки модуля.
var (
	ErrNoTenant     = errors.New("notifications: no tenant in context")
	ErrNoActor      = errors.New("notifications: no actor in context")
	ErrUserNotFound = errors.New("notifications: recipient user not found")
)

// Notification — одно уведомление пользователю.
type Notification struct {
	ID        string
	UserID    string
	Kind      string // напр. "task.assigned"
	Title     string
	Body      string
	RefType   string // тип связанной сущности ("task"), пусто = без ссылки
	RefID     string
	CreatedAt time.Time
	ReadAt    time.Time // нулевое время = непрочитано
}

// createdEvent — payload outbox-сообщения TopicCreated.
type createdEvent struct {
	NotificationID string `json:"notification_id"`
	UserID         string `json:"user_id"`
	Kind           string `json:"kind"`
	Title          string `json:"title"`
}

// --- Команды -------------------------------------------------------------------

// MarkRead — команда «отметить уведомление прочитанным». Идемпотентна:
// уже прочитанное уведомление не ошибка. Работает только со своими
// уведомлениями — id актора берётся из контекста, не из запроса.
type MarkRead struct{ ID string }

// Name возвращает стабильное имя команды для аудита.
func (MarkRead) Name() string { return CmdMarkRead }

// Permission возвращает право, требуемое для исполнения.
func (MarkRead) Permission() string { return PermWrite }

// Validate проверяет инварианты входа.
func (c MarkRead) Validate() error {
	if c.ID == "" {
		return errors.New("notifications: id is required")
	}
	return nil
}

// MarkAllRead — команда «отметить все свои уведомления прочитанными».
type MarkAllRead struct{}

// Name возвращает стабильное имя команды для аудита.
func (MarkAllRead) Name() string { return CmdMarkAllRead }

// Permission возвращает право, требуемое для исполнения.
func (MarkAllRead) Permission() string { return PermWrite }

// Validate проверяет инварианты входа.
func (MarkAllRead) Validate() error { return nil }

// --- Репозиторий ----------------------------------------------------------------

// Repository — хранилище уведомлений в Postgres.
type Repository struct {
	db *postgres.DB
}

// NewRepository создаёт репозиторий поверх подключения к БД.
func NewRepository(d *postgres.DB) *Repository { return &Repository{db: d} }

// Create сохраняет уведомление пользователю userID.
func (r *Repository) Create(ctx context.Context, userID string, n Notification) (Notification, error) {
	var user pgtype.UUID
	if err := user.Scan(userID); err != nil {
		return Notification{}, fmt.Errorf("%w: %q", ErrUserNotFound, userID)
	}
	var out Notification
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		tenant, ok := tenantUUID(ctx)
		if !ok {
			return ErrNoTenant
		}
		row, err := q.CreateNotification(ctx, db.CreateNotificationParams{
			TenantID: tenant, UserID: user, Kind: n.Kind, Title: n.Title,
			Body: n.Body, RefType: n.RefType, RefID: n.RefID,
		})
		if err != nil {
			return err
		}
		out = fromRow(row)
		return nil
	})
	return out, mapErr(err)
}

// List возвращает уведомления пользователя, свежие первыми.
func (r *Repository) List(ctx context.Context, userID string, unreadOnly bool, limit, offset int) ([]Notification, error) {
	var user pgtype.UUID
	if err := user.Scan(userID); err != nil {
		return []Notification{}, nil // не-UUID актор (dev-заголовки) — пустая лента
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var out []Notification
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		rows, err := q.ListNotifications(ctx, db.ListNotificationsParams{
			UserID:     user,
			UnreadOnly: unreadOnly,
			Limit:      int32(limit),  // #nosec G115 -- ограничен 200 выше
			Offset:     int32(offset), // #nosec G115 -- смещение пагинации
		})
		if err != nil {
			return err
		}
		out = make([]Notification, 0, len(rows))
		for _, row := range rows {
			out = append(out, fromRow(row))
		}
		return nil
	})
	return out, mapErr(err)
}

// CountUnread возвращает число непрочитанных уведомлений пользователя.
func (r *Repository) CountUnread(ctx context.Context, userID string) (int64, error) {
	var user pgtype.UUID
	if err := user.Scan(userID); err != nil {
		return 0, nil
	}
	var n int64
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		var err error
		n, err = q.CountUnreadNotifications(ctx, user)
		return err
	})
	return n, mapErr(err)
}

// MarkRead отмечает своё уведомление прочитанным. Идемпотентен.
func (r *Repository) MarkRead(ctx context.Context, id, userID string) error {
	var nid, user pgtype.UUID
	if err := nid.Scan(id); err != nil {
		return nil // несуществующий id — тот же no-op, что и прочитанное
	}
	if err := user.Scan(userID); err != nil {
		return nil
	}
	return mapErr(r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		_, err := q.MarkNotificationRead(ctx, db.MarkNotificationReadParams{ID: nid, UserID: user})
		return err
	}))
}

// MarkAllRead отмечает все свои уведомления прочитанными.
func (r *Repository) MarkAllRead(ctx context.Context, userID string) error {
	var user pgtype.UUID
	if err := user.Scan(userID); err != nil {
		return nil
	}
	return mapErr(r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		_, err := q.MarkAllNotificationsRead(ctx, user)
		return err
	}))
}

// --- Сервис для других модулей ---------------------------------------------------

// enqueuer — то, что сервису нужно от outbox (сужение для тестов).
type enqueuer interface {
	Enqueue(ctx context.Context, topic string, payload any) error
}

// Service — точка входа для других модулей: «уведоми этих пользователей».
// Вызывается из хендлеров команд и присоединяется к их транзакции, поэтому
// уведомления атомарны с доменным изменением.
type Service struct {
	repo  *Repository
	queue enqueuer
}

// NewService создаёт сервис. queue может быть nil — тогда внешняя
// доставка не планируется, пишется только лента.
func NewService(repo *Repository, queue enqueuer) *Service {
	return &Service{repo: repo, queue: queue}
}

// Notify создаёт уведомление каждому получателю и ставит outbox-сообщение
// для внешней доставки. Любая ошибка откатывает транзакцию команды
// целиком — рассылка «всем или никому».
func (s *Service) Notify(ctx context.Context, userIDs []string, kind, title, body, refType, refID string) error {
	for _, uid := range userIDs {
		n, err := s.repo.Create(ctx, uid, Notification{
			Kind: kind, Title: title, Body: body, RefType: refType, RefID: refID,
		})
		if err != nil {
			return err
		}
		if s.queue == nil {
			continue
		}
		err = s.queue.Enqueue(ctx, TopicCreated, createdEvent{
			NotificationID: n.ID, UserID: n.UserID, Kind: n.Kind, Title: n.Title,
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// --- Регистрация команд -----------------------------------------------------------

// RegisterCommands подключает команды модуля к шине.
func RegisterCommands(bus interface {
	Register(name string, h command.HandlerFunc) error
}, repo *Repository,
) error {
	if err := bus.Register(CmdMarkRead, func(ctx context.Context, cmd command.Command) error {
		c, ok := cmd.(MarkRead)
		if !ok {
			return fmt.Errorf("notifications: %s: unexpected command type %T", CmdMarkRead, cmd)
		}
		actor, ok := identity.ActorFrom(ctx)
		if !ok {
			return ErrNoActor
		}
		return repo.MarkRead(ctx, c.ID, actor.ID)
	}); err != nil {
		return err
	}
	return bus.Register(CmdMarkAllRead, func(ctx context.Context, cmd command.Command) error {
		if _, ok := cmd.(MarkAllRead); !ok {
			return fmt.Errorf("notifications: %s: unexpected command type %T", CmdMarkAllRead, cmd)
		}
		actor, ok := identity.ActorFrom(ctx)
		if !ok {
			return ErrNoActor
		}
		return repo.MarkAllRead(ctx, actor.ID)
	})
}

// --- Вспомогательные ---------------------------------------------------------------

// tenantUUID достаёт tenant из контекста в форме pgtype.UUID.
func tenantUUID(ctx context.Context) (pgtype.UUID, bool) {
	tenant, ok := tenancy.TenantFrom(ctx)
	if !ok {
		return pgtype.UUID{}, false
	}
	var u pgtype.UUID
	if err := u.Scan(tenant); err != nil {
		return pgtype.UUID{}, false
	}
	return u, true
}

// mapErr переводит ошибки платформы в доменные.
func mapErr(err error) error {
	if errors.Is(err, postgres.ErrNoTenant) || errors.Is(err, postgres.ErrInvalidTenant) {
		return fmt.Errorf("%w: %v", ErrNoTenant, err)
	}
	// 23503 foreign_key_violation: получатель не существует в tenant'е.
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" {
		return fmt.Errorf("%w: %v", ErrUserNotFound, err)
	}
	return err
}

func fromRow(row db.Notification) Notification {
	n := Notification{
		ID: row.ID.String(), UserID: row.UserID.String(), Kind: row.Kind,
		Title: row.Title, Body: row.Body, RefType: row.RefType, RefID: row.RefID,
		CreatedAt: row.CreatedAt.Time,
	}
	if row.ReadAt.Valid {
		n.ReadAt = row.ReadAt.Time
	}
	return n
}
