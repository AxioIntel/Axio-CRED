package gmaps_test

import (
	"net/url"
	"testing"

	"github.com/gosom/google-maps-scraper/gmaps"
)

func TestMapsSeedPreservesPlaceID(t *testing.T) {
	const placeID = "ChIJHy8fZ7P6DDkREnuw1bPQYfw"
	job := gmaps.NewGmapJob("test", "en", "https://www.google.com/maps/search/?api=1&query=Google&query_place_id="+placeID, 1, false, "", 0)

	parsed, err := url.Parse(job.GetFullURL())
	if err != nil {
		t.Fatal(err)
	}

	for key, want := range map[string]string{"api": "1", "query": "Google", "query_place_id": placeID, "hl": "en"} {
		if got := parsed.Query().Get(key); got != want {
			t.Errorf("%s = %q; want %q", key, got, want)
		}
	}
}
