package gmaps

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// reviewEl is a real review element (from a recorded fixture) under another id, so a scripted
// listing can hold as many distinct reviews as a test needs.
func reviewEl(t *testing.T, id string) any {
	t.Helper()

	els := rawReviewElements(t, "review_native_with_reply.json")
	raw, err := json.Marshal(els[0])
	require.NoError(t, err)

	// The endpoint wraps each review once: item[0] is the review element, whose [0] is its id.
	var item []any
	require.NoError(t, json.Unmarshal(raw, &item))
	el, ok := item[0].([]any)
	require.True(t, ok, "fixture item is not wrapped the way the endpoint wraps it")
	el[0] = id

	return item
}

// page is one scripted page: `ids` on it, and the token of the page after it ("" for the last).
func page(t *testing.T, next string, ids ...string) rpcResponse {
	t.Helper()

	els := make([]any, 0, len(ids))
	for _, id := range ids {
		els = append(els, reviewEl(t, id))
	}

	return rpcResponse{Status: 200, Body: rpcPageBody(t, next, els...)}
}

type step struct {
	resp rpcResponse
	err  error
}

// scriptedFetcher answers each page token with its steps in order (a transient failure then a
// success is two steps), records every URL it was asked for, and moves the clock on each call.
type scriptedFetcher struct {
	steps map[string][]step
	asked []string
	clock *fakeClock
	each  time.Duration
}

func (f *scriptedFetcher) fetchPage(_ context.Context, url string) (rpcResponse, error) {
	f.asked = append(f.asked, url)
	if f.clock != nil {
		f.clock.t = f.clock.t.Add(f.each)
	}

	queue := f.steps[url]
	if len(queue) == 0 {
		return rpcResponse{}, errors.New("unscripted " + url)
	}
	next := queue[0]
	if len(queue) > 1 {
		f.steps[url] = queue[1:]
	}

	return next.resp, next.err
}

type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time { return c.t }

// collector builds a reviewCollector over scripted routes. URLs are just "tok:<token>".
func collector(cfg ReviewConfig, browser, http rpcFetcher, dom domExtractor) (*reviewCollector, *[]time.Duration, *fakeClock) {
	clock := &fakeClock{t: time.Date(2026, 9, 24, 2, 30, 0, 0, time.UTC)}
	slept := []time.Duration{}
	c := &reviewCollector{
		cfg:     cfg.withDefaults(),
		browser: browser,
		http:    http,
		dom:     dom,
		urlFor:  func(token, _ string) (string, error) { return "tok:" + token, nil },
		now:     clock.now,
		sleep: func(ctx context.Context, d time.Duration) error {
			slept = append(slept, d)
			return ctx.Err()
		},
		newID:  func() (string, error) { return "req-1", nil },
		jitter: func(time.Duration) time.Duration { return 0 },
	}

	return c, &slept, clock
}

func ids(rows []Review) []string {
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.ReviewID)
	}
	return out
}

// settle is what `PlaceJob.Process` does: merge against the inline reviews, finalize.
func settle(res reviewResult, primary []Review) ReviewCollection {
	set := newReviewSet(primary, 0)
	for _, r := range res.Rows {
		set.add(r)
	}
	report := res.Report
	report.finalize(set.distinct())
	return report
}

func TestCollectorReadsEveryPageAndIsComplete(t *testing.T) {
	browser := &scriptedFetcher{steps: map[string][]step{
		"tok:":   {{resp: page(t, "t2", "r1", "r2")}},
		"tok:t2": {{resp: page(t, "t3", "r3", "r4")}},
		"tok:t3": {{resp: page(t, "", "r5")}},
	}}
	c, slept, _ := collector(ReviewConfig{}, browser, nil, nil)

	res := c.run(context.Background(), 5)
	report := settle(res, nil)

	assert.Equal(t, []string{"r1", "r2", "r3", "r4", "r5"}, ids(res.Rows))
	assert.Equal(t, stopDone, report.StopReason)
	assert.True(t, report.Complete)
	assert.Equal(t, 5, report.Collected)
	assert.Equal(t, 3, report.RPCPages)
	assert.Equal(t, 5, report.RPCReviews)
	assert.Equal(t, []string{stageRPCBrowser}, report.Stages)
	assert.Len(t, *slept, 2, "paced between pages, not after the last")
}

func TestAListingThatEndsShortIsExhaustedNotComplete(t *testing.T) {
	browser := &scriptedFetcher{steps: map[string][]step{
		"tok:": {{resp: page(t, "", "r1", "r2")}},
	}}
	dom := func(context.Context, *reviewSet, int, int) []DOMReview { return nil }
	c, _, _ := collector(ReviewConfig{}, browser, nil, dom)

	report := settle(c.run(context.Background(), 10), nil)

	assert.Equal(t, stopExhausted, report.StopReason)
	assert.False(t, report.Complete)
	assert.Equal(t, []string{stageRPCBrowser, stageDOM}, report.Stages, "DOM tried to make up the gap")
}

func TestABlockMidwayIsMadeUpByTheDOM(t *testing.T) {
	browser := &scriptedFetcher{steps: map[string][]step{
		"tok:":   {{resp: page(t, "t2", "r1", "r2")}},
		"tok:t2": {{resp: rpcResponse{Status: 403}}},
	}}
	var target int
	dom := func(_ context.Context, known *reviewSet, tgt, _ int) []DOMReview {
		target = tgt
		assert.True(t, known.has("r1"), "DOM is told what RPC already found")
		return []DOMReview{{ReviewID: "r2"}, {ReviewID: "r3"}, {ReviewID: "r4"}}
	}
	c, _, _ := collector(ReviewConfig{}, browser, nil, dom)

	res := c.run(context.Background(), 4)
	report := settle(res, nil)

	assert.Equal(t, 4, target)
	assert.Equal(t, []string{"r1", "r2", "r3", "r4"}, ids(res.Rows))
	assert.Equal(t, stopDone, report.StopReason)
	assert.True(t, report.Complete)
	assert.Equal(t, 1, report.Blocks)
	assert.Equal(t, 2, report.DOMReviews, "r2 was already known")
	assert.Equal(t, []string{stageRPCBrowser, stageDOM}, report.Stages)
}

func TestABlockNothingMadeUpForIsReportedAsBlockedAndKeepsWhatItHad(t *testing.T) {
	browser := &scriptedFetcher{steps: map[string][]step{
		"tok:":   {{resp: page(t, "t2", "r1", "r2")}},
		"tok:t2": {{resp: rpcResponse{Status: 200, FinalURL: "https://www.google.com/sorry/index?continue=x"}}},
	}}
	dom := func(context.Context, *reviewSet, int, int) []DOMReview { return nil }
	c, _, _ := collector(ReviewConfig{}, browser, nil, dom)

	res := c.run(context.Background(), 10)
	report := settle(res, nil)

	assert.Equal(t, []string{"r1", "r2"}, ids(res.Rows))
	assert.Equal(t, stopBlocked, report.StopReason)
	assert.Equal(t, stageRPCBrowser, report.StopStage)
	assert.Contains(t, report.StopDetail, "/sorry/")
	assert.False(t, report.Complete)
}

func TestTheNextStageCarriesOnFromTheBlockedPage(t *testing.T) {
	browser := &scriptedFetcher{steps: map[string][]step{
		"tok:":   {{resp: page(t, "t2", "r1")}},
		"tok:t2": {{resp: rpcResponse{Status: 429}}},
	}}
	http := &scriptedFetcher{steps: map[string][]step{
		"tok:t2": {{resp: page(t, "", "r2")}},
	}}
	c, _, _ := collector(ReviewConfig{}, browser, http, nil)

	res := c.run(context.Background(), 2)
	report := settle(res, nil)

	assert.Equal(t, []string{"tok:t2"}, http.asked, "not from page one again")
	assert.Equal(t, []string{"r1", "r2"}, ids(res.Rows))
	assert.Equal(t, stopDone, report.StopReason)
	assert.Equal(t, []string{stageRPCBrowser, stageRPCHTTP}, report.Stages)
}

func TestAPageTheParserCannotReadIsAParseErrorNotAnEmptyCollection(t *testing.T) {
	drift, err := json.Marshal([]any{nil, nil, []any{[]any{"not", "a", "review"}}})
	require.NoError(t, err)

	browser := &scriptedFetcher{steps: map[string][]step{
		"tok:": {{resp: rpcResponse{Status: 200, Body: append([]byte(")]}'\n"), drift...)}}},
	}}
	http := &scriptedFetcher{steps: map[string][]step{}}
	c, _, _ := collector(ReviewConfig{}, browser, http, nil)

	report := settle(c.run(context.Background(), 50), nil)

	assert.Equal(t, stopParseError, report.StopReason)
	assert.Empty(t, http.asked, "another route cannot fix drift")
	assert.False(t, report.Complete)
}

func TestAnUnknownCountIsNeverComplete(t *testing.T) {
	browser := &scriptedFetcher{steps: map[string][]step{
		"tok:": {{resp: page(t, "", "r1", "r2")}},
	}}
	called := false
	dom := func(context.Context, *reviewSet, int, int) []DOMReview { called = true; return nil }
	c, _, _ := collector(ReviewConfig{}, browser, nil, dom)

	report := settle(c.run(context.Background(), 0), nil)

	assert.Equal(t, stopCountUnknown, report.StopReason)
	assert.False(t, report.Complete)
	assert.Equal(t, 2, report.Collected)
	assert.False(t, called, "a clean end of pagination read the whole listing")
}

func TestTheCapStopsCollection(t *testing.T) {
	browser := &scriptedFetcher{steps: map[string][]step{
		"tok:":   {{resp: page(t, "t2", "r1", "r2")}},
		"tok:t2": {{resp: page(t, "", "r3")}},
	}}
	c, _, _ := collector(ReviewConfig{MaxReviews: 2}, browser, nil, nil)

	res := c.run(context.Background(), 3)
	report := settle(res, nil)

	assert.Equal(t, stopCap, report.StopReason)
	assert.Len(t, res.Rows, 2)
	assert.False(t, report.Complete)
}

func TestTheBudgetStopsCollectionAndKeepsWhatItHad(t *testing.T) {
	browser := &scriptedFetcher{steps: map[string][]step{
		"tok:":   {{resp: page(t, "t2", "r1")}},
		"tok:t2": {{resp: page(t, "t3", "r2")}},
		"tok:t3": {{resp: page(t, "", "r3")}},
	}, each: time.Minute}
	c, _, clock := collector(ReviewConfig{Budget: 2 * time.Minute}, browser, nil, nil)
	browser.clock = clock

	res := c.run(context.Background(), 3)
	report := settle(res, nil)

	assert.Equal(t, stopBudget, report.StopReason)
	assert.Equal(t, 2, report.RPCPages)
	assert.Equal(t, []string{"r1", "r2"}, ids(res.Rows))
	assert.InDelta(t, 120, report.ElapsedSeconds, 0.001)
	assert.False(t, report.Complete)
}

func TestATransientFailureIsRetriedOnTheSameRoute(t *testing.T) {
	browser := &scriptedFetcher{steps: map[string][]step{
		"tok:": {
			{err: errors.New("connection reset")},
			{resp: rpcResponse{Status: 502}},
			{resp: page(t, "", "r1")},
		},
	}}
	c, slept, _ := collector(ReviewConfig{}, browser, nil, nil)

	report := settle(c.run(context.Background(), 1), nil)

	assert.Equal(t, stopDone, report.StopReason)
	assert.Equal(t, []time.Duration{2 * time.Second, 4 * time.Second}, *slept)
	assert.Equal(t, 0, report.Blocks)
}

func TestATransientFailureThatPersistsEndsTheStage(t *testing.T) {
	browser := &scriptedFetcher{steps: map[string][]step{
		"tok:": {{err: errors.New("dial tcp http://user:secret@proxy.example:8080: refused")}},
	}}
	c, _, _ := collector(ReviewConfig{}, browser, nil, nil)

	report := settle(c.run(context.Background(), 5), nil)

	assert.Equal(t, stopError, report.StopReason)
	assert.NotContains(t, report.StopDetail, "secret", "proxy credentials never reach the results")
}

func TestInlineReviewsCountTowardCompleteness(t *testing.T) {
	browser := &scriptedFetcher{steps: map[string][]step{
		"tok:": {{resp: page(t, "", "r1", "r2")}},
	}}
	dom := func(context.Context, *reviewSet, int, int) []DOMReview { return nil }
	c, _, _ := collector(ReviewConfig{}, browser, nil, dom)

	report := settle(c.run(context.Background(), 3), []Review{{ReviewID: "inline-only"}})

	assert.Equal(t, 3, report.Collected)
	assert.Equal(t, stopDone, report.StopReason)
	assert.True(t, report.Complete)
}

func TestWithProxiesTheProxylessRouteIsNeverOffered(t *testing.T) {
	with := newReviewCollector(ReviewConfig{Proxies: []string{"http://u:p@proxy.example:8080"}}, nil, "https://maps")
	without := newReviewCollector(ReviewConfig{}, nil, "https://maps")

	_, proxyless := with.http.(stealthRPC)
	assert.False(t, proxyless, "with proxies, never the route that uses this machine's own address")
	_, proxyless = without.http.(stealthRPC)
	assert.True(t, proxyless, "unchanged for runs with no proxies")
}

func TestNoRouteAtAllIsAnError(t *testing.T) {
	c, _, _ := collector(ReviewConfig{}, nil, nil, nil)

	report := settle(c.run(context.Background(), 5), nil)

	assert.Equal(t, stopError, report.StopReason)
}

func TestReviewConfigDefaults(t *testing.T) {
	cfg := ReviewConfig{}.withDefaults()
	assert.Equal(t, defaultReviewBudget, cfg.Budget)
	assert.Equal(t, defaultReviewCap, cfg.MaxReviews)
	assert.Equal(t, defaultReviewPageDelay, cfg.PageDelay)

	assert.Equal(t, time.Duration(0), ReviewConfig{PageDelay: -1}.withDefaults().PageDelay,
		"a negative delay means none")
}

func TestDecodePageRPC(t *testing.T) {
	resp, err := decodePageRPC(map[string]any{"status": 403.0, "url": "https://www.google.com/sorry/index", "text": "<html>"})
	require.NoError(t, err)
	assert.Equal(t, rpcResponse{Status: 403, FinalURL: "https://www.google.com/sorry/index", Body: []byte("<html>")}, resp)

	_, err = decodePageRPC(map[string]any{"status": 0.0, "error": "TypeError: Failed to fetch"})
	assert.ErrorContains(t, err, "Failed to fetch")

	_, err = decodePageRPC("not an object")
	assert.Error(t, err)
}
