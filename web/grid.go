package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/AxioIntel/Axio-CRED/grid"
)

// The map grid: Google Maps shows at most ~120 results for one search, so a city searched once
// gives ~120 leads. A grid job splits the city into small squares and runs every search once per
// square, centred on it and zoomed in; one listing found in several squares is kept once. That is
// how a single city yields 2,000+ results.
//
// The city's outline comes from OpenStreetMap's geocoder (Nominatim), not from Google: one
// request when the form is filled in, cached, and never during the scrape.

// GridSpec is a job's map grid.
type GridSpec struct {
	Area   string  `json:"area"`    // what the operator typed, e.g. "Austin TX"
	BBox   string  `json:"bbox"`    // minLat,minLon,maxLat,maxLon
	CellKm float64 `json:"cell_km"` // side of one square
	Cells  int     `json:"cells"`   // squares in the grid
}

const (
	// maxGridSearches caps searches x squares in one job: at ~15 s a search and 3 at a time,
	// 3,000 searches is about 4 hours before any listing is opened.
	maxGridSearches = 3000
	// resultsPerCell is a rough guide to new listings a square adds once neighbours overlap.
	resultsPerCell = 8
)

// gridCellSizes are the square sizes the form offers, in km.
var gridCellSizes = map[string]float64{"1": 1, "2": 2, "3": 3, "5": 5}

// zoomForCell is the Google Maps zoom whose view roughly covers one square.
func zoomForCell(km float64) int {
	switch {
	case km <= 1:
		return 16
	case km <= 2:
		return 15
	case km <= 3:
		return 14
	default:
		return 13
	}
}

// bboxAround is the square of side 2*radiusKm centred on lat,lon.
func bboxAround(lat, lon, radiusKm float64) grid.BoundingBox {
	dLat := radiusKm / 111.32
	dLon := radiusKm / (111.32 * math.Max(math.Cos(lat*math.Pi/180), 1e-6))

	return grid.BoundingBox{MinLat: lat - dLat, MinLon: lon - dLon, MaxLat: lat + dLat, MaxLon: lon + dLon}
}

func formatBBox(b grid.BoundingBox) string {
	return fmt.Sprintf("%.5f,%.5f,%.5f,%.5f", b.MinLat, b.MinLon, b.MaxLat, b.MaxLon)
}

// place is a geocoded area.
type place struct {
	Name     string
	Lat, Lon float64
	BBox     grid.BoundingBox
}

// geocoder looks areas up on OpenStreetMap's Nominatim. Its usage policy asks for an identifying
// User-Agent and at most one request a second; answers are cached for the life of the process.
type geocoder struct {
	endpoint string
	client   *http.Client

	mu    sync.Mutex
	last  time.Time
	cache map[string]place
}

func newGeocoder() *geocoder {
	return &geocoder{
		endpoint: "https://nominatim.openstreetmap.org/search",
		client:   &http.Client{Timeout: 15 * time.Second},
		cache:    map[string]place{},
	}
}

var errAreaNotFound = errors.New("no such place on the map")

func (g *geocoder) lookup(ctx context.Context, area string) (place, error) {
	key := strings.ToLower(strings.Join(strings.Fields(area), " "))

	g.mu.Lock()
	defer g.mu.Unlock()

	if p, ok := g.cache[key]; ok {
		return p, nil
	}

	// A city or town first: "Houston TX" alone can match a bus stop of that name.
	p, err := g.search(ctx, area, "settlement")
	if errors.Is(err, errAreaNotFound) {
		p, err = g.search(ctx, area, "")
	}

	if err != nil {
		return place{}, err
	}

	g.cache[key] = p

	return p, nil
}

// search asks Nominatim once (at most one request a second); featureType narrows the kind of
// place. The caller holds g.mu.
func (g *geocoder) search(ctx context.Context, area, featureType string) (place, error) {
	if wait := time.Second - time.Since(g.last); wait > 0 {
		time.Sleep(wait)
	}

	g.last = time.Now()

	q := url.Values{"q": {area}, "format": {"json"}, "limit": {"1"}}
	if featureType != "" {
		q.Set("featureType", featureType)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, g.endpoint+"?"+q.Encode(), http.NoBody)
	if err != nil {
		return place{}, err
	}

	req.Header.Set("User-Agent", "AxioCRED-leads/1.0 (map grid)")

	resp, err := g.client.Do(req)
	if err != nil {
		return place{}, fmt.Errorf("the map lookup failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return place{}, fmt.Errorf("the map lookup answered %d", resp.StatusCode)
	}

	var hits []struct {
		Lat         string   `json:"lat"`
		Lon         string   `json:"lon"`
		BoundingBox []string `json:"boundingbox"` // minLat, maxLat, minLon, maxLon
		DisplayName string   `json:"display_name"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&hits); err != nil {
		return place{}, fmt.Errorf("the map lookup's answer: %w", err)
	}

	if len(hits) == 0 || len(hits[0].BoundingBox) != 4 {
		return place{}, errAreaNotFound
	}

	h := hits[0]

	var f [6]float64

	for i, s := range []string{h.Lat, h.Lon, h.BoundingBox[0], h.BoundingBox[1], h.BoundingBox[2], h.BoundingBox[3]} {
		if f[i], err = strconv.ParseFloat(s, 64); err != nil {
			return place{}, fmt.Errorf("the map lookup's answer: %w", err)
		}
	}

	return place{
		Name: h.DisplayName, Lat: f[0], Lon: f[1],
		BBox: grid.BoundingBox{MinLat: f[2], MaxLat: f[3], MinLon: f[4], MaxLon: f[5]},
	}, nil
}

// gridRequest is the map-grid part of the scrape form.
type gridRequest struct {
	Area     string
	RadiusKm float64 // 0: the area's own outline
	CellKm   float64
	BBox     string // typed by hand; wins over Area
}

func gridRequestFromForm(get func(string) string) (gridRequest, error) {
	req := gridRequest{Area: strings.TrimSpace(get("grid_area")), BBox: strings.TrimSpace(get("grid_bbox"))}

	cell, ok := gridCellSizes[get("grid_cell")]
	if !ok {
		cell = 2
	}

	req.CellKm = cell

	if r := strings.TrimSpace(get("grid_radius")); r != "" && r != "0" {
		v, err := strconv.ParseFloat(r, 64)
		if err != nil || v <= 0 || v > 60 {
			return req, errors.New("invalid grid radius")
		}

		req.RadiusKm = v
	}

	if req.Area == "" && req.BBox == "" {
		return req, errors.New("the map grid needs a city or area")
	}

	return req, nil
}

// resolve turns the request into a grid: the typed box, or the area's outline (or the square
// around its centre when a radius is chosen).
func (s *Server) resolveGrid(ctx context.Context, req gridRequest) (GridSpec, string, error) {
	var (
		box   grid.BoundingBox
		label = req.Area
		err   error
	)

	switch {
	case req.BBox != "":
		if box, err = grid.ParseBoundingBox(req.BBox); err != nil {
			return GridSpec{}, "", err
		}

		if label == "" {
			label = req.BBox
		}
	default:
		p, lerr := s.geocode.lookup(ctx, req.Area)
		if lerr != nil {
			return GridSpec{}, "", fmt.Errorf("%q: %w", req.Area, lerr)
		}

		label = p.Name
		box = p.BBox

		if req.RadiusKm > 0 {
			box = bboxAround(p.Lat, p.Lon, req.RadiusKm)
		}
	}

	cells := len(grid.GenerateCells(box, req.CellKm))
	if cells == 0 {
		return GridSpec{}, "", errors.New("the area is smaller than one square: pick smaller squares, or cover a radius around it")
	}

	return GridSpec{Area: req.Area, BBox: formatBBox(box), CellKm: req.CellKm, Cells: cells}, label, nil
}

var gridPreviewTmpl = template.Must(template.New("grid").Parse(
	`{{if .Err}}<p class="hint error-text">{{.Err}}</p>{{else}}<p class="hint"><b>{{.Spec.Cells}}</b> squares of {{.Spec.CellKm}} km over {{.Label}}. Each search runs once per square: {{.Searches}} search(es) → <b>{{.Total}}</b> map searches, roughly <b>{{.Guess}}</b> distinct listings.{{if .TooMany}} <span class="error-text">That is over the {{.Max}} limit; pick bigger squares or a radius.</span>{{end}}</p>{{end}}`))

// gridPreview answers the form as it is filled in: how many squares, and how many searches.
func (s *Server) gridPreview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	data := map[string]any{"Max": maxGridSearches}

	req, err := gridRequestFromForm(r.URL.Query().Get)
	if err == nil {
		var (
			spec  GridSpec
			label string
		)

		spec, label, err = s.resolveGrid(r.Context(), req)
		if err == nil {
			searches := max(1, len(expandSearches(r.URL.Query().Get("keywords"), "")))
			data["Spec"], data["Label"], data["Searches"] = spec, label, searches
			data["Total"] = searches * spec.Cells
			data["Guess"] = searches * spec.Cells * resultsPerCell
			data["TooMany"] = searches*spec.Cells > maxGridSearches
		}
	}

	if err != nil {
		data["Err"] = err.Error()
	}

	_ = gridPreviewTmpl.Execute(w, data)
}
