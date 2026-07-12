package campus_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/smworklair/betakis/internal/kernel/audit"
	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/module/campus"
	"github.com/smworklair/betakis/internal/module/tasks"
	"github.com/smworklair/betakis/internal/platform/httpapi"
	"github.com/smworklair/betakis/internal/platform/postgres"
)

// TestCampusAndTasksFlow — сценарий экранов сайта: создать группы →
// зачислить студентов → отсортировать → выставить оценки → журнал →
// перевод/отчисление; задачи: создать → список → выполнить.
func TestCampusAndTasksFlow(t *testing.T) {
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
		t.Fatal(err)
	}
	t.Cleanup(pg.Close)

	var buf [6]byte
	if _, err := rand.Read(buf[:]); err != nil {
		t.Fatal(err)
	}
	tenantID, err := pg.EnsureTenant(ctx, "campus-"+hex.EncodeToString(buf[:]))
	if err != nil {
		t.Fatal(err)
	}

	campusRepo := campus.NewRepository(pg)
	tasksRepo := tasks.NewRepository(pg)
	policy := authz.NewPolicy()
	for _, p := range []string{campus.PermGroupsWrite, campus.PermStudentsWrite, campus.PermGradesWrite, campus.PermRead, tasks.PermWrite, tasks.PermRead} {
		policy.Grant("admin", p)
	}
	guard := authz.NewGuard(policy)
	bus := command.NewMemoryBus(authz.NewPolicyAuthorizer(policy), &audit.MemoryRecorder{}, command.WithTxRunner(pg))
	if err := campus.RegisterCommands(bus, campusRepo); err != nil {
		t.Fatal(err)
	}
	if err := tasks.RegisterCommands(bus, tasksRepo, nil); err != nil {
		t.Fatal(err)
	}
	router := httpapi.NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), httpapi.RouterConfig{
		DevAuth: true,
		Mount: []func(*http.ServeMux){
			campus.Routes(bus, campusRepo, guard),
			tasks.Routes(bus, tasksRepo, guard),
		},
	})

	do := func(method, path, body string) *httptest.ResponseRecorder {
		var rdr io.Reader
		if body != "" {
			rdr = strings.NewReader(body)
		}
		req := httptest.NewRequest(method, path, rdr)
		req.Header.Set("X-Dev-Actor", "teacher-1")
		req.Header.Set("X-Dev-Roles", "admin")
		req.Header.Set("X-Dev-Tenant", tenantID)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	mustJSON := func(rec *httptest.ResponseRecorder, dst any) {
		t.Helper()
		if err := json.Unmarshal(rec.Body.Bytes(), dst); err != nil {
			t.Fatalf("разбор ответа: %v (%s)", err, rec.Body.String())
		}
	}

	// Группы.
	if rec := do("POST", "/api/v1/campus/groups", `{"code":"ИС-21","name":"Информационные системы"}`); rec.Code != 201 {
		t.Fatalf("группа: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do("POST", "/api/v1/campus/groups", `{"code":"ИС-21","name":"дубль"}`); rec.Code != 409 {
		t.Fatalf("дубль группы: %d, want 409", rec.Code)
	}
	var groups []struct {
		ID   string `json:"id"`
		Code string `json:"code"`
	}
	mustJSON(do("GET", "/api/v1/campus/groups", ""), &groups)
	groupID := groups[0].ID

	// Студенты: двое в группу, один без группы.
	for _, body := range []string{
		`{"full_name":"Яшин Борис","email":"b@x.ru","group_id":"` + groupID + `"}`,
		`{"full_name":"Иванова Анна","email":"a@x.ru","group_id":"` + groupID + `"}`,
		`{"full_name":"Смирнов Пётр"}`,
	} {
		if rec := do("POST", "/api/v1/campus/students", body); rec.Code != 201 {
			t.Fatalf("студент: %d %s", rec.Code, rec.Body.String())
		}
	}

	// Сортировка по имени: Иванова первая, Яшин последний.
	var students []struct {
		ID       string `json:"id"`
		FullName string `json:"full_name"`
		Status   string `json:"status"`
	}
	mustJSON(do("GET", "/api/v1/campus/students?sort=name", ""), &students)
	if len(students) != 3 || students[0].FullName != "Иванова Анна" || students[2].FullName != "Яшин Борис" {
		t.Fatalf("сортировка по имени: %+v", students)
	}

	// Фильтр по группе.
	var inGroup []struct{ ID string }
	mustJSON(do("GET", "/api/v1/campus/students?group="+groupID, ""), &inGroup)
	if len(inGroup) != 2 {
		t.Fatalf("в группе %d студентов, want 2", len(inGroup))
	}

	// Поиск.
	mustJSON(do("GET", "/api/v1/campus/students?q=Иванова", ""), &students)
	if len(students) != 1 {
		t.Fatalf("поиск по ФИО: %d, want 1", len(students))
	}
	ivanova := students[0].ID

	// Журнал: две оценки.
	if rec := do("POST", "/api/v1/campus/grades",
		`{"student_id":"`+ivanova+`","subject":"Математика","grade":5}`); rec.Code != 201 {
		t.Fatalf("оценка: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do("POST", "/api/v1/campus/grades",
		`{"student_id":"`+ivanova+`","subject":"Математика","grade":7}`); rec.Code != 400 {
		t.Fatalf("оценка 7 должна отклоняться: %d", rec.Code)
	}
	var journal []struct {
		FullName string `json:"full_name"`
		Subject  string `json:"subject"`
		Grade    int    `json:"grade"`
		GradedBy string `json:"graded_by"`
	}
	mustJSON(do("GET", "/api/v1/campus/journal?subject=Математика", ""), &journal)
	if len(journal) != 1 || journal[0].Grade != 5 || journal[0].GradedBy != "teacher-1" {
		t.Fatalf("журнал: %+v", journal)
	}

	// Отчисление: статус меняется, в активных группах студентов меньше.
	if rec := do("PATCH", "/api/v1/campus/students/"+ivanova,
		`{"full_name":"Иванова Анна","status":"expelled"}`); rec.Code != 201 {
		t.Fatalf("отчисление: %d %s", rec.Code, rec.Body.String())
	}
	mustJSON(do("GET", "/api/v1/campus/students?status=expelled", ""), &students)
	if len(students) != 1 || students[0].Status != "expelled" {
		t.Fatalf("отчисленные: %+v", students)
	}

	// Задачи: создать, отсортировать по сроку, выполнить.
	if rec := do("POST", "/api/v1/tasks", `{"title":"Подготовить приказ об отчислении","due_on":"2026-09-01"}`); rec.Code != 201 {
		t.Fatalf("задача: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do("POST", "/api/v1/tasks", `{"title":"Сверить ведомость"}`); rec.Code != 201 {
		t.Fatalf("задача 2: %d", rec.Code)
	}
	var open []struct {
		ID    string `json:"id"`
		Title string `json:"title"`
	}
	mustJSON(do("GET", "/api/v1/tasks?status=open&sort=due", ""), &open)
	if len(open) != 2 || open[0].Title != "Подготовить приказ об отчислении" {
		t.Fatalf("задачи: %+v", open)
	}
	if rec := do("POST", "/api/v1/tasks/"+open[0].ID+"/complete", ""); rec.Code != 200 {
		t.Fatalf("выполнение: %d", rec.Code)
	}
	mustJSON(do("GET", "/api/v1/tasks?status=open", ""), &open)
	if len(open) != 1 {
		t.Fatalf("открытых задач: %d, want 1", len(open))
	}
}
