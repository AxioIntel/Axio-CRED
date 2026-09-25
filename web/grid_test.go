//nolint:testpackage // tests the map grid's unexported geocoder and form handling
package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeNominatim answers like OpenStreetMap's geocoder: Austin's outline, nothing for "Nowhere".
func fakeNominatim(t *testing.T, calls *atomic.Int32) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		assert.Contains(t, r.Header.Get("User-Agent"), "AxioCRED")

		if strings.Contains(r.URL.Query().Get("q"), "Nowhere") {
			_, _ = w.Write([]byte(`[]`))

			return
		}

		// A landmark is only found without the settlement filter, and is a point.
		if strings.Contains(r.URL.Query().Get("q"), "Bus stop") {
			if r.URL.Query().Get("featureType") == "settlement" {
				_, _ = w.Write([]byte(`[]`))
			} else {
				_, _ = w.Write([]byte(`[{"lat":"29.7673","lon":"-95.3677","display_name":"Bus stop",` +
					`"boundingbox":["29.7672","29.7674","-95.3678","-95.3676"]}]`))
			}

			return
		}

		assert.Equal(t, "settlement", r.URL.Query().Get("featureType"))

		_, _ = w.Write([]byte(`[{"lat":"30.2711","lon":"-97.7437","display_name":"Austin, Travis County, Texas, United States",` +
			`"boundingbox":["30.0987","30.5169","-97.9384","-97.5614"]}]`))
	}))
	t.Cleanup(srv.Close)

	return srv
}

func gridServer(t *testing.T) (*Server, *fakeRepo, *atomic.Int32) {
	t.Helper()

	srv, repo, _ := metricsServer(t)
	calls := &atomic.Int32{}
	srv.geocode.endpoint = fakeNominatim(t, calls).URL

	return srv, repo, calls
}

func TestGridPreviewCountsSquaresAndCaches(t *testing.T) {
	srv, _, calls := gridServer(t)

	q := url.Values{"keywords": {"dentist\northodontist"}, "grid_area": {"Austin TX"}, "grid_cell": {"2"}, "grid_radius": {"0"}}

	for range 2 {
		rec := httptest.NewRecorder()
		srv.gridPreview(rec, httptest.NewRequest(http.MethodGet, "/grid/preview?"+q.Encode(), http.NoBody))

		body := rec.Body.String()
		// ~46.5 km x ~36.2 km in 2 km squares: 23 rows x 18 columns.
		assert.Contains(t, body, "<b>414</b> squares of 2 km over Austin, Travis County")
		assert.Contains(t, body, "2 search(es) → <b>828</b> map searches")
	}

	assert.Equal(t, int32(1), calls.Load(), "the second preview is answered from the cache")

	q.Set("grid_area", "Nowhere")

	rec := httptest.NewRecorder()
	srv.gridPreview(rec, httptest.NewRequest(http.MethodGet, "/grid/preview?"+q.Encode(), http.NoBody))
	assert.Contains(t, rec.Body.String(), "no such place on the map")
}

func TestGridRadiusAndExactBox(t *testing.T) {
	srv, _, calls := gridServer(t)

	spec, _, err := srv.resolveGrid(t.Context(), gridRequest{Area: "Austin TX", RadiusKm: 5, CellKm: 2})
	require.NoError(t, err)
	assert.Equal(t, 25, spec.Cells, "a 10 km square in 2 km squares")

	spec, label, err := srv.resolveGrid(t.Context(), gridRequest{BBox: "30.10,-97.95,30.12,-97.93", CellKm: 1})
	require.NoError(t, err)
	assert.Equal(t, "30.10,-97.95,30.12,-97.93", label)
	assert.Equal(t, 4, spec.Cells)
	assert.Equal(t, int32(1), calls.Load(), "an exact box needs no lookup")

	_, _, err = srv.resolveGrid(t.Context(), gridRequest{BBox: "30.12,-97.95,30.10,-97.93", CellKm: 1})
	require.Error(t, err)

	_, _, err = srv.resolveGrid(t.Context(), gridRequest{Area: "Bus stop", CellKm: 2})
	require.ErrorContains(t, err, "cover a radius")

	spec, _, err = srv.resolveGrid(t.Context(), gridRequest{Area: "Bus stop", RadiusKm: 5, CellKm: 2})
	require.NoError(t, err)
	assert.Equal(t, 25, spec.Cells)
}

func postScrape(t *testing.T, srv *Server, form url.Values) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/scrape", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	rec := httptest.NewRecorder()
	srv.scrape(rec, req)

	return rec
}

func scrapeForm() url.Values {
	return url.Values{
		"keywords": {"dentist"}, "maxtime": {"6h"}, "lang": {"en"}, "zoom": {"15"}, "radius": {"10000"},
		"depth": {"1"}, "latitude": {"0"}, "longitude": {"0"},
		"grid": {"on"}, "grid_area": {"Austin TX"}, "grid_cell": {"2"}, "grid_radius": {"0"},
	}
}

func TestScrapeCreatesAGridJob(t *testing.T) {
	srv, repo, _ := gridServer(t)

	rec := postScrape(t, srv, scrapeForm())
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	jobs, _ := repo.Select(t.Context(), SelectParams{})
	require.Len(t, jobs, 1)

	j := jobs[0]
	require.NotNil(t, j.Data.Grid)
	assert.Equal(t, 414, j.Data.Grid.Cells)
	assert.InDelta(t, 2.0, j.Data.Grid.CellKm, 0)
	assert.Equal(t, 15, j.Data.Zoom, "zoom follows the square size")
	assert.Equal(t, []string{"dentist"}, j.Data.Keywords, "the squares place the search; no 'in <city>'")
	assert.Equal(t, "dentist · grid Austin TX (414 squares)", j.Name)
	assert.Equal(t, 414*resultsPerCell, expectedRows(&j))
}

func TestScrapeRefusesOversizedOrMixedGrids(t *testing.T) {
	srv, repo, _ := gridServer(t)

	form := scrapeForm()
	form.Set("grid_cell", "1") // 1,800+ squares
	form.Set("keywords", "dentist\northodontist")
	rec := postScrape(t, srv, form)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Contains(t, rec.Body.String(), "over the 3000 limit")

	form = scrapeForm()
	form.Set("locations", "Austin TX")
	rec = postScrape(t, srv, form)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)

	form = scrapeForm()
	form.Set("grid_area", "")
	rec = postScrape(t, srv, form)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)

	jobs, _ := repo.Select(t.Context(), SelectParams{})
	assert.Empty(t, jobs)
}
