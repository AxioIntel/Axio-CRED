//nolint:testpackage // drives the Saleshandy handlers against a fake Saleshandy
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
	"github.com/AxioIntel/Axio-CRED/web/saleshandy"
)

type fakeSaleshandy struct {
	mu      sync.Mutex
	imports []map[string]any
}

func (f *fakeSaleshandy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/v1/sequences":
		_, _ = w.Write([]byte(`{"payload":[
			{"id":"S-D","title":"Dentists","active":true,"steps":[{"id":"d1","name":"Intro"},{"id":"d2","name":"Follow-up"}]},
			{"id":"S-O","title":"Orthodontists","active":true,"steps":[{"id":"o1","name":"Intro"}]},
			{"id":"S-X","title":"Not ours","active":true,"steps":[{"id":"x1","name":"Intro"}]}]}`))
	case "/v1/fields":
		_, _ = w.Write([]byte(`{"payload":[{"id":"1","label":"Email"},{"id":"2","label":"Company"},{"id":"3","label":"Phone Number"},{"id":"4","label":"City"}]}`))
	case "/v1/sequences/prospects/import-with-field-name":
		var body map[string]any

		_ = json.NewDecoder(r.Body).Decode(&body)

		f.mu.Lock()
		f.imports = append(f.imports, body)
		n := len(f.imports)
		f.mu.Unlock()

		_, _ = w.Write([]byte(`{"payload":{"requestId":"req-` + string(rune('0'+n)) + `"}}`))
	default:
		http.NotFound(w, r)
	}
}

func shTestServer(t *testing.T) (*Server, *leads.Store, *fakeSaleshandy) {
	t.Helper()

	dir := t.TempDir()

	store, err := leads.Open(filepath.Join(dir, "leads.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })

	csv := "input_id,link,title,category,phone,place_id,complete_address,emails\n" +
		`q,https://m/1,Smile Dental,Dentist,+1 512-296-2841,P1,"{""city"":""Austin""}",info@smile.com` + "\n" +
		`q,https://m/2,Straight Smiles,Orthodontist,,P2,"{""city"":""Austin""}",hello@straight.com` + "\n" +
		`q,https://m/3,No Mail Dental,Dentist,,P3,"{""city"":""Austin""}",` + "\n" +
		`q,https://m/4,Keys R Us,Locksmith,,P4,"{""city"":""Austin""}",keys@keys.com` + "\n"
	p := filepath.Join(dir, "job.csv")
	require.NoError(t, os.WriteFile(p, []byte(csv), 0o600))
	_, err = store.IngestCSV(context.Background(), "job-1", p)
	require.NoError(t, err)

	fake := &fakeSaleshandy{}
	api := httptest.NewServer(fake)
	t.Cleanup(api.Close)

	client := saleshandy.New("key")
	client.BaseURL = api.URL

	cfg := &saleshandy.Config{
		Sequences: []string{"Dentists", "Orthodontists"},
		Routes:    map[string]string{"dent": "Dentists", "orthodont": "Orthodontists"},
	}

	srv, err := New(NewService(nil, dir), ":0", WithLeads(store), WithSaleshandy(client, cfg))
	require.NoError(t, err)

	return srv, store, fake
}

func post(srv *Server, form url.Values) string {
	req := httptest.NewRequest(http.MethodPost, "/leads/saleshandy", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	rec := httptest.NewRecorder()
	srv.saleshandySend(rec, req)

	return rec.Body.String()
}

func TestStepsListOnlyTheAllowedCampaigns(t *testing.T) {
	srv, _, _ := shTestServer(t)

	rec := httptest.NewRecorder()
	srv.saleshandySteps(rec, httptest.NewRequest(http.MethodGet, "/saleshandy/steps", http.NoBody))

	body := rec.Body.String()
	assert.Contains(t, body, `label="Dentists"`)
	assert.Contains(t, body, `label="Orthodontists"`)
	assert.Contains(t, body, `value="by-category"`)
	assert.NotContains(t, body, "Not ours")
}

func TestAStepOutsideTheAllowedCampaignsIsRefused(t *testing.T) {
	srv, _, fake := shTestServer(t)

	body := post(srv, url.Values{"step_id": {"x1"}, "scope": {"filtered"}})

	assert.Contains(t, body, "not in one of the allowed campaigns")
	assert.Empty(t, fake.imports)
}

func TestByCategoryRoutesEachLeadToItsCampaignAndSkipsTheRest(t *testing.T) {
	srv, store, fake := shTestServer(t)

	body := post(srv, url.Values{"step_id": {stepByCategory}, "scope": {"filtered"}, "verify": {"on"}, "tag": {"austin-test"}})

	assert.Contains(t, body, "Sent <strong>2</strong> leads")
	assert.Contains(t, body, "Dentists: 1")
	assert.Contains(t, body, "Orthodontists: 1")
	assert.Contains(t, body, "1 without an email")
	assert.Contains(t, body, "1 with no campaign for their category")
	require.Len(t, fake.imports, 2)

	steps := map[string]any{}

	for _, imp := range fake.imports {
		stepID, _ := imp["stepId"].(string)
		steps[stepID] = imp["prospectList"]
		assert.Equal(t, true, imp["verifyProspects"])
		assert.Equal(t, []any{"AxioCRED", "austin-test"}, imp["tags"])
	}

	assert.Equal(t, []any{map[string]any{"Email": "info@smile.com", "Company": "Smile Dental", "Phone Number": "+1 512-296-2841", "City": "Austin"}}, steps["d1"],
		"only fields the account has are sent; the first step of the routed campaign")
	assert.Contains(t, steps, "o1")

	sent, _, err := store.Query(context.Background(), &leads.Filter{Saleshandy: "sent"})
	require.NoError(t, err)
	assert.Len(t, sent, 2)

	// Sending again skips them unless resend is ticked.
	body = post(srv, url.Values{"step_id": {stepByCategory}, "scope": {"filtered"}})
	assert.Contains(t, body, "Nothing to send")
	assert.Contains(t, body, "2 already sent")
}

func TestTickedLeadsGoToTheChosenStepAndDoNotContactNeverGoes(t *testing.T) {
	srv, store, fake := shTestServer(t)

	all, _, err := store.Query(context.Background(), &leads.Filter{HasEmail: true, Sort: "name"})
	require.NoError(t, err)

	var smile, straight int64

	for i := range all {
		switch all[i].Name {
		case "Smile Dental":
			smile = all[i].ID
		case "Straight Smiles":
			straight = all[i].ID
		}
	}

	require.NoError(t, store.SetStatus(context.Background(), []int64{straight}, "do_not_contact", ""))

	body := post(srv, url.Values{
		"step_id": {"d2"},
		"id":      {itoa(smile), itoa(straight)},
	})

	assert.Contains(t, body, "Sent <strong>1</strong> lead")
	assert.Contains(t, body, "1 marked do_not_contact")
	require.Len(t, fake.imports, 1)
	assert.Equal(t, "d2", fake.imports[0]["stepId"])
}

func itoa(n int64) string {
	b, _ := json.Marshal(n)

	return string(b)
}
