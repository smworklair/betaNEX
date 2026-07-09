// Package blob — содержимое файлов на локальном диске VPS (заменяет S3
// для масштаба колледжа). Блоб адресуется sha256-хэшем содержимого:
// путь <root>/<tenant>/<hh>/<hash>, где hh — первые два символа хэша
// (распределение по каталогам). Метаданные и привязка к сущностям —
// в Postgres (таблица files), здесь только байты.
package blob

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
)

// ErrNotFound — блоба с таким хэшем нет.
var ErrNotFound = errors.New("blob: not found")

var (
	hexRe  = regexp.MustCompile(`^[0-9a-f]{64}$`)
	uuidRe = regexp.MustCompile(`^[0-9a-f-]{36}$`)
)

// Store — хранилище блобов под одним корневым каталогом.
type Store struct {
	root string
}

// NewStore создаёт хранилище, создавая корень при необходимости.
func NewStore(root string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(root, "tmp"), 0o750); err != nil {
		return nil, fmt.Errorf("blob: create root: %w", err)
	}
	return &Store{root: root}, nil
}

// Save записывает содержимое r, считая sha256 на лету, и кладёт блоб
// на постоянное место атомарно (temp-файл + rename). Возвращает хэш и
// размер. Повторная загрузка того же содержимого безвредна: блоб уже
// на месте, temp просто удаляется.
func (s *Store) Save(tenant string, r io.Reader) (sha string, size int64, err error) {
	if err := checkTenant(tenant); err != nil {
		return "", 0, err
	}
	tmp, err := os.CreateTemp(filepath.Join(s.root, "tmp"), "upload-*")
	if err != nil {
		return "", 0, fmt.Errorf("blob: temp: %w", err)
	}
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name()) // no-op после успешного rename
	}()

	h := sha256.New()
	size, err = io.Copy(io.MultiWriter(tmp, h), r)
	if err != nil {
		return "", 0, fmt.Errorf("blob: write: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return "", 0, fmt.Errorf("blob: close temp: %w", err)
	}

	sha = hex.EncodeToString(h.Sum(nil))
	dst := s.path(tenant, sha)
	if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
		return "", 0, fmt.Errorf("blob: mkdir: %w", err)
	}
	if _, err := os.Stat(dst); err == nil {
		return sha, size, nil // дедупликация: содержимое уже лежит
	}
	if err := os.Rename(tmp.Name(), dst); err != nil {
		return "", 0, fmt.Errorf("blob: place: %w", err)
	}
	return sha, size, nil
}

// Open открывает блоб на чтение (поддерживает Seek — для Range-запросов).
func (s *Store) Open(tenant, sha string) (io.ReadSeekCloser, error) {
	if err := checkTenant(tenant); err != nil {
		return nil, err
	}
	if !hexRe.MatchString(sha) {
		return nil, fmt.Errorf("%w: bad hash", ErrNotFound)
	}
	f, err := os.Open(s.path(tenant, sha))
	if errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("%w: %s", ErrNotFound, sha)
	}
	if err != nil {
		return nil, fmt.Errorf("blob: open: %w", err)
	}
	return f, nil
}

// Remove удаляет блоб. Вызывается, когда на хэш не осталось ссылок
// в метаданных. Отсутствие файла не ошибка.
func (s *Store) Remove(tenant, sha string) error {
	if err := checkTenant(tenant); err != nil {
		return err
	}
	if !hexRe.MatchString(sha) {
		return nil
	}
	err := os.Remove(s.path(tenant, sha))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (s *Store) path(tenant, sha string) string {
	return filepath.Join(s.root, tenant, sha[:2], sha)
}

// checkTenant не пускает в путь ничего, кроме UUID: защита от path
// traversal через идентификатор.
func checkTenant(tenant string) error {
	if !uuidRe.MatchString(tenant) {
		return fmt.Errorf("blob: tenant %q is not a uuid", tenant)
	}
	return nil
}
