package leads

import (
	"archive/zip"
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode"
)

// ExportHeaders are the columns every export carries, in order: what outreach needs, nothing else.
var ExportHeaders = []string{
	"name", "category", "email", "all_emails", "phone", "phone_e164", "website", "address", "city",
	"state", "country", "rating", "reviews", "status", "note", "source", "search", "link",
	"first_seen", "last_seen",
}

func exportRow(l *Lead) []string {
	return []string{
		l.Name, l.Category, l.FirstEmail(), l.Emails, l.Phone, PhoneE164(l.Phone), l.Website,
		l.Address, l.City, l.State, l.Country, strconv.FormatFloat(l.Rating, 'f', 1, 64),
		strconv.Itoa(l.Reviews), l.Status, l.Note, l.Source, l.Query, l.Link,
		l.FirstSeen.Format("2006-01-02"), l.LastSeen.Format("2006-01-02"),
	}
}

// PhoneE164 is a listed number in the +<country><number> form WhatsApp and SMS tools expect, or ""
// when the listing did not give one with its country code.
func PhoneE164(phone string) string {
	phone = strings.TrimSpace(phone)
	if !strings.HasPrefix(phone, "+") {
		return ""
	}

	var b strings.Builder

	b.WriteByte('+')

	for _, r := range phone[1:] {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}

	if n := b.Len() - 1; n < 8 || n > 15 {
		return ""
	}

	return b.String()
}

// WriteCSV writes leads as a CSV with ExportHeaders. A leading UTF-8 byte-order mark makes Excel
// open accented names correctly.
func WriteCSV(w io.Writer, leads []Lead) error {
	if _, err := io.WriteString(w, "\ufeff"); err != nil {
		return err
	}

	cw := csv.NewWriter(w)

	if err := cw.Write(ExportHeaders); err != nil {
		return err
	}

	for i := range leads {
		row := exportRow(&leads[i])
		for j := range row {
			row[j] = csvSafe(row[j])
		}

		if err := cw.Write(row); err != nil {
			return err
		}
	}

	cw.Flush()

	return cw.Error()
}

// WriteXLSX writes leads as a one-sheet Excel workbook with ExportHeaders. Written directly (an
// xlsx file is a zip of a few XML parts) to keep the dashboard free of a spreadsheet dependency.
// Rating and reviews are numbers; everything else is text, so phone numbers keep their "+".
func WriteXLSX(w io.Writer, leads []Lead) error {
	zw := zip.NewWriter(w)

	parts := []struct{ name, body string }{
		{"[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`},
		{"_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
		{"xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Leads" sheetId="1" r:id="rId1"/></sheets></workbook>`},
		{"xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`},
	}

	for _, p := range parts {
		f, err := zw.Create(p.name)
		if err != nil {
			return err
		}

		if _, err := io.WriteString(f, p.body); err != nil {
			return err
		}
	}

	sheet, err := zw.Create("xl/worksheets/sheet1.xml")
	if err != nil {
		return err
	}

	var b strings.Builder

	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	b.WriteString(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`)
	writeXLSXRow(&b, 1, ExportHeaders, nil)

	numeric := map[int]bool{11: true, 12: true} // rating, reviews

	for i := range leads {
		writeXLSXRow(&b, i+2, exportRow(&leads[i]), numeric)
	}

	b.WriteString(`</sheetData></worksheet>`)

	if _, err := io.WriteString(sheet, b.String()); err != nil {
		return err
	}

	return zw.Close()
}

func writeXLSXRow(b *strings.Builder, row int, cells []string, numeric map[int]bool) {
	fmt.Fprintf(b, `<row r="%d">`, row)

	for i, v := range cells {
		ref := columnName(i) + strconv.Itoa(row)

		if numeric[i] {
			if _, err := strconv.ParseFloat(v, 64); err == nil {
				fmt.Fprintf(b, `<c r="%s"><v>%s</v></c>`, ref, v)

				continue
			}
		}

		fmt.Fprintf(b, `<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>`, ref, xmlText(v))
	}

	b.WriteString(`</row>`)
}

// columnName is the spreadsheet column for a 0-based index: 0 -> A, 25 -> Z, 26 -> AA.
func columnName(i int) string {
	name := ""

	for i >= 0 {
		name = string(rune('A'+i%26)) + name
		i = i/26 - 1
	}

	return name
}

// xmlText escapes a cell's text and drops characters XML cannot carry.
func xmlText(s string) string {
	var b strings.Builder

	for _, r := range s {
		switch {
		case r == '&':
			b.WriteString("&amp;")
		case r == '<':
			b.WriteString("&lt;")
		case r == '>':
			b.WriteString("&gt;")
		case r == '"':
			b.WriteString("&quot;")
		case r == '\t' || r == '\n' || r == '\r':
			b.WriteRune(r)
		case r < 0x20 || r == 0xFFFE || r == 0xFFFF || !unicode.IsPrint(r) && r < 0x80:
			continue
		default:
			b.WriteRune(r)
		}
	}

	return b.String()
}

// csvSafe keeps a spreadsheet from running a cell as a formula: a listing's name is written by
// whoever owns the listing. A leading "=", "@", tab or carriage return, or a "+" or "-" that is not
// the start of a number, gets a leading apostrophe. Phone numbers such as "+1 512..." stay as they
// are, so the file still imports cleanly into outreach tools.
func csvSafe(v string) string {
	if v == "" {
		return v
	}

	switch v[0] {
	case '=', '@', '\t', '\r':
		return "'" + v
	case '+', '-':
		if len(v) > 1 && (v[1] >= '0' && v[1] <= '9' || v[1] == ' ' || v[1] == '(') {
			return v
		}

		return "'" + v
	}

	return v
}
