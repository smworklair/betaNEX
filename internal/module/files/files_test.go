package files

import (
	"strings"
	"testing"
)

func validAttach() Attach {
	return Attach{
		FileName: "приказ.pdf",
		Size:     1024,
		SHA256:   strings.Repeat("ab", 32),
	}
}

func TestAttachValidate(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*Attach)
		wantErr bool
	}{
		{"валидная", func(*Attach) {}, false},
		{"пустое имя", func(a *Attach) { a.FileName = "" }, true},
		{"длинное имя", func(a *Attach) { a.FileName = strings.Repeat("ы", 256) }, true},
		// Лимит в символах: 255 кириллических букв (510 байт) проходят.
		{"кириллица на границе", func(a *Attach) { a.FileName = strings.Repeat("ы", 255) }, false},
		{"нулевой размер", func(a *Attach) { a.Size = 0 }, true},
		{"отрицательный размер", func(a *Attach) { a.Size = -1 }, true},
		{"кривой хэш", func(a *Attach) { a.SHA256 = "abc" }, true},
		{"тип сущности без ID", func(a *Attach) { a.EntityType = "student" }, true},
		{"ID сущности без типа", func(a *Attach) { a.EntityID = "s-1" }, true},
		{"сущность целиком", func(a *Attach) { a.EntityType = "student"; a.EntityID = "s-1" }, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cmd := validAttach()
			tt.mutate(&cmd)
			if err := cmd.Validate(); (err != nil) != tt.wantErr {
				t.Errorf("Validate() = %v, ожидалась ошибка: %v", err, tt.wantErr)
			}
		})
	}
}
