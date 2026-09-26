package gmaps

import (
	"encoding/json"
	"errors"
	"strings"
)

// rpcPage is one page of Google's own review endpoint (`listugcposts`), parsed once and read by
// both the browser and HTTP stages. RawItems is kept beside Reviews so a page that parsed as
// valid JSON but yielded no reviews can be told apart from a page that genuinely had none -- the
// first is index drift in `parseReviews`, the second is an empty page, and only one of them is
// an error.
type rpcPage struct {
	Reviews   []Review
	NextToken string
	RawItems  int
}

var (
	// errRPCNoPrefix: the body did not start with Google's anti-JSON-hijacking prefix, so it is
	// not this endpoint's response at all -- a block page, a proxy's own error page, or a caller
	// on the wrong host.
	errRPCNoPrefix = errors.New("rpc page: missing )]}' prefix")
	// errRPCNotJSON: the prefix was there but what follows does not parse.
	errRPCNotJSON = errors.New("rpc page: body is not valid JSON")
	// errRPCShape: valid JSON, but not the three-or-more-element array this endpoint always
	// returns, or its third element is not the reviews list.
	errRPCShape = errors.New("rpc page: response is not shaped like a reviews page")
	// errRPCParsedNothing: the reviews list had entries, but `parseReviews` read zero reviews
	// from every one of them -- the protobuf-index canary. A genuinely empty page (RawItems==0)
	// is not this; it is a place with nothing to page through.
	errRPCParsedNothing = errors.New("rpc page: items present but none parsed as a review")
)

// parseRPCPage reads one `listugcposts` response body. It never returns a zero-value rpcPage on
// success with reviews silently missing: either the page's reviews come back, or an error says
// which of the four ways a page can be unreadable this one was.
func parseRPCPage(body []byte) (rpcPage, error) {
	text := string(body)

	switch {
	case strings.HasPrefix(text, ")]}'\n"):
		text = text[len(")]}'\n"):]
	case strings.HasPrefix(text, ")]}'"):
		text = text[len(")]}'"):]
	default:
		return rpcPage{}, errRPCNoPrefix
	}

	var jd []any
	if err := json.Unmarshal([]byte(text), &jd); err != nil {
		return rpcPage{}, errRPCNotJSON
	}

	if len(jd) < 3 {
		return rpcPage{}, errRPCShape
	}

	itemsI := getNthElementAndCast[[]any](jd, 2)
	reviews := parseReviews(itemsI)

	if len(itemsI) > 0 && len(reviews) == 0 {
		return rpcPage{}, errRPCParsedNothing
	}

	var token string
	if jd[1] != nil {
		token, _ = jd[1].(string)
	}

	return rpcPage{Reviews: reviews, NextToken: token, RawItems: len(itemsI)}, nil
}
