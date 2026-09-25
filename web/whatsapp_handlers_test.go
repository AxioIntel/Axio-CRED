//nolint:testpackage // drives the WhatsApp handlers against a fake WhatsApp Cloud API
package web

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/AxioIntel/Axio-CRED/web/leads"
	"github.com/AxioIntel/Axio-CRED/web/whatsapp"
)

type fakeMeta struct {
	mu    sync.Mutex
	sends []map[string]any
	fail  string // a number Meta refuses
}

func (f *fakeMeta) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer tok" {
		w.WriteHeader(http.StatusUnauthorized)

		return
	}

	switch r.URL.Path {
	case "/waba-1/message_templates":
		_, _ = w.Write([]byte(`{"data":[
			{"name":"intro_audit","language":"en_US","category":"MARKETING","components":[
				{"type":"HEADER","text":"Hi"},{"type":"BODY","text":"Hi {{1}}, we read the reviews of businesses in {{2}}."}]},
			{"name":"thanks","language":"en_US","category":"UTILITY","components":[{"type":"BODY","text":"Thank you."}]}]}`))
	case "/phone-1/messages":
		var body map[string]any

		_ = json.NewDecoder(r.Body).Decode(&body)

		if body["to"] == f.fail {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"(#131026) Message undeliverable","code":131026}}`))

			return
		}

		f.mu.Lock()
		f.sends = append(f.sends, body)
		f.mu.Unlock()

		_, _ = w.Write([]byte(`{"messages":[{"id":"wamid.X"}]}`))
	default:
		http.NotFound(w, r)
	}
}

// waTestServer has six leads: Smile (opted in), Keys (opted in, then marked do_not_contact),
// Quiet (never opted in), Gone (opted in, then out), NoPhone (opted in, no number) and
// Straight (opted in, Meta refuses its number).
func waTestServer(t *testing.T) (*Server, *leads.Store, *fakeMeta, map[string]int64) {
	t.Helper()

	dir := t.TempDir()

	store, err := leads.Open(filepath.Join(dir, "leads.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })

	csv := "input_id,link,title,category,phone,place_id,review_count,complete_address\n" +
		`q,https://m/1,Smile,Dentist,+1 512-296-2841,P1,120,"{""city"":""Austin""}"` + "\n" +
		`q,https://m/2,Keys,Locksmith,+1 512-555-0102,P2,80,"{""city"":""Austin""}"` + "\n" +
		`q,https://m/3,Quiet,Dentist,+1 512-555-0103,P3,200,"{""city"":""Austin""}"` + "\n" +
		`q,https://m/4,Gone,Dentist,+1 512-555-0104,P4,300,"{""city"":""Austin""}"` + "\n" +
		`q,https://m/5,NoPhone,Dentist,,P5,50,"{""city"":""Austin""}"` + "\n" +
		`q,https://m/6,Straight,Orthodontist,+1 512-555-0106,P6,50,"{""city"":""Austin""}"` + "\n"
	p := filepath.Join(dir, "job.csv")
	require.NoError(t, os.WriteFile(p, []byte(csv), 0o600))
	_, err = store.IngestCSV(t.Context(), "job-1", p)
	require.NoError(t, err)

	all, _, err := store.Query(t.Context(), &leads.Filter{})
	require.NoError(t, err)

	ids := map[string]int64{}
	for i := range all {
		ids[all[i].Name] = all[i].ID
	}

	ctx := t.Context()
	for _, n := range []string{"Smile", "Keys", "Gone", "NoPhone", "Straight"} {
		require.NoError(t, store.SetWhatsAppOptIn(ctx, ids[n], "replied yes to our email"))
	}

	require.NoError(t, store.SetStatus(ctx, []int64{ids["Keys"]}, "do_not_contact", ""))
	require.NoError(t, store.SetWhatsAppOptOut(ctx, ids["Gone"]))

	fake := &fakeMeta{fail: "15125550106"}
	api := httptest.NewServer(fake)
	t.Cleanup(api.Close)

	client := whatsapp.New("tok", "phone-1", "waba-1")
	client.BaseURL = api.URL

	srv, err := New(NewService(nil, dir), ":0", WithLeads(store), WithWhatsApp(client))
	require.NoError(t, err)

	return srv, store, fake, ids
}

func postWA(t *testing.T, srv *Server, form url.Values) string {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/leads/whatsapp", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	rec := httptest.NewRecorder()
	srv.whatsappSend(rec, req)

	return rec.Body.String()
}

func TestWhatsAppSendsOnlyToOptedInLeads(t *testing.T) {
	srv, store, fake, ids := waTestServer(t)

	form := url.Values{"template": {"intro_audit|en_US"}, "var": {"name", "city"}, "scope": {"filtered"}}
	body := postWA(t, srv, form)

	assert.Contains(t, body, "Sent <strong>1</strong> WhatsApp message (intro_audit)")
	assert.Contains(t, body, "1 no usable number")
	assert.Contains(t, body, "Meta refused 1:")
	assert.Contains(t, body, "Straight")

	require.Len(t, fake.sends, 1)
	sent := fake.sends[0]
	assert.Equal(t, "15122962841", sent["to"])
	assert.Equal(t, "template", sent["type"])

	tpl, _ := json.Marshal(sent["template"])
	assert.JSONEq(t, `{"name":"intro_audit","language":{"code":"en_US"},"components":[{"type":"body","parameters":[`+
		`{"type":"text","text":"Smile"},{"type":"text","text":"Austin"}]}]}`, string(tpl))

	smile, err := store.Get(t.Context(), ids["Smile"])
	require.NoError(t, err)
	assert.False(t, smile.WhatsAppAt.IsZero())
	assert.Equal(t, "intro_audit", smile.WATemplate)

	// Again at once: Smile was messaged within 24 hours, so nothing goes.
	body = postWA(t, srv, form)
	assert.Contains(t, body, "Sent <strong>0</strong>")
	assert.Contains(t, body, "1 messaged in the last 24 hours")
	assert.Len(t, fake.sends, 1)
}

func TestWhatsAppTickedLeadsWithoutOptInAreSkipped(t *testing.T) {
	srv, _, fake, ids := waTestServer(t)

	form := url.Values{"template": {"thanks|en_US"}}
	for _, n := range []string{"Quiet", "Keys", "Gone", "Smile"} {
		form.Add("id", jsonID(ids[n]))
	}

	body := postWA(t, srv, form)

	assert.Contains(t, body, "Sent <strong>1</strong>")
	assert.Contains(t, body, "3 without a WhatsApp opt-in")
	require.Len(t, fake.sends, 1)
	assert.Equal(t, "15122962841", fake.sends[0]["to"])
	assert.NotContains(t, fake.sends[0]["template"], "components", "a template without placeholders sends none")
}

func TestWhatsAppRefusesWhatTheServerDidNotApprove(t *testing.T) {
	srv, _, fake, _ := waTestServer(t)

	cases := []struct {
		form url.Values
		want string
	}{
		{url.Values{"template": {"made_up|en_US"}, "scope": {"filtered"}}, "not approved"},
		{url.Values{"template": {"intro_audit|en_US"}, "var": {"name"}, "scope": {"filtered"}}, "takes 2 value(s)"},
		{url.Values{"template": {"intro_audit|en_US"}, "var": {"name", "emails"}, "scope": {"filtered"}}, "is not a lead field"},
		{url.Values{"template": {"thanks|en_US"}}, "Tick some leads first"},
		{url.Values{"scope": {"filtered"}}, "choose a template first"},
	}

	for _, c := range cases {
		assert.Contains(t, postWA(t, srv, c.form), c.want)
	}

	assert.Empty(t, fake.sends)
}

func TestWhatsAppOptInNeedsASource(t *testing.T) {
	srv, store, _, ids := waTestServer(t)

	post := func(path, id, prompt string) int {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(url.Values{"id": {id}}.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

		if prompt != "" {
			req.Header.Set("HX-Prompt", prompt)
		}

		rec := httptest.NewRecorder()

		if strings.HasSuffix(path, "optin") {
			srv.whatsappOptIn(rec, req)
		} else {
			srv.whatsappOptOut(rec, req)
		}

		return rec.Code
	}

	quiet := jsonID(ids["Quiet"])

	assert.Equal(t, http.StatusUnprocessableEntity, post("/leads/wa-optin", quiet, ""))
	assert.Equal(t, http.StatusUnprocessableEntity, post("/leads/wa-optin", quiet, "ok"))
	assert.Equal(t, http.StatusNoContent, post("/leads/wa-optin", quiet, "called the office, 25 Sep"))

	l, err := store.Get(context.Background(), ids["Quiet"])
	require.NoError(t, err)
	assert.True(t, l.WhatsAppAllowed())
	assert.Equal(t, "called the office, 25 Sep", l.WAOptInSource)

	assert.Equal(t, http.StatusNoContent, post("/leads/wa-optout", quiet, ""))

	l, err = store.Get(context.Background(), ids["Quiet"])
	require.NoError(t, err)
	assert.False(t, l.WhatsAppAllowed())
	assert.False(t, l.WAOptOutAt.IsZero())
}

func TestWhatsAppOffWithoutConfig(t *testing.T) {
	assert.Nil(t, whatsapp.New("", "phone", "waba"))

	srv, _, _ := metricsServer(t)
	rec := httptest.NewRecorder()
	srv.whatsappTemplates(rec, httptest.NewRequest(http.MethodGet, "/whatsapp/templates", http.NoBody))
	assert.Contains(t, rec.Body.String(), "not configured")
}

func jsonID(id int64) string {
	b, _ := json.Marshal(id)

	return string(b)
}
