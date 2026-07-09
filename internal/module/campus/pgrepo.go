package campus

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/platform/httpapi"
	"github.com/smworklair/betakis/internal/platform/postgres"
	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// Repository — хранилище модуля в Postgres (единственная реализация).
type Repository struct {
	db *postgres.DB
}

// NewRepository создаёт репозиторий поверх подключения к БД.
func NewRepository(d *postgres.DB) *Repository { return &Repository{db: d} }

// StudentFilter — фильтры и сортировка списка студентов.
type StudentFilter struct {
	GroupID string
	Status  string
	Query   string // полнотекстовый поиск по ФИО/email
	Sort    string // name | name_desc | group | created | "" (свежие первыми)
	Limit   int
	Offset  int
}

// JournalFilter — фильтры учебного журнала.
type JournalFilter struct {
	GroupID   string
	StudentID string
	Subject   string
	Limit     int
}

// CreateGroup сохраняет группу; дубликат кода → ErrDuplicateGroup.
func (r *Repository) CreateGroup(ctx context.Context, code, name string) (Group, error) {
	var out Group
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		tu, err := tenantUUID(ctx)
		if err != nil {
			return err
		}
		row, err := q.CreateCampusGroup(ctx, db.CreateCampusGroupParams{TenantID: tu, Code: code, Name: name})
		if isUnique(err) {
			return fmt.Errorf("%w: %s", ErrDuplicateGroup, code)
		}
		if err != nil {
			return err
		}
		out = Group{ID: row.ID.String(), Code: row.Code, Name: row.Name, CreatedAt: row.CreatedAt.Time}
		return nil
	})
	return out, mapErr(err)
}

// Groups возвращает группы с числом активных студентов.
func (r *Repository) Groups(ctx context.Context) ([]Group, error) {
	var out []Group
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		rows, err := q.ListCampusGroups(ctx)
		if err != nil {
			return err
		}
		out = make([]Group, 0, len(rows))
		for _, g := range rows {
			out = append(out, Group{
				ID: g.ID.String(), Code: g.Code, Name: g.Name,
				ActiveStudents: int(g.ActiveStudents), CreatedAt: g.CreatedAt.Time,
			})
		}
		return nil
	})
	return out, mapErr(err)
}

// CreateStudent зачисляет студента; несуществующая группа → ErrUnknownGroup.
func (r *Repository) CreateStudent(ctx context.Context, s Student) (Student, error) {
	var out Student
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		tu, err := tenantUUID(ctx)
		if err != nil {
			return err
		}
		group, err := optUUID(s.GroupID, ErrUnknownGroup)
		if err != nil {
			return err
		}
		row, err := q.CreateCampusStudent(ctx, db.CreateCampusStudentParams{
			TenantID: tu, FullName: s.FullName, Email: s.Email,
			GroupID: group, Status: string(StatusActive),
		})
		if isFK(err) {
			return fmt.Errorf("%w: %s", ErrUnknownGroup, s.GroupID)
		}
		if err != nil {
			return err
		}
		out = studentFromRow(row, "")
		return nil
	})
	return out, mapErr(err)
}

// UpdateStudent изменяет карточку студента.
func (r *Repository) UpdateStudent(ctx context.Context, s Student) error {
	return mapErr(r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		var id pgtype.UUID
		if err := id.Scan(s.ID); err != nil {
			return fmt.Errorf("%w: %s", ErrUnknownStudent, s.ID)
		}
		group, err := optUUID(s.GroupID, ErrUnknownGroup)
		if err != nil {
			return err
		}
		_, err = q.UpdateCampusStudent(ctx, db.UpdateCampusStudentParams{
			ID: id, FullName: s.FullName, Email: s.Email,
			GroupID: group, Status: string(s.Status),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: %s", ErrUnknownStudent, s.ID)
		}
		if isFK(err) {
			return fmt.Errorf("%w: %s", ErrUnknownGroup, s.GroupID)
		}
		return err
	}))
}

// Students возвращает студентов по фильтру с сортировкой.
func (r *Repository) Students(ctx context.Context, f StudentFilter) ([]Student, error) {
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 100
	}
	params := db.ListCampusStudentsParams{
		Limit:  int32(f.Limit),  // #nosec G115 -- ограничен 500 выше
		Offset: int32(f.Offset), // #nosec G115 -- смещение пагинации
		Sort:   f.Sort,
	}
	if f.GroupID != "" {
		var g pgtype.UUID
		if err := g.Scan(f.GroupID); err != nil {
			return []Student{}, nil // несуществующая группа = пустой список
		}
		params.GroupID = g
	}
	if f.Status != "" {
		params.Status = &f.Status
	}
	if f.Query != "" {
		params.Q = &f.Query
	}
	var out []Student
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		rows, err := q.ListCampusStudents(ctx, params)
		if err != nil {
			return err
		}
		out = make([]Student, 0, len(rows))
		for _, row := range rows {
			out = append(out, studentFromRow(db.CampusStudent{
				ID: row.ID, FullName: row.FullName, Email: row.Email,
				GroupID: row.GroupID, Status: row.Status, CreatedAt: row.CreatedAt,
			}, strOrEmpty(row.GroupCode)))
		}
		return nil
	})
	return out, mapErr(err)
}

// RecordGrade добавляет запись в учебный журнал.
func (r *Repository) RecordGrade(ctx context.Context, g Grade) error {
	return mapErr(r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		tu, err := tenantUUID(ctx)
		if err != nil {
			return err
		}
		var student pgtype.UUID
		if err := student.Scan(g.StudentID); err != nil {
			return fmt.Errorf("%w: %s", ErrUnknownStudent, g.StudentID)
		}
		gradedOn := g.GradedOn
		if gradedOn.IsZero() {
			gradedOn = time.Now()
		}
		_, err = q.CreateCampusGrade(ctx, db.CreateCampusGradeParams{
			TenantID: tu, StudentID: student, Subject: g.Subject,
			Grade:    int16(g.Grade), // #nosec G115 -- 2..5 по Validate
			GradedOn: pgtype.Date{Time: gradedOn, Valid: true},
			GradedBy: g.GradedBy, Note: g.Note,
		})
		if isFK(err) {
			return fmt.Errorf("%w: %s", ErrUnknownStudent, g.StudentID)
		}
		return err
	}))
}

// Journal возвращает записи учебного журнала по фильтру.
func (r *Repository) Journal(ctx context.Context, f JournalFilter) ([]Grade, error) {
	if f.Limit <= 0 || f.Limit > 1000 {
		f.Limit = 500
	}
	params := db.CampusJournalParams{Limit: int32(f.Limit)} // #nosec G115 -- ограничен 1000 выше
	if f.GroupID != "" {
		var g pgtype.UUID
		if err := g.Scan(f.GroupID); err != nil {
			return []Grade{}, nil
		}
		params.GroupID = g
	}
	if f.StudentID != "" {
		var s pgtype.UUID
		if err := s.Scan(f.StudentID); err != nil {
			return []Grade{}, nil
		}
		params.StudentID = s
	}
	if f.Subject != "" {
		params.Subject = &f.Subject
	}
	var out []Grade
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		rows, err := q.CampusJournal(ctx, params)
		if err != nil {
			return err
		}
		out = make([]Grade, 0, len(rows))
		for _, row := range rows {
			out = append(out, Grade{
				ID: row.ID.String(), StudentID: row.StudentID.String(),
				FullName: row.FullName, GroupCode: strOrEmpty(row.GroupCode),
				Subject: row.Subject, Grade: int(row.Grade),
				GradedOn: row.GradedOn.Time, GradedBy: row.GradedBy, Note: row.Note,
			})
		}
		return nil
	})
	return out, mapErr(err)
}

// Search — полнотекстовый поиск по студентам (httpapi.SearchSource).
func (r *Repository) Search(ctx context.Context, query string, limit int) ([]httpapi.SearchHit, error) {
	var hits []httpapi.SearchHit
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		rows, err := q.SearchCampusStudents(ctx, db.SearchCampusStudentsParams{
			WebsearchToTsquery: query,
			Limit:              int32(limit), // #nosec G115 -- ограничен вызывающим
		})
		if err != nil {
			return err
		}
		for _, row := range rows {
			title := row.FullName
			if code := strOrEmpty(row.GroupCode); code != "" {
				title += " (" + code + ")"
			}
			hits = append(hits, httpapi.SearchHit{
				Kind: "campus.student", ID: row.ID.String(), Title: title, Rank: row.Rank,
			})
		}
		return nil
	})
	return hits, mapErr(err)
}

// --- Вспомогательные -----------------------------------------------------------

func tenantUUID(ctx context.Context) (pgtype.UUID, error) {
	var u pgtype.UUID
	tenant, ok := tenancy.TenantFrom(ctx)
	if !ok {
		return u, ErrNoTenant
	}
	if err := u.Scan(tenant); err != nil {
		return u, fmt.Errorf("%w: %q", ErrNoTenant, tenant)
	}
	return u, nil
}

// optUUID парсит необязательный UUID; невалидный непустой → notFound.
func optUUID(s string, notFound error) (pgtype.UUID, error) {
	var u pgtype.UUID
	if s == "" {
		return u, nil // Valid=false → NULL
	}
	if err := u.Scan(s); err != nil {
		return u, fmt.Errorf("%w: %s", notFound, s)
	}
	return u, nil
}

func mapErr(err error) error {
	if errors.Is(err, postgres.ErrNoTenant) || errors.Is(err, postgres.ErrInvalidTenant) {
		return fmt.Errorf("%w: %v", ErrNoTenant, err)
	}
	return err
}

func isUnique(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func isFK(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

func strOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func studentFromRow(row db.CampusStudent, groupCode string) Student {
	s := Student{
		ID: row.ID.String(), FullName: row.FullName, Email: row.Email,
		Status: StudentStatus(row.Status), CreatedAt: row.CreatedAt.Time,
		GroupCode: groupCode,
	}
	if row.GroupID.Valid {
		s.GroupID = row.GroupID.String()
	}
	return s
}
