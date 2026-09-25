//nolint:testpackage // tests the review collector's unexported internals
package gmaps

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// rawReviewElements loads a fixture's raw review elements (the `el` shape `parseReviews` reads),
// the same fixtures `loadReviewsFixture` parses in reviews_test.go, but unparsed -- for building
// synthetic `listugcposts` page bodies.
func rawReviewElements(t *testing.T, filename string) []any {
	t.Helper()

	raw, err := os.ReadFile("testdata/" + filename)
	require.NoError(t, err)

	var els []any

	require.NoError(t, json.Unmarshal(raw, &els))

	return els
}

// rpcPageBody builds a `listugcposts` response body -- the real envelope, `)]}'\n[null,token,items]`
// -- from raw review elements, the way Google's endpoint actually shapes one page.
func rpcPageBody(t *testing.T, token string, els ...any) []byte {
	t.Helper()

	var tok any
	if token != "" {
		tok = token
	}

	body, err := json.Marshal([]any{nil, tok, els})
	require.NoError(t, err)

	return append([]byte(")]}'\n"), body...)
}

func TestParseRPCPageReadsReviewsAndTheNextToken(t *testing.T) {
	els := rawReviewElements(t, "review_native_with_reply.json")
	body := rpcPageBody(t, "next-token", els...)

	p, err := parseRPCPage(body)
	require.NoError(t, err)
	assert.Equal(t, "next-token", p.NextToken)
	assert.Equal(t, len(els), p.RawItems)
	require.Len(t, p.Reviews, 1)
	assert.Equal(t, "Ci9DQUlRQUNvZENodHljRjlvT2xGMmRraFdhSFowWW0xWVNURTBObEptU3pWWVgxRRAB",
		p.Reviews[0].ReviewID)
}

func TestParseRPCPageReadsANilTokenAsTheLastPage(t *testing.T) {
	els := rawReviewElements(t, "review_native_no_text.json")
	body := rpcPageBody(t, "", els...)

	p, err := parseRPCPage(body)
	require.NoError(t, err)
	assert.Empty(t, p.NextToken)
	require.Len(t, p.Reviews, 1)
}

func TestParseRPCPageAcceptsThePrefixWithoutATrailingNewline(t *testing.T) {
	body := []byte(`)]}'` + `[null,null,[]]`)

	p, err := parseRPCPage(body)
	require.NoError(t, err)
	assert.Empty(t, p.Reviews)
	assert.Equal(t, 0, p.RawItems)
}

func TestParseRPCPageRefusesABodyWithNoPrefix(t *testing.T) {
	_, err := parseRPCPage([]byte(`[null,null,[]]`))
	assert.ErrorIs(t, err, errRPCNoPrefix)
}

func TestParseRPCPageRefusesABodyThatIsNotJSON(t *testing.T) {
	_, err := parseRPCPage([]byte(")]}'\n<html>not json</html>"))
	assert.ErrorIs(t, err, errRPCNotJSON)
}

func TestParseRPCPageRefusesAShapeThatIsNotAReviewsPage(t *testing.T) {
	body, err := json.Marshal([]any{nil, "token"})
	require.NoError(t, err)
	_, err = parseRPCPage(append([]byte(")]}'\n"), body...))
	assert.ErrorIs(t, err, errRPCShape)
}

func TestParseRPCPageFlagsItemsThatParsedAsNoReviews(t *testing.T) {
	// A shape the endpoint has never actually sent, standing in for an index drift: items are
	// present, but none of them parse as a review -- the canary that says so, not a quiet zero.
	body, err := json.Marshal([]any{nil, nil, []any{[]any{"not", "a", "review", "shape"}}})
	require.NoError(t, err)

	_, err = parseRPCPage(append([]byte(")]}'\n"), body...))
	assert.ErrorIs(t, err, errRPCParsedNothing)
}

func TestParseRPCPageAnEmptyPageIsNotAnError(t *testing.T) {
	// A place with nothing left to page through, not index drift: RawItems is genuinely zero.
	body, err := json.Marshal([]any{nil, nil, []any{}})
	require.NoError(t, err)

	p, err := parseRPCPage(append([]byte(")]}'\n"), body...))
	require.NoError(t, err)
	assert.Empty(t, p.Reviews)
	assert.Equal(t, 0, p.RawItems)
}

func TestExtractReviewsStillReadsOnePageDirectly(t *testing.T) {
	els := rawReviewElements(t, "review_native_no_translation.json")
	body := rpcPageBody(t, "", els...)

	reviews := extractReviews(body)
	require.Len(t, reviews, 1)
	assert.Equal(t, "ChZDSUhNMG9nS0VJQ0FnSUNZemVhOFpREAE", reviews[0].ReviewID)
}
