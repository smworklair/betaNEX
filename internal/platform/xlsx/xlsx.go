// Package xlsx — минимальный писатель XLSX без внешних зависимостей:
// XLSX — это ZIP с XML внутри (OOXML), простой лист собирается на
// archive/zip + ручном XML. Для типовой министерской выгрузки (плоская
// таблица) этого достаточно; сложные книги со стилями и формулами —
// повод взять excelize отдельным ADR (см. docs/go-guide.md §31).
package xlsx

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"strings"
)

// Cell — значение ячейки: string выгружается как inline-строка,
// целые и float — как числа.
type Cell any

// File — книга из одного листа (типовая выгрузка).
type File struct {
	sheet string
	rows  [][]Cell
}

// New создаёт книгу с одним листом.
func New(sheetName string) *File {
	if sheetName == "" {
		sheetName = "Лист1"
	}
	return &File{sheet: sheetName}
}

// AddRow добавляет строку значений.
func (f *File) AddRow(cells ...Cell) {
	f.rows = append(f.rows, cells)
}

// Write собирает XLSX и пишет его в w.
func (f *File) Write(w io.Writer) error {
	zw := zip.NewWriter(w)
	parts := []struct{ name, body string }{
		{"[Content_Types].xml", contentTypes},
		{"_rels/.rels", relsRoot},
		{"xl/workbook.xml", fmt.Sprintf(workbookTmpl, xmlEscape(f.sheet))},
		{"xl/_rels/workbook.xml.rels", relsWorkbook},
		{"xl/worksheets/sheet1.xml", f.sheetXML()},
	}
	for _, p := range parts {
		fw, err := zw.Create(p.name)
		if err != nil {
			return fmt.Errorf("xlsx: %s: %w", p.name, err)
		}
		if _, err := fw.Write([]byte(p.body)); err != nil {
			return fmt.Errorf("xlsx: %s: %w", p.name, err)
		}
	}
	return zw.Close()
}

func (f *File) sheetXML() string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	b.WriteString(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`)
	for ri, row := range f.rows {
		fmt.Fprintf(&b, `<row r="%d">`, ri+1)
		for ci, cell := range row {
			ref := colName(ci) + fmt.Sprint(ri+1)
			switch v := cell.(type) {
			case nil:
				continue
			case string:
				fmt.Fprintf(&b, `<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>`,
					ref, xmlEscape(v))
			case int, int32, int64, uint, uint32, uint64, float32, float64:
				fmt.Fprintf(&b, `<c r="%s"><v>%v</v></c>`, ref, v)
			default:
				fmt.Fprintf(&b, `<c r="%s" t="inlineStr"><is><t>%s</t></is></c>`,
					ref, xmlEscape(fmt.Sprint(v)))
			}
		}
		b.WriteString(`</row>`)
	}
	b.WriteString(`</sheetData></worksheet>`)
	return b.String()
}

// colName переводит индекс колонки в имя (0→A, 25→Z, 26→AA).
func colName(i int) string {
	name := ""
	for i >= 0 {
		name = string(rune('A'+i%26)) + name
		i = i/26 - 1
	}
	return name
}

func xmlEscape(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`

const relsRoot = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const workbookTmpl = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="%s" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

const relsWorkbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`
