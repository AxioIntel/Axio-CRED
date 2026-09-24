package gmaps

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClassifyRPC(t *testing.T) {
	ok := append([]byte(")]}'\n"), []byte(`[null,null,[]]`)...)

	cases := []struct {
		name string
		resp rpcResponse
		err  error
		want rpcVerdict
	}{
		{"a reviews page", rpcResponse{Status: 200, Body: ok}, nil, verdictOK},
		{"transport error", rpcResponse{}, errors.New("timeout"), verdictTransient},
		{"403", rpcResponse{Status: 403}, nil, verdictBlocked},
		{"429", rpcResponse{Status: 429}, nil, verdictBlocked},
		{"a redirect to /sorry/", rpcResponse{Status: 200, FinalURL: "https://www.google.com/sorry/index?continue=x", Body: ok}, nil, verdictBlocked},
		{"a 200 block page", rpcResponse{Status: 200, Body: []byte("<html><title>Sorry</title>Our systems have detected unusual traffic</html>")}, nil, verdictBlocked},
		{"a 200 CAPTCHA page", rpcResponse{Status: 200, Body: []byte(`<html><div class="g-recaptcha"></div></html>`)}, nil, verdictBlocked},
		{"a 502", rpcResponse{Status: 502}, nil, verdictTransient},
		{"no status at all", rpcResponse{Status: 0}, nil, verdictTransient},
		{"a 404", rpcResponse{Status: 404}, nil, verdictInvalid},
		{"an empty body", rpcResponse{Status: 200, Body: []byte("  ")}, nil, verdictInvalid},
		{"some other html", rpcResponse{Status: 200, Body: []byte("<html><body>maintenance</body></html>")}, nil, verdictInvalid},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, _ := classifyRPC(c.resp, c.err)
			assert.Equal(t, c.want, got)
		})
	}
}

func TestScrubDetailRemovesProxyCredentials(t *testing.T) {
	got := scrubDetail("proxyconnect tcp: http://alice:s3cret@10.0.0.1:3128 refused; socks5://bob:pw@h:1080")
	assert.NotContains(t, got, "s3cret")
	assert.NotContains(t, got, "pw@")
	assert.Contains(t, got, "http://[redacted]@10.0.0.1:3128")
}

func TestFinalize(t *testing.T) {
	r := ReviewCollection{Reported: 10, ReportedKnown: true, StopReason: stopExhausted, StopStage: stageRPCBrowser}
	r.finalize(10)
	assert.Equal(t, stopDone, r.StopReason)
	assert.Empty(t, r.StopStage)
	assert.True(t, r.Complete)

	short := ReviewCollection{Reported: 10, ReportedKnown: true, StopReason: stopExhausted}
	short.finalize(9)
	assert.Equal(t, stopExhausted, short.StopReason)
	assert.False(t, short.Complete)

	blocked := ReviewCollection{Reported: 10, ReportedKnown: true, StopReason: stopBlocked}
	blocked.finalize(10)
	assert.False(t, blocked.Complete, "a count reached by chance after a block is still not a whole read")

	none := ReviewCollection{StopReason: stopNoReviews}
	none.finalize(0)
	assert.True(t, none.Complete)
}

func TestAnEntryWithoutExtraReviewsCarriesNoCollectionReport(t *testing.T) {
	plain, err := json.Marshal(Entry{Title: "Bright Smile Dental"})
	require.NoError(t, err)
	assert.NotContains(t, string(plain), "review_collection")

	withReport, err := json.Marshal(Entry{Title: "Bright Smile Dental", ReviewCollection: &ReviewCollection{
		Reported: 3, ReportedKnown: true, Collected: 3, Complete: true, StopReason: stopDone, Stages: []string{stageRPCBrowser},
	}})
	require.NoError(t, err)

	var back map[string]any
	require.NoError(t, json.Unmarshal(withReport, &back))
	report, ok := back["review_collection"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, true, report["complete"])
	assert.Equal(t, "done", report["stop_reason"])
	// The fields the sender already reads are untouched beside it.
	assert.Contains(t, back, "user_reviews_extended")
	assert.Contains(t, back, "review_count")
}

func TestPlaceBlocked(t *testing.T) {
	assert.Empty(t, placeBlocked(200, "https://www.google.com/maps/place/x"))
	assert.Equal(t, "HTTP 429", placeBlocked(429, "https://www.google.com/maps/place/x"))
	assert.Contains(t, placeBlocked(200, "https://www.google.com/sorry/index?continue=x"), "/sorry/")
}
