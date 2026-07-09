// Package files — модуль «Файлы»: сканы документов и вложения,
// привязанные к доменным сущностям. Метаданные — в Postgres (RLS),
// содержимое — на локальном диске (platform/blob). Все изменения —
// через шину команд: загрузка и удаление оставляют след в аудите.
package files

import (
	"errors"
	"fmt"
	"time"
)

// Права модуля.
const (
	PermWrite = "files:write"
)

// Имена команд — стабильные, попадают в журнал аудита.
const (
	CmdAttach = "files.attach"
	CmdDelete = "files.delete"
)

// Ошибки модуля.
var (
	ErrNoTenant = errors.New("files: no tenant in context")
	ErrNotFound = errors.New("files: file not found")
)

// File — метаданные загруженного файла.
type File struct {
	ID          string
	Name        string
	ContentType string
	Size        int64
	SHA256      string
	EntityType  string // к какой сущности привязан: "student", "order", ...
	EntityID    string
	UploadedBy  string
	CreatedAt   time.Time
}

// Attach — команда «зарегистрировать загруженный файл». Содержимое
// уже сохранено в blob-хранилище HTTP-слоем; команда фиксирует
// метаданные и привязку. Так большое тело не едет через шину, а след
// в аудите всё равно остаётся.
type Attach struct {
	FileName    string
	ContentType string
	Size        int64
	SHA256      string
	EntityType  string
	EntityID    string
}

// Name возвращает стабильное имя команды для аудита.
func (Attach) Name() string { return CmdAttach }

// Permission возвращает право, требуемое для исполнения.
func (Attach) Permission() string { return PermWrite }

// Validate проверяет инварианты входа.
func (c Attach) Validate() error {
	if c.FileName == "" {
		return errors.New("files: name is required")
	}
	if len(c.FileName) > 255 {
		return errors.New("files: name is too long")
	}
	if c.Size <= 0 {
		return errors.New("files: size must be positive")
	}
	if len(c.SHA256) != 64 {
		return fmt.Errorf("files: bad sha256 %q", c.SHA256)
	}
	if (c.EntityType == "") != (c.EntityID == "") {
		return errors.New("files: entity_type and entity_id come together")
	}
	return nil
}

// Delete — команда «удалить файл».
type Delete struct {
	ID string
}

// Name возвращает стабильное имя команды для аудита.
func (Delete) Name() string { return CmdDelete }

// Permission возвращает право, требуемое для исполнения.
func (Delete) Permission() string { return PermWrite }

// Validate проверяет инварианты входа.
func (c Delete) Validate() error {
	if c.ID == "" {
		return errors.New("files: id is required")
	}
	return nil
}
