//nolint:testpackage // tests the review collector's unexported internals
package gmaps

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	proxyBrowser = "http://u0:p0@browser.proxy.example:8000"
	proxyA       = "http://u1:secret-a@a.proxy.example:8001"
	proxyB       = "http://u2:secret-b@b.proxy.example:8002"
)

// fakeTransport answers as Google would to each identity: steps per proxy, per URL, in order.
type fakeTransport struct {
	mu    sync.Mutex
	steps map[string]map[string][]step
	asked []string // "proxy url"
	uas   map[string]string
}

func (f *fakeTransport) do(_ context.Context, id *reviewIdentity, url string) (rpcResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.asked = append(f.asked, id.proxy+" "+url)
	if f.uas == nil {
		f.uas = map[string]string{}
	}

	f.uas[id.proxy] = id.userAgent

	queue := f.steps[id.proxy][url]
	if len(queue) == 0 {
		return rpcResponse{}, errors.New("unscripted " + url + " as " + id.String())
	}

	next := queue[0]

	if len(queue) > 1 {
		f.steps[id.proxy][url] = queue[1:]
	}

	return next.resp, next.err
}

func identityRoute(t *testing.T, tr *fakeTransport, proxies ...string) *identityClient {
	t.Helper()

	client, err := newIdentityClient(proxies, tr)
	require.NoError(t, err)

	return client
}

func TestAPoolStartsAtTheSecondProxy(t *testing.T) {
	pool, err := newIdentityPool([]string{proxyBrowser, proxyA, proxyB})
	require.NoError(t, err)
	assert.Equal(t, proxyA, pool.current().proxy, "the browser holds the first")

	single, err := newIdentityPool([]string{proxyA})
	require.NoError(t, err)
	assert.Equal(t, proxyA, single.current().proxy)
}

func TestRotationWalksEveryIdentityOnceThenGivesUp(t *testing.T) {
	pool, err := newIdentityPool([]string{proxyBrowser, proxyA, proxyB})
	require.NoError(t, err)

	assert.True(t, pool.rotate())
	assert.Equal(t, proxyB, pool.current().proxy)
	assert.True(t, pool.rotate())
	assert.Equal(t, proxyBrowser, pool.current().proxy)
	assert.False(t, pool.rotate(), "every identity has been refused")
}

func TestEachIdentityKeepsItsOwnUserAgent(t *testing.T) {
	pool, err := newIdentityPool([]string{proxyBrowser, proxyA, proxyB})
	require.NoError(t, err)

	assert.NotEqual(t, pool.ids[1].userAgent, pool.ids[2].userAgent)

	for _, id := range pool.ids {
		assert.Contains(t, id.userAgent, "Chrome/")
	}
}

func TestABadProxyLineIsRefusedAtStart(t *testing.T) {
	_, err := newIdentityPool([]string{proxyA, "not a proxy"})
	assert.ErrorContains(t, err, "proxy 2")
	assert.NotContains(t, err.Error(), "secret-a")

	_, err = newIdentityPool(nil)
	assert.ErrorIs(t, err, errNoProxies)
}

func TestAnIdentityNeverPrintsItsCredentials(t *testing.T) {
	pool, err := newIdentityPool([]string{proxyA})
	require.NoError(t, err)

	named := pool.current().String()
	assert.Equal(t, "identity via http://a.proxy.example:8001", named)
	assert.NotContains(t, named, "secret")
}

func TestConcurrentRotationIsSafe(t *testing.T) {
	pool, err := newIdentityPool([]string{proxyBrowser, proxyA, proxyB})
	require.NoError(t, err)

	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)

		go func() {
			defer wg.Done()
			pool.rotate()
			_ = pool.current()
		}()
	}

	wg.Wait()
}

func TestARefusedIdentityHandsTheSamePageToTheNext(t *testing.T) {
	tr := &fakeTransport{steps: map[string]map[string][]step{
		proxyA: {
			"tok:":   {{resp: page(t, "t2", "r1", "r2")}},
			"tok:t2": {{resp: rpcResponse{Status: 403}}},
		},
		proxyB: {
			"tok:t2": {{resp: page(t, "", "r3")}},
		},
	}}
	c, _, _ := collector(ReviewConfig{}, nil, identityRoute(t, tr, proxyBrowser, proxyA, proxyB), nil)

	res := c.run(context.Background(), 3)
	report := settle(res, nil)

	assert.Equal(t, []string{"r1", "r2", "r3"}, ids(res.Rows))
	assert.Equal(t, stopDone, report.StopReason)
	assert.True(t, report.Complete)
	assert.Equal(t, 1, report.Blocks)
	assert.Equal(t, 1, report.IdentityRotations)
	assert.Equal(t, 0, report.Restarts)
	assert.Equal(t, proxyB+" tok:t2", tr.asked[len(tr.asked)-1], "the refused page, not page one")
}

func TestABlockPageServedWith200AlsoRotates(t *testing.T) {
	tr := &fakeTransport{steps: map[string]map[string][]step{
		proxyA: {"tok:": {{resp: rpcResponse{Status: 200, Body: []byte("<html>Our systems have detected unusual traffic</html>")}}}},
		proxyB: {"tok:": {{resp: page(t, "", "r1")}}},
	}}
	c, _, _ := collector(ReviewConfig{}, nil, identityRoute(t, tr, proxyBrowser, proxyA, proxyB), nil)

	report := settle(c.run(context.Background(), 1), nil)

	assert.Equal(t, stopDone, report.StopReason)
	assert.Equal(t, 1, report.IdentityRotations)
}

func TestWhenEveryIdentityIsRefusedTheDOMGetsWhatIsLeft(t *testing.T) {
	tr := &fakeTransport{steps: map[string]map[string][]step{
		proxyA:       {"tok:": {{resp: page(t, "t2", "r1")}}, "tok:t2": {{resp: rpcResponse{Status: 429}}}},
		proxyB:       {"tok:t2": {{resp: rpcResponse{Status: 403}}}},
		proxyBrowser: {"tok:t2": {{resp: rpcResponse{Status: 200, FinalURL: "https://www.google.com/sorry/index"}}}},
	}}
	domAsked := false
	dom := func(_ context.Context, known *reviewSet, _, _ int) []DOMReview {
		domAsked = true

		assert.True(t, known.has("r1"))

		return nil
	}
	c, _, _ := collector(ReviewConfig{}, nil, identityRoute(t, tr, proxyBrowser, proxyA, proxyB), dom)

	res := c.run(context.Background(), 5)
	report := settle(res, nil)

	assert.True(t, domAsked)
	assert.Equal(t, []string{"r1"}, ids(res.Rows), "what was collected is kept")
	assert.Equal(t, stopBlocked, report.StopReason)
	assert.Equal(t, stageRPCHTTP, report.StopStage)
	assert.Equal(t, 3, report.Blocks)
	assert.Equal(t, 2, report.IdentityRotations)
	assert.False(t, report.Complete)
}

func TestAFreshIdentityThatCannotContinueStartsTheListingAgainOnce(t *testing.T) {
	junk := rpcResponse{Status: 200, Body: []byte(")]}'\n{\"not\":\"a page\"}")}
	tr := &fakeTransport{steps: map[string]map[string][]step{
		proxyA: {
			"tok:":   {{resp: page(t, "t2", "r1", "r2")}},
			"tok:t2": {{resp: rpcResponse{Status: 403}}},
		},
		proxyB: {
			"tok:t2": {{resp: junk}}, // the token was A's
			"tok:":   {{resp: page(t, "t9", "r1", "r2")}},
			"tok:t9": {{resp: page(t, "", "r3")}},
		},
	}}
	ids1 := []string{"req-1", "req-2"}
	c, _, _ := collector(ReviewConfig{}, nil, identityRoute(t, tr, proxyBrowser, proxyA, proxyB), nil)
	c.newID = func() (string, error) { id := ids1[0]; ids1 = ids1[1:]; return id, nil }

	res := c.run(context.Background(), 3)
	report := settle(res, nil)

	assert.Equal(t, []string{"r1", "r2", "r3"}, ids(res.Rows), "the pages read twice are counted once")
	assert.Equal(t, stopDone, report.StopReason)
	assert.Equal(t, 1, report.Restarts)
	assert.Equal(t, 1, report.IdentityRotations)
}

func TestAParseErrorOnAnIdentityThatWasNotJustRotatedIsNotRestarted(t *testing.T) {
	drift := rpcResponse{Status: 200, Body: []byte(")]}'\n[null,null,[[\"not\",\"a\",\"review\"]]]")}
	tr := &fakeTransport{steps: map[string]map[string][]step{
		proxyA: {"tok:": {{resp: page(t, "t2", "r1")}}, "tok:t2": {{resp: drift}}},
	}}
	c, _, _ := collector(ReviewConfig{}, nil, identityRoute(t, tr, proxyBrowser, proxyA, proxyB), nil)

	report := settle(c.run(context.Background(), 5), nil)

	assert.Equal(t, stopParseError, report.StopReason)
	assert.Equal(t, 0, report.Restarts)
	assert.Equal(t, 0, report.IdentityRotations, "another address does not fix drift")
}

func TestATransientFailureSlowsTheRestOfTheRun(t *testing.T) {
	tr := &fakeTransport{steps: map[string]map[string][]step{
		proxyA: {
			"tok:":   {{err: errors.New("i/o timeout")}, {resp: page(t, "t2", "r1")}},
			"tok:t2": {{resp: page(t, "t3", "r2")}},
			"tok:t3": {{resp: page(t, "", "r3")}},
		},
	}}
	c, slept, _ := collector(ReviewConfig{PageDelay: 500 * time.Millisecond}, nil,
		identityRoute(t, tr, proxyBrowser, proxyA, proxyB), nil)

	report := settle(c.run(context.Background(), 3), nil)

	assert.Equal(t, stopDone, report.StopReason)
	assert.Equal(t, 0, report.IdentityRotations, "a timeout is retried as the same identity")
	// The retry's backoff, then the pages after it at the doubled pace.
	assert.Equal(t, []time.Duration{2 * time.Second, time.Second, time.Second}, *slept)
}

func TestPacingNeverExceedsItsCeiling(t *testing.T) {
	c, _, _ := collector(ReviewConfig{PageDelay: 6 * time.Second}, nil, nil, nil)
	c.pace = c.cfg.PageDelay

	for range 5 {
		if c.pace < maxPageDelay {
			c.pace = min(maxPageDelay, max(c.pace*2, time.Second))
		}
	}

	assert.Equal(t, maxPageDelay, c.pace)
}

func TestRandomJitterStaysUnderItsBound(t *testing.T) {
	for range 100 {
		j := randomJitter(time.Second)
		assert.GreaterOrEqual(t, j, time.Duration(0))
		assert.Less(t, j, time.Second)
	}

	assert.Equal(t, time.Duration(0), randomJitter(0))
}

func TestWithProxiesTheHTTPRouteIsTheIdentityClient(t *testing.T) {
	c := newReviewCollector(ReviewConfig{Proxies: []string{proxyA, proxyB}}, nil, "https://maps")
	_, ok := c.http.(*identityClient)
	assert.True(t, ok)

	bad := newReviewCollector(ReviewConfig{Proxies: []string{"::not a url"}}, nil, "https://maps")
	assert.Nil(t, bad.http, "a bad proxy file never falls back to going without one")
}
