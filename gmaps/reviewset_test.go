//nolint:testpackage // tests the review collector's unexported internals
package gmaps

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReviewSetCountsAnOverlapBetweenTwoPagesOnce(t *testing.T) {
	set := newReviewSet(nil, 0)
	added1 := set.addPage(rpcPage{Reviews: []Review{
		{ReviewID: "r1", Description: "short"},
		{ReviewID: "r2", Description: "short"},
	}})
	added2 := set.addPage(rpcPage{Reviews: []Review{
		{ReviewID: "r2", Description: "a longer version of the same review"},
		{ReviewID: "r3", Description: "short"},
	}})

	assert.Equal(t, 2, added1)
	assert.Equal(t, 1, added2) // r2 enriched, not added again
	assert.Equal(t, 3, set.len())
	assert.Equal(t, 3, set.distinct())
	extended := set.extended()
	require.Len(t, extended, 3)
	r2 := findByID(t, extended, "r2")
	assert.Equal(t, "a longer version of the same review", r2.Description)
}

func TestReviewSetSeededWithPrimaryEnrichesPrimaryInPlace(t *testing.T) {
	primary := []Review{{ReviewID: "p1", Description: "short"}}
	set := newReviewSet(primary, 0)

	added := set.add(&Review{ReviewID: "p1", Description: "a much longer version", ReplyText: "thanks"})
	assert.False(t, added)
	assert.Equal(t, "a much longer version", primary[0].Description)
	assert.Equal(t, "thanks", primary[0].ReplyText)
	// Enrichment, not a new row: the union is still just the one primary review.
	assert.Equal(t, 0, set.len())
	assert.Equal(t, 1, set.distinct())
	assert.Empty(t, set.extended())
}

func TestReviewSetSeedingCountsPrimaryOnceInDistinct(t *testing.T) {
	primary := []Review{{ReviewID: "p1"}, {ReviewID: "p2"}}
	set := newReviewSet(primary, 0)
	set.add(&Review{ReviewID: "p1"})    // re-read of a primary review: not new
	set.add(&Review{ReviewID: "extra"}) // genuinely new

	assert.Equal(t, 3, set.distinct())
	assert.Equal(t, 1, set.len())
	assert.Equal(t, []Review{{ReviewID: "extra"}}, set.extended())
}

func TestReviewSetAnIDLessReviewIsNeverADuplicate(t *testing.T) {
	set := newReviewSet(nil, 0)
	added1 := set.add(&Review{Description: "anonymous review one"})
	added2 := set.add(&Review{Description: "anonymous review one"}) // same text, still counted

	assert.True(t, added1)
	assert.True(t, added2)
	assert.Equal(t, 2, set.len())
	assert.Equal(t, 2, set.distinct())
	assert.False(t, set.has("")) // has() never claims an empty id is known
}

func TestReviewSetHasChecksPrimaryAndAddedRows(t *testing.T) {
	set := newReviewSet([]Review{{ReviewID: "p1"}}, 0)
	set.add(&Review{ReviewID: "r1"})

	assert.True(t, set.has("p1"))
	assert.True(t, set.has("r1"))
	assert.False(t, set.has("unknown"))
	assert.False(t, (*reviewSet)(nil).has("p1"))
}

func TestReviewSetRefusesANewRowPastTheCapButStillEnrichesOldOnes(t *testing.T) {
	set := newReviewSet(nil, 2)
	set.add(&Review{ReviewID: "r1", Description: "short"})
	set.add(&Review{ReviewID: "r2", Description: "short"})
	added := set.add(&Review{ReviewID: "r3", Description: "short"})
	assert.False(t, added)
	assert.Equal(t, 2, set.len())

	enriched := set.add(&Review{ReviewID: "r1", Description: "a longer version of r1"})
	assert.False(t, enriched)
	assert.Equal(t, "a longer version of r1", findByID(t, set.extended(), "r1").Description)
}

func TestReviewSetIDLessPrimaryRowsNeverMatchIDLessAdditions(t *testing.T) {
	// The rule `dedupeDOMReviewsAgainstPrimary` used to enforce directly: two reviews with no id
	// are never treated as the same review, whichever source either came from.
	primary := []Review{{ReviewID: ""}, {ReviewID: "id-1"}}
	set := newReviewSet(primary, 0)
	set.add(&Review{ReviewID: ""})
	set.add(&Review{ReviewID: ""})

	assert.Equal(t, []Review{{ReviewID: ""}, {ReviewID: ""}}, set.extended())
}

func TestReviewSetAddPageReturnsHowManyWereNew(t *testing.T) {
	set := newReviewSet([]Review{{ReviewID: "p1"}}, 0)
	added := set.addPage(rpcPage{Reviews: []Review{{ReviewID: "p1"}, {ReviewID: "r1"}, {ReviewID: "r2"}}})
	assert.Equal(t, 2, added)
}

func TestANilReviewSetBehavesAsEmpty(t *testing.T) {
	var set *reviewSet

	assert.Equal(t, 0, set.len())
	assert.Equal(t, 0, set.distinct())
	assert.Nil(t, set.extended())
	assert.False(t, set.has("anything"))
}

func findByID(t *testing.T, rows []Review, id string) Review {
	t.Helper()

	for i := range rows {
		if rows[i].ReviewID == id {
			return rows[i]
		}
	}

	t.Fatalf("no review with id %q", id)

	return Review{}
}
