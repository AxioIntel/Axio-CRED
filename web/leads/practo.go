package leads

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"
)

// ImportError describes invalid input without exposing database details.
type ImportError struct{ Message string }

func (e *ImportError) Error() string { return e.Message }

// ImportPracto imports user-supplied profile observations, without fetching Practo.
// It validates the whole file before saving and preserves operator state on reimport.
func (s *Store) ImportPracto(ctx context.Context, batchID string, input io.Reader) (int, error) {
	rows, err := parsePractoCSV(input)
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
		if err := upsert(ctx, tx, &rows[i], batchID, now); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(rows), nil
}

func parsePractoCSV(input io.Reader) ([]Lead, error) {
	invalid := func(message string) ([]Lead, error) { return nil, &ImportError{message} }
	reader := csv.NewReader(input)
	header, err := reader.Read()
	if err != nil {
		return invalid("The CSV is empty or its header is invalid.")
	}
	columns := make(map[string]int)
	allowed := map[string]bool{"name": true, "profile_url": true, "specialty": true, "phone": true, "emails": true, "website": true, "address": true, "city": true, "state": true, "country": true}
	for i, value := range header {
		name := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(value, "\ufeff")))
		if !allowed[name] {
			return invalid("Unknown column. Use the downloadable CSV template.")
		}
		if _, exists := columns[name]; exists {
			return invalid("The CSV has a duplicate column.")
		}
		columns[name] = i
	}
	for _, required := range []string{"name", "profile_url"} {
		if _, ok := columns[required]; !ok {
			return invalid("Required columns: name and profile_url.")
		}
	}
	var rows []Lead
	seen := make(map[string]bool)
	for rowNumber := 2; ; rowNumber++ {
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return invalid(fmt.Sprintf("CSV row %d is malformed. No records were imported.", rowNumber))
		}
		if rowNumber > 1001 {
			return invalid("Import up to 1,000 rows at a time.")
		}
		for _, value := range record {
			if len(value) > 4096 {
				return invalid(fmt.Sprintf("A field in row %d is too long (maximum 4,096 bytes).", rowNumber))
			}
		}
		get := func(name string) string {
			if i, ok := columns[name]; ok {
				return strings.TrimSpace(record[i])
			}
			return ""
		}
		name := get("name")
		profile, err := url.Parse(get("profile_url"))
		if name == "" || err != nil || profile.Scheme != "https" || profile.User != nil || profile.Port() != "" || (strings.ToLower(profile.Hostname()) != "www.practo.com" && strings.ToLower(profile.Hostname()) != "practo.com") {
			return invalid(fmt.Sprintf("Row %d needs a name and an HTTPS practo.com profile URL.", rowNumber))
		}
		path := strings.TrimRight(profile.Path, "/")
		parts := strings.Split(path, "/")
		validProfile := false
		for i, part := range parts {
			if (part == "doctor" || part == "clinic" || part == "hospital") && i+1 < len(parts) && parts[i+1] != "" {
				validProfile = true
			}
		}
		if !validProfile {
			return invalid(fmt.Sprintf("Row %d needs a doctor, clinic or hospital profile URL, not a search page.", rowNumber))
		}
		profile.Host, profile.Path, profile.RawPath = "www.practo.com", path, ""
		profile.RawQuery, profile.Fragment, profile.ForceQuery = "", "", false
		link := profile.String()
		if seen[link] {
			return invalid(fmt.Sprintf("Row %d repeats a profile URL. Keep one row per profile.", rowNumber))
		}
		seen[link] = true
		website := get("website")
		if website != "" {
			u, err := url.Parse(website)
			if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil {
				return invalid(fmt.Sprintf("Row %d has an invalid website URL.", rowNumber))
			}
		}
		rows = append(rows, Lead{Source: SourcePracto, SourceID: link, Name: name, Category: get("specialty"), Phone: get("phone"), Emails: joinEmails(get("emails")), Website: website, Address: get("address"), City: get("city"), State: get("state"), Country: get("country"), Link: link, Query: "Practo CSV import"})
	}
	if len(rows) == 0 {
		return invalid("Add at least one profile below the CSV header.")
	}
	return rows, nil
}
