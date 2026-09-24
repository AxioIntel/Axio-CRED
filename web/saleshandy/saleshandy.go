// Package saleshandy sends leads into a Saleshandy sequence through its open API
// (https://developer.saleshandy.com, spec at /openapi.json). In Saleshandy a sequence is the
// campaign: prospects are added to one of its steps, and Saleshandy does the sending, the
// follow-ups, stop-on-reply and unsubscribes.
package saleshandy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// DefaultBaseURL is Saleshandy's open API.
const DefaultBaseURL = "https://open-api.saleshandy.com"

// Client talks to Saleshandy with one account's API key.
type Client struct {
	BaseURL string
	APIKey  string
	HTTP    *http.Client
}

// New returns a client for apiKey, or nil when no key is configured.
func New(apiKey string) *Client {
	if apiKey == "" {
		return nil
	}

	return &Client{BaseURL: DefaultBaseURL, APIKey: apiKey, HTTP: &http.Client{Timeout: 60 * time.Second}}
}

// Step is one email step of a sequence; prospects are added to a step.
type Step struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Sequence is a Saleshandy campaign.
type Sequence struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Active bool   `json:"active"`
	Steps  []Step `json:"steps"`
}

// Field is a prospect field (system or custom), addressed by its label when importing.
type Field struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// Error is an API refusal, with Saleshandy's own message.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string {
	return fmt.Sprintf("saleshandy: HTTP %d: %s", e.Status, e.Message)
}

func (c *Client) do(ctx context.Context, method, path string, query url.Values, body, out any) error {
	u := c.BaseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}

	var rd io.Reader = http.NoBody

	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}

		rd = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, u, rd)
	if err != nil {
		return err
	}

	req.Header.Set("x-api-key", c.APIKey)
	req.Header.Set("Accept", "application/json")

	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}

	if resp.StatusCode >= 300 {
		var e struct {
			Message string `json:"message"`
		}

		_ = json.Unmarshal(raw, &e)

		if e.Message == "" {
			e.Message = http.StatusText(resp.StatusCode)
		}

		return &Error{Status: resp.StatusCode, Message: e.Message}
	}

	if out == nil {
		return nil
	}

	return json.Unmarshal(raw, out)
}

// Sequences lists the account's sequences with their steps.
func (c *Client) Sequences(ctx context.Context) ([]Sequence, error) {
	var out struct {
		Payload []Sequence `json:"payload"`
	}

	q := url.Values{"pageSize": {"1000"}, "sortBy": {"sequence.title"}, "sort": {"ASC"}}
	if err := c.do(ctx, http.MethodGet, "/v1/sequences", q, nil, &out); err != nil {
		return nil, err
	}

	return out.Payload, nil
}

// Fields lists every prospect field, system and custom.
func (c *Client) Fields(ctx context.Context) ([]Field, error) {
	var out struct {
		Payload []Field `json:"payload"`
	}

	if err := c.do(ctx, http.MethodGet, "/v1/fields", url.Values{"systemFields": {"true"}}, nil, &out); err != nil {
		return nil, err
	}

	return out.Payload, nil
}

// Prospect is one prospect as field label -> value.
type Prospect map[string]string

// ImportRequest adds prospects to a sequence step.
type ImportRequest struct {
	Prospects []Prospect
	StepID    string
	Verify    bool     // have Saleshandy verify each address before sending (keeps bounces down)
	Tags      []string // created in Saleshandy if missing
}

// ErrNothingToImport is returned for an empty prospect list.
var ErrNothingToImport = errors.New("saleshandy: no prospects to import")

// Import starts an import of prospects into a sequence step and returns its request id.
// Saleshandy imports in the background; ImportStatus says when it is done. A prospect already in
// the account keeps its fields and gains only the ones it lacked ("addMissingFields").
func (c *Client) Import(ctx context.Context, r *ImportRequest) (string, error) {
	if len(r.Prospects) == 0 {
		return "", ErrNothingToImport
	}

	body := map[string]any{
		"prospectList":    r.Prospects,
		"stepId":          r.StepID,
		"verifyProspects": r.Verify,
		"conflictAction":  "addMissingFields",
	}

	if len(r.Tags) > 0 {
		body["tags"] = r.Tags
	}

	var out struct {
		Payload struct {
			RequestID string `json:"requestId"`
		} `json:"payload"`
	}

	if err := c.do(ctx, http.MethodPost, "/v1/sequences/prospects/import-with-field-name", nil, body, &out); err != nil {
		return "", err
	}

	return out.Payload.RequestID, nil
}

// ImportStatus is where a started import has got to.
type ImportStatus struct {
	Completed bool   `json:"isCompleted"`
	ReportURL string `json:"reportURL"`
	FailedURL string `json:"failedProspectsURL"`
}

// ImportStatus reads an import's progress by its request id.
func (c *Client) ImportStatus(ctx context.Context, requestID string) (ImportStatus, error) {
	var out struct {
		Payload ImportStatus `json:"payload"`
	}

	err := c.do(ctx, http.MethodGet, "/v1/prospects/import-status/"+url.PathEscape(requestID), nil, nil, &out)

	return out.Payload, err
}
