package xlsx

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"
)

func TestWriteProducesValidZipWithCells(t *testing.T) {
	f := New("Обороты")
	f.AddRow("Месяц", "Дебет")
	f.AddRow("2026-07", int64(4500000))

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		t.Fatalf("Write: %v", err)
	}

	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("не ZIP: %v", err)
	}
	var sheet string
	names := map[string]bool{}
	for _, zf := range zr.File {
		names[zf.Name] = true
		if zf.Name == "xl/worksheets/sheet1.xml" {
			rc, _ := zf.Open()
			b, _ := io.ReadAll(rc)
			_ = rc.Close()
			sheet = string(b)
		}
	}
	for _, want := range []string{"[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"} {
		if !names[want] {
			t.Errorf("в архиве нет %s", want)
		}
	}
	if !strings.Contains(sheet, "Месяц") || !strings.Contains(sheet, "<v>4500000</v>") {
		t.Errorf("лист не содержит данных: %s", sheet)
	}
}

func TestColName(t *testing.T) {
	for i, want := range map[int]string{0: "A", 25: "Z", 26: "AA", 27: "AB", 51: "AZ", 52: "BA"} {
		if got := colName(i); got != want {
			t.Errorf("colName(%d) = %s, want %s", i, got, want)
		}
	}
}

func TestEscaping(t *testing.T) {
	f := New(`<x>&"</x>`)
	f.AddRow(`a<b & "c"`)
	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(buf.Bytes(), []byte(`a<b`)) {
		t.Error("XML-спецсимволы не экранированы")
	}
}
