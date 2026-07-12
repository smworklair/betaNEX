// Package campus — модуль «Кампус»: группы, студенты и учебный журнал.
// Ядро домена колледжа (веха M6): приёмка, расписание и стипендии будут
// ссылаться на эти сущности. Все изменения — команды через шину.
package campus

import (
	"errors"
	"fmt"
	"time"
	"unicode/utf8"
)

// Права модуля.
const (
	PermGroupsWrite   = "campus:groups:write"
	PermStudentsWrite = "campus:students:write"
	PermGradesWrite   = "campus:grades:write"
	// PermRead — право чтения групп, студентов и журнала.
	PermRead = "campus:read"
)

// Имена команд — стабильные, попадают в журнал аудита.
const (
	CmdGroupCreate   = "campus.group.create"
	CmdStudentEnroll = "campus.student.enroll"
	CmdStudentUpdate = "campus.student.update"
	CmdGradeRecord   = "campus.grade.record"
)

// Ошибки модуля.
var (
	ErrNoTenant       = errors.New("campus: no tenant in context")
	ErrNotFound       = errors.New("campus: not found")
	ErrDuplicateGroup = errors.New("campus: group code already exists")
	ErrUnknownGroup   = errors.New("campus: group does not exist")
	ErrUnknownStudent = errors.New("campus: student does not exist")
)

// StudentStatus — состояние студента в контингенте.
type StudentStatus string

// Возможные состояния.
const (
	StatusActive    StudentStatus = "active"    // учится
	StatusAcademic  StudentStatus = "academic"  // академический отпуск
	StatusExpelled  StudentStatus = "expelled"  // отчислен
	StatusGraduated StudentStatus = "graduated" // выпущен
)

func (s StudentStatus) valid() bool {
	switch s {
	case StatusActive, StatusAcademic, StatusExpelled, StatusGraduated:
		return true
	}
	return false
}

// Group — учебная группа.
type Group struct {
	ID             string
	Code           string
	Name           string
	ActiveStudents int
	CreatedAt      time.Time
}

// Student — студент контингента.
type Student struct {
	ID        string
	FullName  string
	Email     string
	GroupID   string // пусто = без группы
	GroupCode string
	Status    StudentStatus
	CreatedAt time.Time
}

// Grade — запись учебного журнала.
type Grade struct {
	ID        string
	StudentID string
	FullName  string
	GroupCode string
	Subject   string
	Grade     int
	GradedOn  time.Time
	GradedBy  string
	Note      string
}

// --- Команды -------------------------------------------------------------------

// CreateGroup — команда «создать учебную группу».
type CreateGroup struct {
	Code  string
	Title string // отображаемое название группы
}

// Name возвращает стабильное имя команды для аудита.
func (CreateGroup) Name() string { return CmdGroupCreate }

// Permission возвращает право, требуемое для исполнения.
func (CreateGroup) Permission() string { return PermGroupsWrite }

// Validate проверяет инварианты входа.
func (c CreateGroup) Validate() error {
	if c.Code == "" {
		return errors.New("campus: group code is required")
	}
	// Лимиты в символах, не в байтах: кириллица в UTF-8 двухбайтовая.
	if utf8.RuneCountInString(c.Code) > 32 || utf8.RuneCountInString(c.Title) > 255 {
		return errors.New("campus: group code/name is too long")
	}
	return nil
}

// EnrollStudent — команда «зачислить студента».
type EnrollStudent struct {
	FullName string
	Email    string
	GroupID  string // опционально
}

// Name возвращает стабильное имя команды для аудита.
func (EnrollStudent) Name() string { return CmdStudentEnroll }

// Permission возвращает право, требуемое для исполнения.
func (EnrollStudent) Permission() string { return PermStudentsWrite }

// Validate проверяет инварианты входа.
func (c EnrollStudent) Validate() error {
	if c.FullName == "" {
		return errors.New("campus: full name is required")
	}
	if utf8.RuneCountInString(c.FullName) > 255 || utf8.RuneCountInString(c.Email) > 255 {
		return errors.New("campus: name/email is too long")
	}
	return nil
}

// UpdateStudent — команда «изменить карточку студента» (ФИО, email,
// перевод в группу, смена статуса — отчисление, академ, выпуск).
type UpdateStudent struct {
	ID       string
	FullName string
	Email    string
	GroupID  string // пусто = убрать из группы
	Status   StudentStatus
}

// Name возвращает стабильное имя команды для аудита.
func (UpdateStudent) Name() string { return CmdStudentUpdate }

// Permission возвращает право, требуемое для исполнения.
func (UpdateStudent) Permission() string { return PermStudentsWrite }

// Validate проверяет инварианты входа.
func (c UpdateStudent) Validate() error {
	if c.ID == "" {
		return errors.New("campus: student id is required")
	}
	if c.FullName == "" {
		return errors.New("campus: full name is required")
	}
	if !c.Status.valid() {
		return fmt.Errorf("campus: unknown status %q", c.Status)
	}
	return nil
}

// RecordGrade — команда «выставить оценку в журнал».
type RecordGrade struct {
	StudentID string
	Subject   string
	Grade     int
	GradedOn  time.Time // нулевое время = сегодня
	Note      string
}

// Name возвращает стабильное имя команды для аудита.
func (RecordGrade) Name() string { return CmdGradeRecord }

// Permission возвращает право, требуемое для исполнения.
func (RecordGrade) Permission() string { return PermGradesWrite }

// Validate проверяет инварианты входа.
func (c RecordGrade) Validate() error {
	if c.StudentID == "" {
		return errors.New("campus: student id is required")
	}
	if c.Subject == "" {
		return errors.New("campus: subject is required")
	}
	if c.Grade < 2 || c.Grade > 5 {
		return fmt.Errorf("campus: grade %d is out of range 2..5", c.Grade)
	}
	return nil
}
