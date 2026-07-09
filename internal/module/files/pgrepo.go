package files

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/platform/httpapi"
	"github.com/smworklair/betakis/internal/platform/postgres"
	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// Repository — метаданные файлов в Postgres. Единственная реализация:
// модуль файлов без БД не имеет смысла, в in-memory режиме он просто
// не монтируется.
type Repository struct {
	db *postgres.DB
}

// NewRepository создаёт репозиторий поверх подключения к БД.
func NewRepository(d *postgres.DB) *Repository { return &Repository{db: d} }

// Create сохраняет метаданные файла; ID генерирует БД.
func (r *Repository) Create(ctx context.Context, f File) (File, error) {
	var out File
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		tenant, ok := tenancy.TenantFrom(ctx)
		if !ok {
			return ErrNoTenant
		}
		var tu pgtype.UUID
		if err := tu.Scan(tenant); err != nil {
			return fmt.Errorf("%w: %q", ErrNoTenant, tenant)
		}
		row, err := q.CreateFile(ctx, db.CreateFileParams{
			TenantID:    tu,
			Name:        f.Name,
			ContentType: f.ContentType,
			Size:        f.Size,
			Sha256:      f.SHA256,
			EntityType:  f.EntityType,
			EntityID:    f.EntityID,
			UploadedBy:  f.UploadedBy,
		})
		if err != nil {
			return err
		}
		out = fileFromRow(row)
		return nil
	})
	return out, mapErr(err)
}

// File возвращает метаданные по ID.
func (r *Repository) File(ctx context.Context, id string) (File, error) {
	var u pgtype.UUID
	if err := u.Scan(id); err != nil {
		return File{}, fmt.Errorf("%w: %s", ErrNotFound, id)
	}
	var out File
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		row, err := q.GetFile(ctx, u)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: %s", ErrNotFound, id)
		}
		if err != nil {
			return err
		}
		out = fileFromRow(row)
		return nil
	})
	return out, mapErr(err)
}

// List возвращает файлы tenant'а, опционально по сущности.
func (r *Repository) List(ctx context.Context, entityType, entityID string, limit int) ([]File, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	params := db.ListFilesParams{Limit: int32(limit)} // #nosec G115 -- limit ограничен 500 выше
	if entityType != "" {
		params.EntityType = &entityType
	}
	if entityID != "" {
		params.EntityID = &entityID
	}
	var out []File
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		rows, err := q.ListFiles(ctx, params)
		if err != nil {
			return err
		}
		out = make([]File, 0, len(rows))
		for _, row := range rows {
			out = append(out, fileFromRow(row))
		}
		return nil
	})
	return out, mapErr(err)
}

// Delete удаляет метаданные и сообщает, остались ли ссылки на блоб.
func (r *Repository) Delete(ctx context.Context, id string) (sha string, referenced bool, err error) {
	var u pgtype.UUID
	if err := u.Scan(id); err != nil {
		return "", false, fmt.Errorf("%w: %s", ErrNotFound, id)
	}
	err = r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		row, err := q.GetFile(ctx, u)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: %s", ErrNotFound, id)
		}
		if err != nil {
			return err
		}
		sha = row.Sha256
		if _, err := q.DeleteFile(ctx, u); err != nil {
			return err
		}
		n, err := q.CountFilesBySHA(ctx, sha)
		if err != nil {
			return err
		}
		referenced = n > 0
		return nil
	})
	return sha, referenced, mapErr(err)
}

// SHAReferenced сообщает, ссылается ли хоть один файл tenant'а на блоб.
// По нему HTTP-слой решает, убирать ли содержимое с диска.
func (r *Repository) SHAReferenced(ctx context.Context, sha string) (bool, error) {
	var n int64
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		var err error
		n, err = q.CountFilesBySHA(ctx, sha)
		return err
	})
	return n > 0, mapErr(err)
}

// Search — полнотекстовый поиск по именам файлов (httpapi.SearchSource).
func (r *Repository) Search(ctx context.Context, query string, limit int) ([]httpapi.SearchHit, error) {
	var hits []httpapi.SearchHit
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		rows, err := q.SearchFiles(ctx, db.SearchFilesParams{
			WebsearchToTsquery: query,
			Limit:              int32(limit), // #nosec G115 -- limit ограничен вызывающим
		})
		if err != nil {
			return err
		}
		for _, row := range rows {
			hits = append(hits, httpapi.SearchHit{
				Kind:  "file",
				ID:    row.ID.String(),
				Title: row.Name,
				Rank:  row.Rank,
				At:    row.CreatedAt.Time,
			})
		}
		return nil
	})
	return hits, mapErr(err)
}

func mapErr(err error) error {
	if errors.Is(err, postgres.ErrNoTenant) || errors.Is(err, postgres.ErrInvalidTenant) {
		return fmt.Errorf("%w: %v", ErrNoTenant, err)
	}
	return err
}

func fileFromRow(row db.File) File {
	return File{
		ID:          row.ID.String(),
		Name:        row.Name,
		ContentType: row.ContentType,
		Size:        row.Size,
		SHA256:      row.Sha256,
		EntityType:  row.EntityType,
		EntityID:    row.EntityID,
		UploadedBy:  row.UploadedBy,
		CreatedAt:   row.CreatedAt.Time,
	}
}
