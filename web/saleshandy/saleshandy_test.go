package saleshandy_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/AxioIntel/Axio-CRED/web/saleshandy"
)

func TestClientSendsTheKeyAndReadsSequencesAndFields(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "k-123", r.Header.Get("x-api-key"))

		switch r.URL.Path {
		case "/v1/sequences":
			assert.Equal(t, "1000", r.URL.Query().Get("pageSize"))

			_, _ = w.Write([]byte(`{"payload":[{"id":"S1","title":"Dentists","active":true,"steps":[{"id":"st1","name":"Step 1"}]}]}`))
		case "/v1/fields":
			assert.Equal(t, "true", r.URL.Query().Get("systemFields"))

			_, _ = w.Write([]byte(`{"payload":[{"id":"f1","label":"Email"},{"id":"f2","label":"Company"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := saleshandy.New("k-123")
	c.BaseURL = srv.URL

	seqs, err := c.Sequences(context.Background())
	require.NoError(t, err)
	assert.Equal(t, []saleshandy.Sequence{{ID: "S1", Title: "Dentists", Active: true, Steps: []saleshandy.Step{{ID: "st1", Name: "Step 1"}}}}, seqs)

	fields, err := c.Fields(context.Background())
	require.NoError(t, err)
	assert.Len(t, fields, 2)
}

func TestImportPostsProspectsByFieldNameAndNeverOverwrites(t *testing.T) {
	var got map[string]any

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/v1/sequences/prospects/import-with-field-name", r.URL.Path)
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&got))

		_, _ = w.Write([]byte(`{"message":"started","payload":{"requestId":"req-9"}}`))
	}))
	defer srv.Close()

	c := saleshandy.New("k")
	c.BaseURL = srv.URL

	id, err := c.Import(context.Background(), &saleshandy.ImportRequest{
		Prospects: []saleshandy.Prospect{{"Email": "info@smile.com", "Company": "Smile Dental"}},
		StepID:    "st1", Verify: true, Tags: []string{"AxioCRED"},
	})
	require.NoError(t, err)
	assert.Equal(t, "req-9", id)
	assert.Equal(t, "st1", got["stepId"])
	assert.Equal(t, true, got["verifyProspects"])
	assert.Equal(t, "addMissingFields", got["conflictAction"], "an existing prospect's data is never overwritten")
	assert.Equal(t, []any{"AxioCRED"}, got["tags"])

	_, err = c.Import(context.Background(), &saleshandy.ImportRequest{StepID: "st1"})
	assert.ErrorIs(t, err, saleshandy.ErrNothingToImport)
}

func TestAnAPIRefusalCarriesSaleshandysMessage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":true,"message":"Invalid API key"}`))
	}))
	defer srv.Close()

	c := saleshandy.New("bad")
	c.BaseURL = srv.URL

	_, err := c.Sequences(context.Background())

	var apiErr *saleshandy.Error

	require.ErrorAs(t, err, &apiErr)
	assert.Equal(t, 401, apiErr.Status)
	assert.Equal(t, "Invalid API key", apiErr.Message)
}

func TestNoKeyMeansNoClient(t *testing.T) {
	assert.Nil(t, saleshandy.New(""))
}

func TestConfigAllowsOnlyListedSequencesAndRoutesByCategory(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "saleshandy.json")
	require.NoError(t, os.WriteFile(path, []byte(`{
		"sequences": ["Dentists", "Orthodontists", "S-LABS"],
		"routes": {"dent": "Dentists", "orthodont": "Orthodontists", "dental lab": "Dental Labs"}
	}`), 0o600))

	cfg, err := saleshandy.LoadConfig(path)
	require.NoError(t, err)

	seqs := []saleshandy.Sequence{
		{ID: "S-D", Title: "Dentists", Steps: []saleshandy.Step{{ID: "d1"}, {ID: "d2"}}},
		{ID: "S-O", Title: "Orthodontists", Steps: []saleshandy.Step{{ID: "o1"}}},
		{ID: "S-LABS", Title: "Dental Labs", Steps: []saleshandy.Step{{ID: "l1"}}},
		{ID: "S-X", Title: "Someone else's campaign", Steps: []saleshandy.Step{{ID: "x1"}}},
	}

	assert.True(t, cfg.Allowed(&seqs[0]))
	assert.True(t, cfg.Allowed(&seqs[2]), "allowed by id")
	assert.False(t, cfg.Allowed(&seqs[3]))

	seq, ok := cfg.FindStep(seqs, "d2")
	require.True(t, ok)
	assert.Equal(t, "Dentists", seq.Title)

	_, ok = cfg.FindStep(seqs, "x1")
	assert.False(t, ok, "a step of a sequence outside the list is refused")

	assert.Equal(t, "Orthodontists", cfg.Route("Orthodontist"), "the longest matching key wins")
	assert.Equal(t, "Dentists", cfg.Route("Cosmetic dentist"))
	assert.Equal(t, "Dental Labs", cfg.Route("Dental laboratory"))
	assert.Empty(t, cfg.Route("Locksmith"))

	_, step, ok := cfg.FirstStep(seqs, "Dentists")
	require.True(t, ok)
	assert.Equal(t, "d1", step)

	_, _, ok = cfg.FirstStep(seqs, "Someone else's campaign")
	assert.False(t, ok)
}

func TestAMissingConfigAllowsNothing(t *testing.T) {
	cfg, err := saleshandy.LoadConfig(filepath.Join(t.TempDir(), "absent.json"))
	require.NoError(t, err)
	assert.False(t, cfg.Allowed(&saleshandy.Sequence{Title: "Anything"}))
}
