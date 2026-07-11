package blob_test

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/smworklair/betakis/internal/platform/blob"
)

const tenant = "0198344c-0000-7000-8000-0000000000aa"

func newStore(t *testing.T) *blob.Store {
	t.Helper()
	s, err := blob.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSaveOpenRoundtrip(t *testing.T) {
	s := newStore(t)
	content := "приказ №42 от 15.07.2026"

	sha, size, err := s.Save(tenant, strings.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	if size != int64(len(content)) {
		t.Errorf("size = %d, ожидалось %d", size, len(content))
	}
	sum := sha256.Sum256([]byte(content))
	if want := hex.EncodeToString(sum[:]); sha != want {
		t.Errorf("sha = %s, ожидался %s", sha, want)
	}

	f, err := s.Open(tenant, sha)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	got, err := io.ReadAll(f)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != content {
		t.Errorf("содержимое = %q, ожидалось %q", got, content)
	}
}

// Повторная загрузка того же содержимого — дедупликация без ошибки,
// а временный файл не должен оставаться в tmp.
func TestSaveDeduplicates(t *testing.T) {
	root := t.TempDir()
	s, err := blob.NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	sha1, _, err := s.Save(tenant, strings.NewReader("одно и то же"))
	if err != nil {
		t.Fatal(err)
	}
	sha2, _, err := s.Save(tenant, strings.NewReader("одно и то же"))
	if err != nil {
		t.Fatal(err)
	}
	if sha1 != sha2 {
		t.Errorf("хэши разошлись: %s != %s", sha1, sha2)
	}
	leftovers, err := os.ReadDir(filepath.Join(root, "tmp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(leftovers) != 0 {
		t.Errorf("в tmp остались файлы: %d", len(leftovers))
	}
}

func TestOpenMissing(t *testing.T) {
	s := newStore(t)
	missing := strings.Repeat("ab", 32)
	if _, err := s.Open(tenant, missing); !errors.Is(err, blob.ErrNotFound) {
		t.Errorf("Open(отсутствующий) = %v, ожидался ErrNotFound", err)
	}
	// Невалидный хэш не должен превращаться в путь на диске.
	if _, err := s.Open(tenant, "../../../etc/passwd"); !errors.Is(err, blob.ErrNotFound) {
		t.Errorf("Open(плохой хэш) = %v, ожидался ErrNotFound", err)
	}
}

func TestRemove(t *testing.T) {
	s := newStore(t)
	sha, _, err := s.Save(tenant, strings.NewReader("удалить меня"))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Remove(tenant, sha); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Open(tenant, sha); !errors.Is(err, blob.ErrNotFound) {
		t.Errorf("после Remove блоб всё ещё открывается: %v", err)
	}
	// Повторное удаление и мусорный хэш — не ошибки.
	if err := s.Remove(tenant, sha); err != nil {
		t.Errorf("повторный Remove: %v", err)
	}
	if err := s.Remove(tenant, "не-хэш"); err != nil {
		t.Errorf("Remove(мусор): %v", err)
	}
}

// Tenant, не похожий на UUID, отклоняется до любых операций с диском —
// защита от path traversal через идентификатор.
func TestRejectsBadTenant(t *testing.T) {
	s := newStore(t)
	sha := strings.Repeat("ab", 32)
	for _, bad := range []string{"", "../escape", "college-1", "..%2f..%2fetc%2fpasswd"} {
		if _, _, err := s.Save(bad, strings.NewReader("x")); err == nil {
			t.Errorf("Save(%q): ожидалась ошибка", bad)
		}
		if _, err := s.Open(bad, sha); err == nil {
			t.Errorf("Open(%q): ожидалась ошибка", bad)
		}
		if err := s.Remove(bad, sha); err == nil {
			t.Errorf("Remove(%q): ожидалась ошибка", bad)
		}
	}
}
