package files

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/kernel/identity"
	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/platform/blob"
	"github.com/smworklair/betakis/internal/platform/httpapi"
)

// Routes возвращает функцию монтирования маршрутов модуля.
//
//	POST   /api/v1/files            multipart: file [, entity_type, entity_id]
//	GET    /api/v1/files            ?entity_type=&entity_id=&limit=
//	GET    /api/v1/files/{id}       скачивание содержимого
//	DELETE /api/v1/files/{id}
func Routes(bus command.Bus, repo *Repository, store *blob.Store, maxUpload int64) func(mux *http.ServeMux) {
	h := &api{bus: bus, repo: repo, store: store, maxUpload: maxUpload}
	return func(mux *http.ServeMux) {
		mux.HandleFunc("POST /api/v1/files", h.upload)
		mux.HandleFunc("GET /api/v1/files", h.list)
		mux.HandleFunc("GET /api/v1/files/{id}", h.download)
		mux.HandleFunc("DELETE /api/v1/files/{id}", h.remove)
	}
}

type api struct {
	bus       command.Bus
	repo      *Repository
	store     *blob.Store
	maxUpload int64
}

type fileDTO struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	ContentType string    `json:"content_type"`
	Size        int64     `json:"size"`
	EntityType  string    `json:"entity_type,omitempty"`
	EntityID    string    `json:"entity_id,omitempty"`
	UploadedBy  string    `json:"uploaded_by,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

func dto(f File) fileDTO {
	return fileDTO{
		ID: f.ID, Name: f.Name, ContentType: f.ContentType, Size: f.Size,
		EntityType: f.EntityType, EntityID: f.EntityID,
		UploadedBy: f.UploadedBy, CreatedAt: f.CreatedAt,
	}
}

// upload принимает multipart-файл: содержимое уходит на диск сразу
// (потоково, без буферизации в память), метаданные — командой через
// шину, чтобы загрузка была авторизована и оставила след в аудите.
func (h *api) upload(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenancy.TenantFrom(r.Context())
	if !ok {
		httpapi.WriteProblem(w, http.StatusBadRequest, "Не указан tenant", "")
		return
	}
	if _, ok := identity.ActorFrom(r.Context()); !ok {
		httpapi.WriteProblem(w, http.StatusUnauthorized, "Не аутентифицирован", "нет сессии")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, h.maxUpload)
	mr, err := r.MultipartReader()
	if err != nil {
		httpapi.WriteProblem(w, http.StatusBadRequest, "Ожидается multipart/form-data", err.Error())
		return
	}

	var (
		entityType, entityID string
		saved                bool
		sha                  string
		size                 int64
		name, contentType    string
	)
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			httpapi.WriteProblem(w, http.StatusBadRequest, "Некорректный multipart", err.Error())
			return
		}
		switch part.FormName() {
		case "entity_type":
			entityType = formValue(part)
		case "entity_id":
			entityID = formValue(part)
		case "file":
			name = part.FileName()
			contentType = part.Header.Get("Content-Type")
			if contentType == "" {
				contentType = "application/octet-stream"
			}
			sha, size, err = h.store.Save(tenant, part)
			if err != nil {
				httpapi.WriteProblem(w, http.StatusInternalServerError, "Не удалось сохранить файл", err.Error())
				return
			}
			saved = true
		}
	}
	if !saved {
		httpapi.WriteProblem(w, http.StatusBadRequest, "Нет файла", "нужно поле file")
		return
	}

	cmd := Attach{
		FileName: name, ContentType: contentType, Size: size, SHA256: sha,
		EntityType: entityType, EntityID: entityID,
	}
	if err := cmd.Validate(); err != nil {
		httpapi.WriteProblem(w, http.StatusBadRequest, "Некорректный запрос", err.Error())
		return
	}
	if err := h.bus.Dispatch(r.Context(), cmd); err != nil {
		// Метаданные не записались — блоб без ссылок подчищаем сразу.
		if ref, refErr := h.repo.SHAReferenced(r.Context(), sha); refErr == nil && !ref {
			_ = h.store.Remove(tenant, sha)
		}
		writeErr(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusCreated, map[string]string{"status": "created", "sha256": sha})
}

func (h *api) list(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	files, err := h.repo.List(r.Context(),
		r.URL.Query().Get("entity_type"), r.URL.Query().Get("entity_id"), limit)
	if err != nil {
		writeErr(w, err)
		return
	}
	out := make([]fileDTO, 0, len(files))
	for _, f := range files {
		out = append(out, dto(f))
	}
	httpapi.WriteJSON(w, http.StatusOK, out)
}

func (h *api) download(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenancy.TenantFrom(r.Context())
	if !ok {
		httpapi.WriteProblem(w, http.StatusBadRequest, "Не указан tenant", "")
		return
	}
	if _, ok := identity.ActorFrom(r.Context()); !ok {
		httpapi.WriteProblem(w, http.StatusUnauthorized, "Не аутентифицирован", "нет сессии")
		return
	}
	f, err := h.repo.File(r.Context(), r.PathValue("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	rc, err := h.store.Open(tenant, f.SHA256)
	if err != nil {
		writeErr(w, err)
		return
	}
	defer func() { _ = rc.Close() }()

	w.Header().Set("Content-Type", f.ContentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", urlEscape(f.Name)))
	// ServeContent обслуживает Range-запросы и If-Modified-Since.
	http.ServeContent(w, r, f.Name, f.CreatedAt, rc)
}

func (h *api) remove(w http.ResponseWriter, r *http.Request) {
	tenant, _ := tenancy.TenantFrom(r.Context())
	id := r.PathValue("id")

	// SHA нужен до удаления метаданных, чтобы после подчистить блоб.
	f, err := h.repo.File(r.Context(), id)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := h.bus.Dispatch(r.Context(), Delete{ID: id}); err != nil {
		writeErr(w, err)
		return
	}
	// Если ссылок на содержимое не осталось — убираем блоб с диска.
	if ref, refErr := h.repo.SHAReferenced(r.Context(), f.SHA256); refErr == nil && !ref {
		_ = h.store.Remove(tenant, f.SHA256)
	}
	w.WriteHeader(http.StatusNoContent)
}

// writeErr маппит ошибки модуля в HTTP-статусы.
func writeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, authz.ErrDenied):
		httpapi.WriteProblem(w, http.StatusForbidden, "Доступ запрещён", err.Error())
	case errors.Is(err, ErrNoTenant):
		httpapi.WriteProblem(w, http.StatusBadRequest, "Не указан tenant", err.Error())
	case errors.Is(err, ErrNotFound), errors.Is(err, blob.ErrNotFound):
		httpapi.WriteProblem(w, http.StatusNotFound, "Файл не найден", err.Error())
	default:
		httpapi.WriteProblem(w, http.StatusInternalServerError, "Внутренняя ошибка", err.Error())
	}
}

func formValue(part io.Reader) string {
	b, _ := io.ReadAll(io.LimitReader(part, 1024))
	return string(b)
}

// urlEscape кодирует имя файла для filename* (RFC 5987).
func urlEscape(s string) string {
	const hexDigits = "0123456789ABCDEF"
	var out []byte
	for _, b := range []byte(s) {
		if (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') ||
			b == '.' || b == '-' || b == '_' {
			out = append(out, b)
		} else {
			out = append(out, '%', hexDigits[b>>4], hexDigits[b&0xf])
		}
	}
	return string(out)
}
