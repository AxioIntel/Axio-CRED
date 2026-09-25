package gmaps

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"
)

// When Google refuses a page -- a 429, a 403, a redirect to its /sorry/ page, or its "unusual
// traffic" / CAPTCHA page -- the search or place job fails with ErrGoogleBlocked instead of
// quietly finding nothing, so the scraper retries it (usually on another browser, and so another
// proxy) and every job's next page waits out a shared back-off. Nothing here solves or gets
// around a CAPTCHA: a refused page is given up and tried again later, more slowly.

// ErrGoogleBlocked is a page Google refused.
var ErrGoogleBlocked = errors.New("google refused the page (unusual traffic / captcha / rate limit)")

const (
	blockBackoffBase = 20 * time.Second
	blockBackoffMax  = 5 * time.Minute
	blockWindow      = 10 * time.Minute
)

// BlockGuard counts Google's refusals and holds back new page loads after one: 20 s after the
// first, doubling with each refusal in a row, up to 5 minutes. A page that loads resets the run.
type BlockGuard struct {
	mu          sync.Mutex
	events      []time.Time
	consecutive int
	until       time.Time
	total       int
	now         func() time.Time
}

// Blocks is the process's guard, shared by every search and place job.
var Blocks = &BlockGuard{}

func (g *BlockGuard) clock() time.Time {
	if g.now != nil {
		return g.now()
	}

	return time.Now()
}

// Refused records a refused page and extends the back-off.
func (g *BlockGuard) Refused() {
	g.mu.Lock()
	defer g.mu.Unlock()

	now := g.clock()
	g.events = append(g.events, now)
	g.consecutive++
	g.total++

	backoff := min(blockBackoffBase<<min(g.consecutive-1, 5), blockBackoffMax)
	if t := now.Add(backoff); t.After(g.until) {
		g.until = t
	}
}

// Loaded records a page that came back, ending a run of refusals.
func (g *BlockGuard) Loaded() {
	g.mu.Lock()
	defer g.mu.Unlock()

	g.consecutive = 0
}

// Wait holds a page load until the back-off has passed (or ctx ends).
func (g *BlockGuard) Wait(ctx context.Context) error {
	g.mu.Lock()
	d := g.until.Sub(g.clock())
	g.mu.Unlock()

	if d <= 0 {
		return nil
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

// BlockStats is what the dashboard shows.
type BlockStats struct {
	Recent  int           // refusals in the last 10 minutes
	Total   int           // since the process started
	Backoff time.Duration // how long new page loads are still held back
}

// Stats reports the guard's state.
func (g *BlockGuard) Stats() BlockStats {
	g.mu.Lock()
	defer g.mu.Unlock()

	now := g.clock()
	cut := 0

	for cut < len(g.events) && now.Sub(g.events[cut]) > blockWindow {
		cut++
	}

	g.events = g.events[cut:]

	return BlockStats{Recent: len(g.events), Total: g.total, Backoff: max(0, g.until.Sub(now)).Truncate(time.Second)}
}

// blockMarkers are what Google's refusal pages say, lower-cased.
var blockMarkers = []string{
	"our systems have detected unusual traffic",
	"id=\"captcha-form\"",
	"g-recaptcha",
	"/sorry/index",
}

// refusedByResponse is a refusal visible from the response alone.
func refusedByResponse(status int, url string) bool {
	return status == 429 || status == 403 || strings.Contains(url, "google.com/sorry") || strings.Contains(url, "/sorry/index")
}

// refusedByContent is a refusal visible only in the page: Google often serves its "unusual
// traffic" page with a 200.
func refusedByContent(html string) bool {
	lower := strings.ToLower(html)

	for _, m := range blockMarkers {
		if strings.Contains(lower, m) {
			return true
		}
	}

	return false
}
