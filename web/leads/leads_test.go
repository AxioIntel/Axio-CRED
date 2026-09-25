//nolint:testpackage // tests the lead store's unexported parsing and export helpers
package leads

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const csvHeader = "input_id,link,title,category,address,website,phone,review_count,review_rating,place_id,complete_address,emails\n"

func mapsCSV(rows ...string) string { return csvHeader + strings.Join(rows, "\n") + "\n" }

func row(query, title, placeID, phone, emails, rating, reviews, city string) string {
	addr := `"{""city"":""` + city + `"",""state"":""Texas"",""country"":""US""}"`

	return strings.Join([]string{
		query, "https://maps.google.com/?cid=" + placeID, title, "Dentist", `"1 Main St, ` + city + `"`,
		"https://" + strings.ToLower(strings.ReplaceAll(title, " ", "")) + ".com", phone, reviews,
		rating, placeID, addr, `"` + emails + `"`,
	}, ",")
}

func newStore(t *testing.T) (s *Store, dir string) {
	t.Helper()

	dir = t.TempDir()

	s, err := Open(filepath.Join(dir, "leads.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })

	return s, dir
}

func writeFile(t *testing.T, dir, name, body string) string {
	t.Helper()

	p := filepath.Join(dir, name)
	require.NoError(t, os.WriteFile(p, []byte(body), 0o600))

	return p
}

func TestIngestMakesOneLeadPerPlaceAcrossJobs(t *testing.T) {
	s, dir := newStore(t)
	ctx := context.Background()

	job1 := writeFile(t, dir, "j1.csv", mapsCSV(
		row("dentist in Austin TX", "Smile Dental", "P1", "+1 512-296-2841", "info@smile.com, dr@gmail.com", "4.6", "952", "Austin"),
		row("dentist in Austin TX", "Tooth Co", "P2", "", "", "3.9", "12", "Austin"),
	))
	n, err := s.IngestCSV(ctx, "job-1", job1)
	require.NoError(t, err)
	assert.Equal(t, 2, n)

	// A later job finds Smile Dental again, now without its email shown, and a new place.
	job2 := writeFile(t, dir, "j2.csv", mapsCSV(
		row("dentist in Round Rock TX", "Smile Dental", "P1", "+1 512-296-2841", "", "4.7", "960", "Austin"),
		row("dentist in Round Rock TX", "Rock Dental", "P3", "+1 737-555-0100", "hello@rock.com", "4.9", "88", "Round Rock"),
	))
	_, err = s.IngestCSV(ctx, "job-2", job2)
	require.NoError(t, err)

	all, total, err := s.Query(ctx, &Filter{})
	require.NoError(t, err)
	assert.Equal(t, 3, total)
	assert.Len(t, all, 3)

	smile := find(t, all, "Smile Dental")
	assert.Equal(t, "info@smile.com; dr@gmail.com", smile.Emails, "an address the listing stopped showing is kept")
	assert.Equal(t, "info@smile.com", smile.FirstEmail())
	assert.InDelta(t, 4.7, smile.Rating, 0.001, "what the listing says now wins")
	assert.Equal(t, 960, smile.Reviews)
	assert.Equal(t, 2, smile.Jobs)
	assert.Equal(t, "Austin", smile.City)
	assert.Equal(t, "US", smile.Country)
	assert.Equal(t, "new", smile.Status)

	ok, err := s.Ingested(ctx, "job-2")
	require.NoError(t, err)
	assert.True(t, ok)

	counts, err := s.JobLeadCounts(ctx)
	require.NoError(t, err)
	assert.Equal(t, map[string]int{"job-1": 2, "job-2": 2}, counts)
}

func TestReingestNeverTouchesTheOperatorsStatus(t *testing.T) {
	s, dir := newStore(t)
	ctx := context.Background()
	p := writeFile(t, dir, "j.csv", mapsCSV(row("q", "Smile Dental", "P1", "+1 512-296-2841", "info@smile.com", "4.6", "952", "Austin")))

	_, err := s.IngestCSV(ctx, "job-1", p)
	require.NoError(t, err)

	all, _, err := s.Query(ctx, &Filter{})
	require.NoError(t, err)
	require.NoError(t, s.SetStatus(ctx, []int64{all[0].ID}, "contacted", "emailed Monday"))

	_, err = s.IngestCSV(ctx, "job-9", p)
	require.NoError(t, err)

	got, err := s.Get(ctx, all[0].ID)
	require.NoError(t, err)
	assert.Equal(t, "contacted", got.Status)
	assert.Equal(t, "emailed Monday", got.Note)
	assert.False(t, got.StatusAt.IsZero())

	assert.Error(t, s.SetStatus(ctx, []int64{got.ID}, "spam-them", ""))
}

func TestFiltersSortAndPaging(t *testing.T) {
	s, dir := newStore(t)
	ctx := context.Background()
	p := writeFile(t, dir, "j.csv", mapsCSV(
		row("q", "Smile Dental", "P1", "+1 512-296-2841", "info@smile.com", "4.6", "952", "Austin"),
		row("q", "Tooth Co", "P2", "", "", "3.9", "12", "Austin"),
		row("q", "Rock Dental", "P3", "+1 737-555-0100", "hello@rock.com", "4.9", "88", "Round Rock"),
	))
	_, err := s.IngestCSV(ctx, "job-1", p)
	require.NoError(t, err)

	names := func(f Filter) []string {
		t.Helper()

		ls, _, err := s.Query(ctx, &f)
		require.NoError(t, err)

		var out []string
		for i := range ls {
			out = append(out, ls[i].Name)
		}

		return out
	}

	assert.ElementsMatch(t, []string{"Smile Dental", "Rock Dental"}, names(Filter{HasEmail: true}))
	assert.ElementsMatch(t, []string{"Smile Dental", "Rock Dental"}, names(Filter{HasPhone: true}))
	assert.Equal(t, []string{"Rock Dental"}, names(Filter{City: "round"}))
	assert.Equal(t, []string{"Rock Dental", "Smile Dental"}, names(Filter{MinRating: 4.5, Sort: "rating"}))
	assert.Equal(t, []string{"Smile Dental"}, names(Filter{MinReviews: 100}))
	assert.Equal(t, []string{"Rock Dental"}, names(Filter{Q: "HELLO@ROCK"}))
	assert.Equal(t, []string{"Rock Dental", "Smile Dental", "Tooth Co"}, names(Filter{Sort: "name"}))
	assert.Equal(t, []string{"Smile Dental"}, names(Filter{Sort: "name", PageSize: 1, Page: 2}))
	assert.Len(t, names(Filter{JobID: "job-1"}), 3)
	assert.Empty(t, names(Filter{JobID: "job-other"}))

	st, err := s.Stats(ctx)
	require.NoError(t, err)
	assert.Equal(t, Stats{Total: 3, WithEmail: 2, WithPhone: 2}, st)
}

func TestACutOffCSVKeepsTheRowsBeforeTheCut(t *testing.T) {
	s, dir := newStore(t)
	full := mapsCSV(row("q", "Smile Dental", "P1", "+1 512-296-2841", "info@smile.com", "4.6", "952", "Austin"))
	p := writeFile(t, dir, "j.csv", full+`q,https://x,"Unfinished Den`)

	n, err := s.IngestCSV(context.Background(), "job-1", p)
	require.NoError(t, err)
	assert.Equal(t, 1, n)
}

func TestPhoneE164(t *testing.T) {
	for in, want := range map[string]string{
		"+1 512-296-2841": "+15122962841",
		"+91 98765 43210": "+919876543210",
		"(512) 296-2841":  "",
		"":                "",
		"+1 23":           "",
	} {
		assert.Equal(t, want, PhoneE164(in), in)
	}
}

func TestCSVExportIsCleanAndSafe(t *testing.T) {
	var buf bytes.Buffer

	err := WriteCSV(&buf, []Lead{
		{Name: "=HYPERLINK(1)", Phone: "+1 512-296-2841", Emails: "a@x.com; b@x.com", Rating: 4.6, Reviews: 9},
		{Name: "-dashing", Phone: "-"},
	})
	require.NoError(t, err)

	body := strings.TrimPrefix(buf.String(), string([]byte{0xEF, 0xBB, 0xBF}))
	recs, err := csv.NewReader(strings.NewReader(body)).ReadAll()
	require.NoError(t, err)

	assert.Equal(t, ExportHeaders, recs[0])
	assert.Equal(t, "'=HYPERLINK(1)", recs[1][0], "a formula in a listing's name is neutralised")
	assert.Equal(t, "a@x.com", recs[1][2])
	assert.Equal(t, "+1 512-296-2841", recs[1][4], "a phone number is left alone")
	assert.Equal(t, "+15122962841", recs[1][5])
	assert.Equal(t, "'-dashing", recs[2][0])
}

func TestXLSXExportIsAValidWorkbook(t *testing.T) {
	var buf bytes.Buffer

	require.NoError(t, WriteXLSX(&buf, []Lead{{Name: "Smile & <Co>", Phone: "+1 512", Rating: 4.6, Reviews: 952}}))

	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	require.NoError(t, err)

	files := map[string]string{}

	for _, f := range zr.File {
		rc, err := f.Open()
		require.NoError(t, err)

		b, err := io.ReadAll(rc)
		require.NoError(t, err)
		require.NoError(t, rc.Close())

		files[f.Name] = string(b)
	}

	for _, part := range []string{"[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml"} {
		assert.Contains(t, files, part)
	}

	sheet := files["xl/worksheets/sheet1.xml"]
	assert.Contains(t, sheet, "Smile &amp; &lt;Co&gt;")
	assert.Contains(t, sheet, `<c r="L2"><v>4.6</v></c>`, "rating is a number")
	assert.Contains(t, sheet, `<c r="M2"><v>952</v></c>`, "reviews is a number")
	assert.Contains(t, sheet, `<c r="E2" t="inlineStr"><is><t xml:space="preserve">+1 512</t></is></c>`)
}

func TestColumnName(t *testing.T) {
	assert.Equal(t, "A", columnName(0))
	assert.Equal(t, "Z", columnName(25))
	assert.Equal(t, "AA", columnName(26))
	assert.Equal(t, "AT", columnName(45))
}

func find(t *testing.T, ls []Lead, name string) Lead {
	t.Helper()

	for i := range ls {
		if ls[i].Name == name {
			return ls[i]
		}
	}

	t.Fatalf("no lead %q", name)

	return Lead{}
}

func TestSearchOfDropsAGridSquaresID(t *testing.T) {
	assert.Equal(t, "dentist", searchOf("dentist-0b5f7d8e-3c1a-4f2e-9a6b-7d8e9f0a1b2c"))
	assert.Equal(t, "dentist in Austin TX", searchOf("dentist in Austin TX"))
	assert.Equal(t, "24-hour locksmith", searchOf("24-hour locksmith"))
}
