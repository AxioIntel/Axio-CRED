package leads

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"
)

// IngestCSV folds one finished Google Maps job's CSV into the lead list and records the job as
// ingested. A job whose CSV is partial (it failed or ran out of time) is ingested for what it has.
// Returns how many rows became (or refreshed) leads.
func (s *Store) IngestCSV(ctx context.Context, jobID, path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	rows, err := parseMapsCSV(f)
	if err != nil {
		return 0, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}

	defer func() { _ = tx.Rollback() }()

	now := time.Now().UTC()

	for i := range rows {
		if err := upsert(ctx, tx, &rows[i], jobID, now); err != nil {
			return 0, fmt.Errorf("lead %q: %w", rows[i].Name, err)
		}
	}

	_, err = tx.ExecContext(ctx, `INSERT INTO ingested_jobs (job_id, rows, at) VALUES (?, ?, ?)
		ON CONFLICT (job_id) DO UPDATE SET rows = excluded.rows, at = excluded.at`, jobID, len(rows), now.Unix())
	if err != nil {
		return 0, err
	}

	return len(rows), tx.Commit()
}

// parseMapsCSV reads the Google Maps scraper's CSV (gmaps.Entry.CsvHeaders) by column name, so a
// column added upstream does not shift anything.
func parseMapsCSV(r io.Reader) ([]Lead, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	cr.LazyQuotes = true

	header, err := cr.Read()
	if errors.Is(err, io.EOF) {
		return nil, nil
	}

	if err != nil {
		return nil, err
	}

	col := map[string]int{}
	for i, h := range header {
		col[strings.TrimSpace(strings.TrimPrefix(h, "\ufeff"))] = i
	}

	get := func(rec []string, name string) string {
		i, ok := col[name]
		if !ok || i >= len(rec) {
			return ""
		}

		return strings.TrimSpace(rec[i])
	}

	var out []Lead

	for {
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			break
		}

		if err != nil {
			// A row cut off by a job's time limit ends the file; keep what came before it.
			var perr *csv.ParseError
			if errors.As(err, &perr) {
				break
			}

			return nil, err
		}

		// A row shorter than the header was cut off mid-write by the job's time limit.
		if len(rec) < len(header) {
			continue
		}

		name := get(rec, "title")
		sourceID := get(rec, "place_id")

		if sourceID == "" {
			sourceID = get(rec, "link")
		}

		if name == "" || sourceID == "" {
			continue
		}

		l := Lead{
			Source:   SourceGoogleMaps,
			SourceID: sourceID,
			Name:     name,
			Category: get(rec, "category"),
			Phone:    get(rec, "phone"),
			Emails:   joinEmails(get(rec, "emails")),
			Website:  get(rec, "website"),
			Address:  get(rec, "address"),
			Link:     get(rec, "link"),
			Query:    get(rec, "input_id"),
		}

		l.Rating, _ = strconv.ParseFloat(get(rec, "review_rating"), 64)
		l.Reviews, _ = strconv.Atoi(get(rec, "review_count"))
		l.City, l.State, l.Country = addressParts(get(rec, "complete_address"))

		out = append(out, l)
	}

	return out, nil
}

// joinEmails turns the scraper's ", "-joined addresses into the lead list's "; " form.
func joinEmails(raw string) string {
	var out []string

	for _, e := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ';' }) {
		if e = strings.TrimSpace(e); e != "" {
			out = append(out, e)
		}
	}

	return strings.Join(out, "; ")
}

// addressParts reads city, state and country from the scraper's complete_address JSON.
func addressParts(raw string) (city, state, country string) {
	if raw == "" {
		return "", "", ""
	}

	var a struct {
		City    string `json:"city"`
		State   string `json:"state"`
		Country string `json:"country"`
	}

	if json.Unmarshal([]byte(raw), &a) != nil {
		return "", "", ""
	}

	return a.City, a.State, a.Country
}
