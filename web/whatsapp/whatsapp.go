// Package whatsapp sends approved WhatsApp message templates through Meta's WhatsApp Cloud API
// (https://developers.facebook.com/docs/whatsapp/cloud-api). Meta allows a business to message
// someone first only with a template it has approved, and only someone who has agreed to hear
// from the business on WhatsApp; the dashboard enforces the second part against each lead's
// recorded opt-in before anything is sent (see web/whatsapp_handlers.go).
package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// DefaultBaseURL is Meta's Graph API, version included.
const DefaultBaseURL = "https://graph.facebook.com/v21.0"

// Client sends from one WhatsApp Business phone number.
type Client struct {
	BaseURL       string
	Token         string // a system user's permanent access token
	PhoneNumberID string // the sending number's id, not the number itself
	AccountID     string // the WhatsApp Business Account (WABA) id, for its templates
	HTTP          *http.Client
}

// New returns a client, or nil when the server is not configured for WhatsApp.
func New(token, phoneNumberID, accountID string) *Client {
	if token == "" || phoneNumberID == "" || accountID == "" {
		return nil
	}

	return &Client{
		BaseURL: DefaultBaseURL, Token: token, PhoneNumberID: phoneNumberID, AccountID: accountID,
		HTTP: &http.Client{Timeout: 30 * time.Second},
	}
}

// Template is an approved message template.
type Template struct {
	Name     string
	Language string
	Category string
	Body     string
	Params   int // {{1}}..{{n}} placeholders in the body
}

// Key identifies a template by name and language, as the dashboard's form sends it.
func (t *Template) Key() string { return t.Name + "|" + t.Language }

// Error is Meta's refusal, with its own message.
type Error struct {
	Status  int
	Code    int
	Message string
}

func (e *Error) Error() string {
	return fmt.Sprintf("whatsapp: %d (code %d): %s", e.Status, e.Code, e.Message)
}

var placeholder = regexp.MustCompile(`\{\{\s*(\d+)\s*\}\}`)

// Templates lists the account's approved templates.
func (c *Client) Templates(ctx context.Context) ([]Template, error) {
	q := url.Values{"status": {"APPROVED"}, "fields": {"name,language,category,components"}, "limit": {"200"}}

	var out struct {
		Data []struct {
			Name       string `json:"name"`
			Language   string `json:"language"`
			Category   string `json:"category"`
			Components []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"components"`
		} `json:"data"`
	}

	if err := c.do(ctx, http.MethodGet, "/"+url.PathEscape(c.AccountID)+"/message_templates?"+q.Encode(), nil, &out); err != nil {
		return nil, err
	}

	tpls := make([]Template, 0, len(out.Data))

	for _, d := range out.Data {
		t := Template{Name: d.Name, Language: d.Language, Category: d.Category}

		for _, comp := range d.Components {
			if strings.EqualFold(comp.Type, "BODY") {
				t.Body = comp.Text

				for _, m := range placeholder.FindAllStringSubmatch(comp.Text, -1) {
					var n int
					if _, err := fmt.Sscan(m[1], &n); err == nil && n > t.Params {
						t.Params = n
					}
				}
			}
		}

		tpls = append(tpls, t)
	}

	return tpls, nil
}

// Send sends template t to the number to (E.164, with or without "+"), filling the body's
// placeholders with params in order. It returns Meta's message id.
func (c *Client) Send(ctx context.Context, to string, t *Template, params []string) (string, error) {
	if len(params) != t.Params {
		return "", fmt.Errorf("template %s takes %d values, got %d", t.Name, t.Params, len(params))
	}

	tpl := map[string]any{"name": t.Name, "language": map[string]string{"code": t.Language}}

	if len(params) > 0 {
		ps := make([]map[string]string, len(params))
		for i, p := range params {
			ps[i] = map[string]string{"type": "text", "text": p}
		}

		tpl["components"] = []map[string]any{{"type": "body", "parameters": ps}}
	}

	body := map[string]any{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                strings.TrimPrefix(to, "+"),
		"type":              "template",
		"template":          tpl,
	}

	var out struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}

	if err := c.do(ctx, http.MethodPost, "/"+url.PathEscape(c.PhoneNumberID)+"/messages", body, &out); err != nil {
		return "", err
	}

	if len(out.Messages) == 0 {
		return "", errors.New("whatsapp: accepted, but no message id came back")
	}

	return out.Messages[0].ID, nil
}

func (c *Client) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader = http.NoBody

	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}

		body = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, body)
	if err != nil {
		return err
	}

	req.Header.Set("Authorization", "Bearer "+c.Token)

	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}

	if resp.StatusCode/100 != 2 {
		var e struct {
			Error struct {
				Message string `json:"message"`
				Code    int    `json:"code"`
				Details struct {
					Details string `json:"details"`
				} `json:"error_data"`
			} `json:"error"`
		}

		_ = json.Unmarshal(raw, &e)

		msg := e.Error.Message
		if d := e.Error.Details.Details; d != "" {
			msg += ": " + d
		}

		if msg == "" {
			msg = http.StatusText(resp.StatusCode)
		}

		return &Error{Status: resp.StatusCode, Code: e.Error.Code, Message: msg}
	}

	return json.Unmarshal(raw, out)
}
