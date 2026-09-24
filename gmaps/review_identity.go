package gmaps

import (
	"errors"
	"fmt"
	"log"
	"net/url"
	"sync"

	"github.com/Noooste/azuretls-client"
)

// Chrome user agents matching the TLS fingerprint azuretls presents (`azuretls.Chrome`). One is
// bound to each identity for its whole life, so an address never changes browser mid-conversation.
var reviewUserAgents = []string{
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
}

// reviewIdentity is one way of looking like one visitor: a proxy, a user agent, and -- once it has
// made a request -- that visitor's cookies. All of it is replaced together on a rotation; nothing
// is carried from one identity to the next, so Google never sees one visitor's cookies arrive from
// another's address.
type reviewIdentity struct {
	proxy     string
	userAgent string
	blocked   bool

	// session is the identity's own TLS client, proxy and cookie jar, made on first use.
	session *azuretls.Session
}

// String names the identity without its proxy credentials, for logs.
func (i *reviewIdentity) String() string {
	u, err := url.Parse(i.proxy)
	if err != nil || u.Host == "" {
		return "identity via [unparseable proxy]"
	}
	return "identity via " + u.Scheme + "://" + u.Host
}

var errNoProxies = errors.New("no proxies to build review identities from")

// identityPool is the run's identities, one per proxy, and which one is in use.
type identityPool struct {
	mu  sync.Mutex
	ids []*reviewIdentity
	cur int
}

// newIdentityPool makes one identity per proxy URL (the `-proxies-file` format). It starts at the
// second proxy when there is more than one: the browser holds the first, and the HTTP stage runs
// after the browser's own requests were refused -- the same address is the least likely to work.
func newIdentityPool(proxies []string) (*identityPool, error) {
	if len(proxies) == 0 {
		return nil, errNoProxies
	}

	ids := make([]*reviewIdentity, 0, len(proxies))
	for n, raw := range proxies {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || u.Scheme == "" {
			return nil, fmt.Errorf("proxy %d is not a proxy URL", n+1)
		}
		ids = append(ids, &reviewIdentity{
			proxy:     raw,
			userAgent: reviewUserAgents[n%len(reviewUserAgents)],
		})
	}

	return &identityPool{ids: ids, cur: 1 % len(ids)}, nil
}

func (p *identityPool) current() *reviewIdentity {
	p.mu.Lock()
	defer p.mu.Unlock()

	return p.ids[p.cur]
}

// rotate retires the identity in use -- Google refused it -- and moves to the next one that has
// not been refused. False when every identity has been.
func (p *identityPool) rotate() bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.ids[p.cur].blocked = true
	for step := 1; step <= len(p.ids); step++ {
		next := (p.cur + step) % len(p.ids)
		if !p.ids[next].blocked {
			p.cur = next
			return true
		}
	}

	return false
}

// close ends every identity's session.
func (p *identityPool) close() {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, id := range p.ids {
		if id.session != nil {
			id.session.Close()
			id.session = nil
		}
	}
}

// identityClient is the HTTP review route with proxies: every request leaves through the current
// identity's proxy, and `rotate` moves to the next identity when Google refuses this one. It never
// makes a request without a proxy -- it cannot be built without them.
type identityClient struct {
	pool *identityPool
	tr   rpcTransport
}

func newIdentityClient(proxies []string, tr rpcTransport) (*identityClient, error) {
	pool, err := newIdentityPool(proxies)
	if err != nil {
		return nil, err
	}
	return &identityClient{pool: pool, tr: tr}, nil
}

func (c *identityClient) rotate() bool {
	from := c.pool.current()
	ok := c.pool.rotate()
	if ok {
		log.Printf("review identity refused (%s); rotating to %s", from, c.pool.current())
	} else {
		log.Printf("review identity refused (%s); every identity has been refused", from)
	}
	return ok
}

func (c *identityClient) close() { c.pool.close() }
