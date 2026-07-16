package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestWriteProblem_5xxHidesDetail проверяет ключевое защитное свойство:
// сырые внутренние ошибки (тексты pgx с именами таблиц/колонок, пути и
// т.п.), которые хендлеры передают в detail при 5xx, не должны долетать
// до клиента. Для 4xx detail — собственная ошибка клиента, её прятать
// незачем.
func TestWriteProblem_5xxHidesDetail(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteProblem(rec, http.StatusInternalServerError, "Внутренняя ошибка",
		"pq: relation \"finance_accounts\" violates foreign key constraint \"fk_tenant\"")

	var got Problem
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Detail != "" {
		t.Errorf("detail утёк в ответ клиенту: %q", got.Detail)
	}
	if got.Status != http.StatusInternalServerError || got.Title != "Внутренняя ошибка" {
		t.Errorf("status/title изменились неожиданно: %+v", got)
	}
}

func TestWriteProblem_4xxKeepsDetail(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteProblem(rec, http.StatusBadRequest, "Некорректный запрос", "поле email обязательно")

	var got Problem
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Detail != "поле email обязательно" {
		t.Errorf("detail = %q, want исходное сообщение клиенту", got.Detail)
	}
}
