package files_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/smworklair/betakis/internal/kernel/audit"
	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/module/files"
	"github.com/smworklair/betakis/internal/platform/blob"
	"github.com/smworklair/betakis/internal/platform/httpapi"
	"github.com/smworklair/betakis/internal/platform/postgres"
)

// TestFilesHTTPFlow — полный цикл: загрузка скана → список по сущности
// → скачивание → удаление (блоб уходит с диска). Реальный Postgres +
// временный каталог вместо S3.
func TestFilesHTTPFlow(t *testing.T) {
	dsn := os.Getenv("NEX_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("NEX_TEST_DATABASE_URL не задан — пропускаю интеграционный тест")
	}
	ctx := context.Background()
	if err := postgres.Migrate(ctx, dsn); err != nil {
		t.Fatalf("миграции: %v", err)
	}
	pg, err := postgres.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("подключение: %v", err)
	}
	t.Cleanup(pg.Close)

	var buf [6]byte
	if _, err := rand.Read(buf[:]); err != nil {
		t.Fatal(err)
	}
	tenantID, err := pg.EnsureTenant(ctx, "files-"+hex.EncodeToString(buf[:]))
	if err != nil {
		t.Fatal(err)
	}

	store, err := blob.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	repo := files.NewRepository(pg)

	policy := authz.NewPolicy()
	policy.Grant("admin", files.PermWrite)
	policy.Grant("admin", files.PermRead)
	bus := command.NewMemoryBus(authz.NewPolicyAuthorizer(policy), &audit.MemoryRecorder{}, command.WithTxRunner(pg))
	if err := files.RegisterCommands(bus, repo); err != nil {
		t.Fatal(err)
	}
	router := httpapi.NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), httpapi.RouterConfig{
		DevAuth: true,
		Mount:   []func(*http.ServeMux){files.Routes(bus, repo, store, 1<<20, authz.NewGuard(policy))},
	})

	do := func(req *http.Request) *httptest.ResponseRecorder {
		req.Header.Set("X-Dev-Actor", "u1")
		req.Header.Set("X-Dev-Roles", "admin")
		req.Header.Set("X-Dev-Tenant", tenantID)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}

	// 1. Загрузка.
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("entity_type", "student")
	_ = mw.WriteField("entity_id", "s-100")
	part, _ := mw.CreateFormFile("file", "скан аттестата.pdf")
	_, _ = part.Write([]byte("%PDF-1.4 фиктивное содержимое"))
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/files", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if rec := do(req); rec.Code != http.StatusCreated {
		t.Fatalf("загрузка: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	// 2. Список по сущности.
	rec := do(httptest.NewRequest(http.MethodGet, "/api/v1/files?entity_type=student&entity_id=s-100", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("список: status = %d", rec.Code)
	}
	var list []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Size int64  `json:"size"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Name != "скан аттестата.pdf" {
		t.Fatalf("список = %+v", list)
	}
	id := list[0].ID

	// 3. Скачивание: содержимое совпадает.
	rec = do(httptest.NewRequest(http.MethodGet, "/api/v1/files/"+id, nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "фиктивное содержимое") {
		t.Fatalf("скачивание: status = %d", rec.Code)
	}

	// 4. Без роли admin загрузка отклоняется (403 от шины).
	var b2 bytes.Buffer
	mw2 := multipart.NewWriter(&b2)
	p2, _ := mw2.CreateFormFile("file", "x.txt")
	_, _ = p2.Write([]byte("x"))
	_ = mw2.Close()
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/files", &b2)
	req2.Header.Set("Content-Type", mw2.FormDataContentType())
	req2.Header.Set("X-Dev-Actor", "s1")
	req2.Header.Set("X-Dev-Roles", "student")
	req2.Header.Set("X-Dev-Tenant", tenantID)
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusForbidden {
		t.Errorf("загрузка без роли: status = %d, want 403", rec2.Code)
	}

	// 5. Удаление: метаданных и записи больше нет.
	if rec := do(httptest.NewRequest(http.MethodDelete, "/api/v1/files/"+id, nil)); rec.Code != http.StatusNoContent {
		t.Fatalf("удаление: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if rec := do(httptest.NewRequest(http.MethodGet, "/api/v1/files/"+id, nil)); rec.Code != http.StatusNotFound {
		t.Errorf("после удаления: status = %d, want 404", rec.Code)
	}
}
