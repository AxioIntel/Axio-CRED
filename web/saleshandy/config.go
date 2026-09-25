package saleshandy

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
)

// Config says which Saleshandy sequences the dashboard may send into, and which sequence each
// kind of lead belongs in. It lives on the server (a JSON file), never in the page, so no click can
// send into a sequence outside the list.
//
//	{
//	  "sequences":   ["Dentists", "Orthodontists", "Dental Labs"],
//	  "routes":      {"orthodont": "Orthodontists", "dental lab": "Dental Labs", "dent": "Dentists"},
//	  "min_reviews": 51
//	}
//
// sequences are titles (or ids) exactly as in Saleshandy. A route sends a lead whose category
// contains the key (case-insensitive) into that sequence's first step; the longest matching key
// wins, so "orthodont" beats "dent" for an orthodontist.
//
// min_reviews is the fewest Google reviews a lead's listing must have to be sent at all; when the
// file does not set it, DefaultMinReviews applies (the owner's rule of 25 Sep 2026: more than 50).
type Config struct {
	Sequences  []string          `json:"sequences"`
	Routes     map[string]string `json:"routes"`
	MinReviews int               `json:"min_reviews"`
}

// DefaultMinReviews is the review floor when the config sets none: only businesses with more than
// 50 Google reviews go to Saleshandy.
const DefaultMinReviews = 51

// ReviewFloor is the fewest reviews a lead needs to be sent.
func (c *Config) ReviewFloor() int {
	if c == nil || c.MinReviews <= 0 {
		return DefaultMinReviews
	}

	return c.MinReviews
}

// ErrNoConfig means no sequences are allowed yet: nothing can be sent until the file lists them.
var ErrNoConfig = errors.New("no Saleshandy sequences are allowed yet: list them in the server's saleshandy.json")

// LoadConfig reads the config file. A missing file is an empty config (nothing allowed).
func LoadConfig(path string) (*Config, error) {
	c := &Config{}

	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return c, nil
	}

	if err != nil {
		return nil, err
	}

	if err := json.Unmarshal(b, c); err != nil {
		return nil, err
	}

	return c, nil
}

// Allowed says whether a sequence (by title or id) may be sent into.
func (c *Config) Allowed(seq *Sequence) bool {
	if c == nil {
		return false
	}

	for _, s := range c.Sequences {
		s = strings.TrimSpace(s)
		if s != "" && (strings.EqualFold(s, seq.Title) || s == seq.ID) {
			return true
		}
	}

	return false
}

// Route is the sequence title a lead of this category belongs in, or "" when no route matches.
func (c *Config) Route(category string) string {
	if c == nil {
		return ""
	}

	cat := strings.ToLower(category)
	best, bestLen := "", 0

	for key, seq := range c.Routes {
		k := strings.ToLower(strings.TrimSpace(key))
		if k != "" && strings.Contains(cat, k) && len(k) > bestLen {
			best, bestLen = seq, len(k)
		}
	}

	return best
}

// FindStep finds a step among allowed sequences, with the sequence it belongs to.
func (c *Config) FindStep(seqs []Sequence, stepID string) (*Sequence, bool) {
	for i := range seqs {
		if !c.Allowed(&seqs[i]) {
			continue
		}

		for _, st := range seqs[i].Steps {
			if st.ID == stepID {
				return &seqs[i], true
			}
		}
	}

	return nil, false
}

// FirstStep is the first step of the allowed sequence with this title (or id).
func (c *Config) FirstStep(seqs []Sequence, title string) (seq *Sequence, stepID string, ok bool) {
	for i := range seqs {
		if (strings.EqualFold(seqs[i].Title, title) || seqs[i].ID == title) && c.Allowed(&seqs[i]) && len(seqs[i].Steps) > 0 {
			return &seqs[i], seqs[i].Steps[0].ID, true
		}
	}

	return nil, "", false
}
