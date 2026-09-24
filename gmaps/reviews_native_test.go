//nolint:testpackage // exercises private incremental collector helpers
package gmaps

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNativeIncrementalReviewMerge(t *testing.T) {
	index := make(map[string]int)
	rows := mergeDOMReviews(nil, []DOMReview{{ReviewID: "one", AuthorName: "Same name", Text: "short"}, {ReviewID: "two", AuthorName: "Same name", Text: "short"}}, index, 0)
	rows = mergeDOMReviews(rows, []DOMReview{{ReviewID: "one", Text: "expanded original review", ReplyText: "Owner response", AuthorURL: "https://www.google.com/maps/contrib/123"}}, index, 0)
	require.Len(t, rows, 2)
	assert.Equal(t, "expanded original review", rows[0].Text)
	assert.Equal(t, "Same name", rows[0].AuthorName)
	assert.Equal(t, "Owner response", rows[0].ReplyText)
	assert.NotEmpty(t, rows[0].AuthorURL)
}

func TestNativePageBudgetNeverExceedsTheCap(t *testing.T) {
	// Whether RPC is supplemented from the public page is the collector's call now
	// (review_collector_test.go); the page budget still never outruns the cap.
	assert.LessOrEqual(t, reviewPageBudget(1000000, defaultReviewCap)*20, defaultReviewCap)
}

func TestReviewPageBudgetHonoursAConfigurableCap(t *testing.T) {
	assert.Equal(t, 2500, reviewPageBudget(0, 50000))
	assert.LessOrEqual(t, reviewPageBudget(10000, 50000)*20, 50000)
	assert.GreaterOrEqual(t, reviewPageBudget(10000, 50000)*20, 10000)
	assert.Equal(t, 1, reviewPageBudget(0, 5))
}

func TestNativeStarOnlyAndDateEvidence(t *testing.T) {
	decoded := decodeDOMReviews([]any{map[string]any{"review_id": "anonymous", "rating": 5, "published_at": "2025-01-01T00:00:00Z", "reply_text": "Owner reply"}})
	rows := ConvertDOMReviewsToReviews(decoded)
	require.Len(t, rows, 1)
	assert.Empty(t, rows[0].Name)
	assert.NotNil(t, rows[0].PublishedAt)
	assert.Equal(t, "Owner reply", rows[0].ReplyText)
	rows = ConvertDOMReviewsToReviews([]DOMReview{{ReviewID: "relative", RelativeTimeDescription: "a month ago", PublishedAt: "a month ago"}})
	assert.Nil(t, rows[0].PublishedAt)
}

func TestNativePrimaryEnrichmentBeforeDeduplication(t *testing.T) {
	// The enrichment rule `dedupeDOMReviewsAgainstPrimary` used to apply is now `reviewSet.add`'s
	// (see reviewset_test.go); this pins that a field the incoming review never carried, like the
	// post time, survives enrichment untouched.
	primary := []Review{{ReviewID: "same", Name: "A", Description: "Short", PostedAtUnixMicros: 1700000000000000}}
	set := newReviewSet(primary, 0)
	added := set.add(&Review{ReviewID: "same", Description: "A longer expanded review",
		AuthorURL: "https://www.google.com/maps/contrib/123", ReplyText: "Owner reply"})
	assert.False(t, added)
	assert.Empty(t, set.extended())
	assert.Equal(t, "A longer expanded review", primary[0].Description)
	assert.Equal(t, "Owner reply", primary[0].ReplyText)
	assert.Equal(t, int64(1700000000000000), primary[0].PostedAtUnixMicros)
}

func TestNativeCollectionCapAndRepeatPass(t *testing.T) {
	incoming := make([]DOMReview, 5100)
	for i := range incoming {
		incoming[i] = DOMReview{ReviewID: fmt.Sprint(i), AuthorName: "Reviewer", Text: "Text"}
	}

	index := make(map[string]int)
	rows := mergeDOMReviews(nil, incoming, index, 0)
	require.Len(t, rows, defaultReviewCap)
	rows = mergeDOMReviews(rows, incoming, index, 0)
	assert.Len(t, rows, defaultReviewCap)
}

func BenchmarkNativeIncrementalMerge(b *testing.B) {
	rows := make([]DOMReview, 5000)
	index := make(map[string]int, len(rows))

	for i := range rows {
		rows[i] = DOMReview{ReviewID: fmt.Sprint(i), Text: "Review text"}
		index[rows[i].ReviewID] = i
	}

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		mergeDOMReviews(rows, rows, index, 0)
	}
}
