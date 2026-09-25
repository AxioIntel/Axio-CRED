package web

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/AxioIntel/Axio-CRED/web/leads"
	"github.com/stretchr/testify/require"
)

func TestPractoUploadAndCrossSiteRejection(t *testing.T) {
	dir := t.TempDir()
	store, err := leads.Open(filepath.Join(dir, "leads.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	srv, err := New(NewService(nil, dir), ":0", WithLeads(store))
	require.NoError(t, err)
	for _, crossSite := range []bool{true, false} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		file, err := writer.CreateFormFile("file", "profiles.csv")
		require.NoError(t, err)
		_, err = file.Write([]byte("name,profile_url\nDr Example,https://practo.com/bangalore/doctor/example\n"))
		require.NoError(t, err)
		require.NoError(t, writer.Close())
		req := httptest.NewRequest(http.MethodPost, "/practo/import", &body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		if crossSite {
			req.Header.Set("Origin", "https://unrelated.example")
			req.Header.Set("Sec-Fetch-Site", "cross-site")
		}
		rec := httptest.NewRecorder()
		srv.srv.Handler.ServeHTTP(rec, req)
		_, total, err := store.Query(context.Background(), &leads.Filter{Source: leads.SourcePracto})
		require.NoError(t, err)
		if crossSite {
			require.Equal(t, http.StatusForbidden, rec.Code)
			require.Zero(t, total)
		} else {
			require.Equal(t, http.StatusOK, rec.Code)
			require.Equal(t, 1, total)
			require.Contains(t, rec.Body.String(), `"imported":1`)
		}
	}
	for _, path := range []string{"/research", "/practo", "/leads", "/spec"} {
		rec := httptest.NewRecorder()
		srv.srv.Handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, http.NoBody))
		require.Equal(t, http.StatusOK, rec.Code)
		require.Contains(t, rec.Body.String(), `aria-label="Main navigation"`)
		require.Equal(t, 1, strings.Count(rec.Body.String(), `aria-current="page"`))
	}
	filtered := httptest.NewRecorder()
	srv.srv.Handler.ServeHTTP(filtered, httptest.NewRequest(http.MethodGet, "/leads?source=practo", http.NoBody))
	require.Contains(t, filtered.Body.String(), `<option value="practo" selected>Practo</option>`, "the initial HTMX request must retain the source filter")
}

func TestPractoRejectsOversizedAndUnavailableUploads(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	rec := httptest.NewRecorder()
	srv.srv.Handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/practo/import", http.NoBody))
	require.Equal(t, http.StatusServiceUnavailable, rec.Code)
	store, err := leads.Open(filepath.Join(t.TempDir(), "leads.db"))
	require.NoError(t, err)
	defer store.Close()
	srv.leads = store
	req := httptest.NewRequest(http.MethodPost, "/practo/import", strings.NewReader(strings.Repeat("x", (2<<20)+1)))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=test")
	rec = httptest.NewRecorder()
	srv.srv.Handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusBadRequest, rec.Code)
}
