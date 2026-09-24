package gmaps

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/gosom/scrapemate"
	"github.com/gosom/scrapemate/adapters/fetchers/stealth"
)

// ReviewConfig is how one run collects reviews. The zero value is today's behaviour: the default
// cap, no proxies, the default budget and pacing.
type ReviewConfig struct {
	// Proxies are the run's proxy URLs (`-proxies`/`-proxies-file`). With any configured, no review
	// request may leave without one, so the proxy-less HTTP stage is not used.
	Proxies []string
	// Budget is the wall clock for one place's whole review path. It must sit under whatever kills
	// the process from outside (`collect.sh`'s COLLECTOR_TIMEOUT_SECONDS), or the kill lands before
	// the entry is written and the collection is lost rather than partial.
	Budget time.Duration
	// MaxReviews is the most reviews one collection keeps beyond the inline ones.
	MaxReviews int
	// PageDelay is the pause between two RPC pages.
	PageDelay time.Duration
}

const (
	defaultReviewBudget    = 16 * time.Minute
	defaultReviewPageDelay = 500 * time.Millisecond
	// A transient failure is retried this many times on the same stage before it counts.
	transientRetries = 2
)

func (c ReviewConfig) withDefaults() ReviewConfig {
	if c.Budget <= 0 {
		c.Budget = defaultReviewBudget
	}
	if c.MaxReviews <= 0 {
		c.MaxReviews = defaultReviewCap
	}
	if c.PageDelay < 0 {
		c.PageDelay = 0
	} else if c.PageDelay == 0 {
		c.PageDelay = defaultReviewPageDelay
	}
	return c
}

// rpcFetcher fetches one review-endpoint URL through one route: the browser page, or an HTTP
// client. It reports what came back and leaves judging it to `classifyRPC`.
type rpcFetcher interface {
	fetchPage(ctx context.Context, url string) (rpcResponse, error)
}

// domExtractor scrolls the public review panel (`extractReviewsFromPage` in production).
type domExtractor func(ctx context.Context, known *reviewSet, target, cap int) []DOMReview

// reviewResult is what the review path hands to `PlaceJob.Process`: the rows beyond the inline
// reviews, and the report to settle once those are counted in.
type reviewResult struct {
	Rows   []Review
	Report ReviewCollection
}

type reviewCollector struct {
	cfg ReviewConfig

	browser rpcFetcher
	http    rpcFetcher
	dom     domExtractor
	urlFor  func(token, requestID string) (string, error)

	now   func() time.Time
	sleep func(ctx context.Context, d time.Duration) error
	newID func() (string, error)
}

// newReviewCollector wires the production seams for one place page.
func newReviewCollector(cfg ReviewConfig, page scrapemate.BrowserPage, mapURL string) *reviewCollector {
	cfg = cfg.withDefaults()
	c := &reviewCollector{
		cfg: cfg,
		urlFor: func(token, requestID string) (string, error) {
			return reviewPageURL(mapURL, token, requestID, 20)
		},
		now:   time.Now,
		sleep: sleepCtx,
		newID: func() (string, error) { return generateRandomID(21) },
	}
	if page != nil {
		c.browser = pageRPC{page: page}
		c.dom = func(ctx context.Context, known *reviewSet, target, cap int) []DOMReview {
			return extractReviewsFromPage(ctx, page, known, target, cap)
		}
	}
	// Proxy-less HTTP calls Google from this machine's own address. With proxies configured that
	// is exactly what the operator ruled out, so it is not offered; B3 replaces it with an
	// identity-bound client that goes through them.
	if len(cfg.Proxies) == 0 {
		c.http = stealthRPC{client: stealth.New("firefox", nil)}
	}
	return c
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return ctx.Err()
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// rpcCursor is where pagination has got to, shared by the RPC stages so a later one carries on
// from the page an earlier one stopped at instead of starting over.
type rpcCursor struct {
	token     string
	requestID string
	seen      map[string]bool
}

// stageOutcome is how one stage ended: a stop reason, and a detail when it did not end cleanly.
type stageOutcome struct {
	reason string
	detail string
}

// run collects one place's reviews through each available stage in turn until the listing is
// read, the budget or cap is reached, or every stage has been refused. Everything collected is
// kept on every path out; no stage swallows a failure without it reaching the report.
func (c *reviewCollector) run(ctx context.Context, reported int) reviewResult {
	start := c.now()
	deadline := start.Add(c.cfg.Budget)
	ctx, cancel := context.WithDeadline(ctx, time.Now().Add(c.cfg.Budget))
	defer cancel()

	set := newReviewSet(nil, c.cfg.MaxReviews)
	report := ReviewCollection{
		Reported:      reported,
		ReportedKnown: reported > 0,
		BudgetSeconds: c.cfg.Budget.Seconds(),
		Stages:        []string{},
	}

	var last stageOutcome
	finish := func(o stageOutcome, stage string) reviewResult {
		report.StopReason, report.StopStage, report.StopDetail = o.reason, stage, o.detail
		if !report.ReportedKnown && (o.reason == stopExhausted || o.reason == stopDone) {
			report.StopReason = stopCountUnknown
		}
		report.ElapsedSeconds = c.now().Sub(start).Seconds()
		return reviewResult{Rows: set.extended(), Report: report}
	}

	requestID, err := c.newID()
	if err != nil {
		return finish(stageOutcome{reason: stopError, detail: "no request id: " + err.Error()}, stageRPCBrowser)
	}
	cursor := &rpcCursor{requestID: requestID, seen: map[string]bool{}}

	lastStage := ""
	for _, st := range []struct {
		name string
		f    rpcFetcher
	}{{stageRPCBrowser, c.browser}, {stageRPCHTTP, c.http}} {
		if st.f == nil {
			continue
		}
		report.Stages = append(report.Stages, st.name)
		lastStage = st.name
		last = c.runRPCStage(ctx, deadline, st.f, set, cursor, reported, &report)
		if last.reason == stopExhausted || last.reason == stopCap || last.reason == stopBudget ||
			last.reason == stopParseError {
			break
		}
		log.Printf("review stage %s stopped (%s: %s); trying the next", st.name, last.reason, last.detail)
	}

	switch last.reason {
	case stopCap, stopBudget:
		return finish(last, lastStage)
	}
	if lastStage == "" {
		last = stageOutcome{reason: stopError, detail: "no review route available"}
	}

	// With a known count, DOM makes up what RPC left short. With an unknown one there is no target
	// to fall short of: a clean end of pagination read the whole listing, and DOM runs only when
	// RPC did not get that far.
	needMore := (report.ReportedKnown && set.distinct() < reported) ||
		(!report.ReportedKnown && last.reason != stopExhausted)
	if needMore && c.dom != nil && !c.pastDeadline(ctx, deadline) {
		report.Stages = append(report.Stages, stageDOM)
		dom := c.dom(ctx, set, reported, c.cfg.MaxReviews)
		for _, r := range ConvertDOMReviewsToReviews(dom) {
			if set.add(r) {
				report.DOMReviews++
			}
		}
		switch {
		case c.pastDeadline(ctx, deadline):
			return finish(stageOutcome{reason: stopBudget}, stageDOM)
		case set.len() >= c.cfg.MaxReviews:
			return finish(stageOutcome{reason: stopCap}, stageDOM)
		case report.ReportedKnown && set.distinct() >= reported:
			return finish(stageOutcome{reason: stopExhausted}, stageDOM)
		case last.reason == stopExhausted:
			return finish(stageOutcome{reason: stopExhausted}, stageDOM)
		}
		// DOM could not make up what the RPC stages were refused: the refusal is the reason.
		return finish(last, lastStage)
	}

	return finish(last, lastStage)
}

func (c *reviewCollector) pastDeadline(ctx context.Context, deadline time.Time) bool {
	return ctx.Err() != nil || !c.now().Before(deadline)
}

// runRPCStage pages through the review endpoint with one fetcher, from wherever the cursor is.
func (c *reviewCollector) runRPCStage(ctx context.Context, deadline time.Time, f rpcFetcher,
	set *reviewSet, cursor *rpcCursor, reported int, report *ReviewCollection) stageOutcome {
	budgetPages := reviewPageBudget(reported, c.cfg.MaxReviews)

	for {
		if c.pastDeadline(ctx, deadline) {
			return stageOutcome{reason: stopBudget}
		}
		if report.RPCPages >= budgetPages {
			return stageOutcome{reason: stopExhausted, detail: "page budget reached"}
		}

		url, err := c.urlFor(cursor.token, cursor.requestID)
		if err != nil {
			return stageOutcome{reason: stopError, detail: scrubDetail(err.Error())}
		}

		page, outcome, ok := c.fetchOnePage(ctx, deadline, f, url, report)
		if !ok {
			return outcome
		}

		report.RPCPages++
		report.RPCReviews += set.addPage(page)

		if set.len() >= c.cfg.MaxReviews {
			return stageOutcome{reason: stopCap}
		}
		if page.NextToken == "" || cursor.seen[page.NextToken] {
			return stageOutcome{reason: stopExhausted}
		}
		cursor.seen[page.NextToken] = true
		cursor.token = page.NextToken

		if err := c.sleep(ctx, c.cfg.PageDelay); err != nil {
			return stageOutcome{reason: stopBudget}
		}
	}
}

// fetchOnePage fetches and parses one page, retrying a transient failure on the same route. It
// returns the page, or the outcome that ends the stage.
func (c *reviewCollector) fetchOnePage(ctx context.Context, deadline time.Time, f rpcFetcher,
	url string, report *ReviewCollection) (rpcPage, stageOutcome, bool) {
	for attempt := 0; ; attempt++ {
		resp, err := f.fetchPage(ctx, url)
		verdict, detail := classifyRPC(resp, err)

		switch verdict {
		case verdictOK:
			page, perr := parseRPCPage(resp.Body)
			if perr != nil {
				return rpcPage{}, stageOutcome{reason: stopParseError, detail: perr.Error()}, false
			}
			return page, stageOutcome{}, true
		case verdictBlocked:
			report.Blocks++
			return rpcPage{}, stageOutcome{reason: stopBlocked, detail: detail}, false
		case verdictInvalid:
			return rpcPage{}, stageOutcome{reason: stopError, detail: detail}, false
		}

		// Transient.
		if c.pastDeadline(ctx, deadline) {
			return rpcPage{}, stageOutcome{reason: stopBudget}, false
		}
		if attempt >= transientRetries {
			return rpcPage{}, stageOutcome{reason: stopError, detail: detail}, false
		}
		if err := c.sleep(ctx, time.Duration(2<<attempt)*time.Second); err != nil {
			return rpcPage{}, stageOutcome{reason: stopBudget}, false
		}
	}
}

// pageRPC fetches through the place page itself, carrying its cookies and its proxy. The script
// always answers with the status, final URL and body, so a refusal is judged the same way
// whichever route met it.
type pageRPC struct {
	page scrapemate.BrowserPage
}

func (p pageRPC) fetchPage(_ context.Context, url string) (rpcResponse, error) {
	quoted, err := json.Marshal(url)
	if err != nil {
		return rpcResponse{}, err
	}

	script := fmt.Sprintf(`async () => {
		try {
			const r = await fetch(%s, {
				method: 'GET',
				credentials: 'include',
				headers: {'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9'}
			});
			return {status: r.status, url: r.url, text: await r.text()};
		} catch (e) {
			return {status: 0, url: '', text: '', error: String(e)};
		}
	}`, quoted)

	result, err := p.page.Eval(script)
	if err != nil {
		return rpcResponse{}, fmt.Errorf("browser fetch failed: %w", err)
	}

	return decodePageRPC(result)
}

// decodePageRPC reads the object `pageRPC`'s script returns.
func decodePageRPC(result any) (rpcResponse, error) {
	m, ok := result.(map[string]any)
	if !ok {
		return rpcResponse{}, fmt.Errorf("browser fetch returned %T", result)
	}
	if msg, _ := m["error"].(string); msg != "" {
		return rpcResponse{}, errors.New("browser fetch: " + msg)
	}

	resp := rpcResponse{}
	switch s := m["status"].(type) {
	case float64:
		resp.Status = int(s)
	case int:
		resp.Status = s
	}
	resp.FinalURL, _ = m["url"].(string)
	if text, ok := m["text"].(string); ok {
		resp.Body = []byte(text)
	}
	return resp, nil
}

// stealthRPC is the proxy-less HTTP route: a browser-shaped TLS client, no cookies, this machine's
// own address. Offered only when the run has no proxies.
type stealthRPC struct {
	client scrapemate.HTTPFetcher
}

func (s stealthRPC) fetchPage(ctx context.Context, url string) (rpcResponse, error) {
	resp := s.client.Fetch(ctx, &scrapemate.Job{Method: "GET", URL: url})
	if resp.Error != nil {
		return rpcResponse{}, resp.Error
	}
	return rpcResponse{Status: resp.StatusCode, FinalURL: resp.URL, Body: resp.Body}, nil
}
