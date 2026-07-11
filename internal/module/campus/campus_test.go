package campus

import (
	"strings"
	"testing"
)

func TestCreateGroupValidate(t *testing.T) {
	tests := []struct {
		name    string
		cmd     CreateGroup
		wantErr bool
	}{
		{"пустой код", CreateGroup{}, true},
		{"длинный код", CreateGroup{Code: strings.Repeat("к", 33)}, true},
		{"длинное название", CreateGroup{Code: "ИС-21", Title: strings.Repeat("я", 256)}, true},
		// Лимит считается в символах: 255 кириллических букв — это
		// 510 байт, но команда обязана проходить.
		{"кириллица на границе", CreateGroup{Code: strings.Repeat("к", 32), Title: strings.Repeat("я", 255)}, false},
		{"валидная", CreateGroup{Code: "ИС-21", Title: "Информационные системы"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.cmd.Validate(); (err != nil) != tt.wantErr {
				t.Errorf("Validate() = %v, ожидалась ошибка: %v", err, tt.wantErr)
			}
		})
	}
}

func TestEnrollStudentValidate(t *testing.T) {
	tests := []struct {
		name    string
		cmd     EnrollStudent
		wantErr bool
	}{
		{"пустое ФИО", EnrollStudent{}, true},
		{"длинное ФИО", EnrollStudent{FullName: strings.Repeat("а", 256)}, true},
		{"кириллица на границе", EnrollStudent{FullName: strings.Repeat("а", 255)}, false},
		{"валидная", EnrollStudent{FullName: "Иванов Иван Иванович", Email: "ivanov@example.ru"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.cmd.Validate(); (err != nil) != tt.wantErr {
				t.Errorf("Validate() = %v, ожидалась ошибка: %v", err, tt.wantErr)
			}
		})
	}
}

func TestRecordGradeValidate(t *testing.T) {
	base := RecordGrade{StudentID: "s-1", Subject: "Математика"}
	for grade, ok := range map[int]bool{1: false, 2: true, 5: true, 6: false} {
		cmd := base
		cmd.Grade = grade
		if err := cmd.Validate(); (err == nil) != ok {
			t.Errorf("оценка %d: Validate() = %v, допустима: %v", grade, err, ok)
		}
	}
	if err := (RecordGrade{Subject: "Математика", Grade: 4}).Validate(); err == nil {
		t.Error("без student id валидация обязана падать")
	}
	if err := (RecordGrade{StudentID: "s-1", Grade: 4}).Validate(); err == nil {
		t.Error("без предмета валидация обязана падать")
	}
}
