package gmaps

import (
	"context"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// forwardProxy is a proxy of the test's own: it tunnels CONNECT and forwards absolute-URI requests,
// and records the credentials and targets it was asked for. Everything stays on localhost.
type forwardProxy struct {
	mu      sync.Mutex
	auths   []string
	targets []string
}

func (p *forwardProxy) record(r *http.Request) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.auths = append(p.auths, r.Header.Get("Proxy-Authorization"))
	p.targets = append(p.targets, r.Host)
}

func (p *forwardProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p.record(r)

	if r.Method == http.MethodConnect {
		upstream, err := net.DialTimeout("tcp", r.Host, 5*time.Second)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		hj, ok := w.(http.Hijacker)
		if !ok {
			http.Error(w, "no hijack", http.StatusInternalServerError)
			return
		}
		client, buf, err := hj.Hijack()
		if err != nil {
			return
		}
		_, _ = client.Write([]byte("HTTP/1.1 200 Connection established\r\n\r\n"))
		go func() {
			if buf.Reader.Buffered() > 0 {
				pending, _ := buf.Reader.Peek(buf.Reader.Buffered())
				_, _ = upstream.Write(pending)
			}
			_, _ = io.Copy(upstream, client)
			_ = upstream.Close()
		}()
		_, _ = io.Copy(client, upstream)
		_ = client.Close()
		return
	}

	out, err := http.NewRequestWithContext(r.Context(), r.Method, r.URL.String(), r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	for k, vs := range r.Header {
		if strings.EqualFold(k, "Proxy-Authorization") {
			continue
		}
		for _, v := range vs {
			out.Header.Add(k, v)
		}
	}
	resp, err := (&http.Transport{}).RoundTrip(out)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	for k, vs := range resp.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

// fakeGoogle stands in for the review endpoint: it sets a cookie, reports what it was sent, and
// redirects one path to a /sorry/ page.
func fakeGoogle(t *testing.T) (*httptest.Server, *[]http.Header) {
	t.Helper()

	var mu sync.Mutex
	seen := []http.Header{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen = append(seen, r.Header.Clone())
		mu.Unlock()

		switch r.URL.Path {
		case "/first":
			http.SetCookie(w, &http.Cookie{Name: "NID", Value: "visitor-1", Path: "/"})
			_, _ = w.Write([]byte(")]}'\n[null,null,[]]"))
		case "/sorry":
			http.Redirect(w, r, "/sorry/index?continue=x", http.StatusFound)
		default:
			_, _ = w.Write([]byte(")]}'\n[null,null,[]]"))
		}
	}))
	t.Cleanup(srv.Close)

	return srv, &seen
}

func TestTheRealTransportGoesOnlyThroughTheIdentitysProxy(t *testing.T) {
	proxy := &forwardProxy{}
	proxySrv := httptest.NewServer(proxy)
	t.Cleanup(proxySrv.Close)
	google, seen := fakeGoogle(t)

	id := &reviewIdentity{
		proxy:     "http://alice:s3cret@" + strings.TrimPrefix(proxySrv.URL, "http://"),
		userAgent: "UA-identity-a",
	}
	t.Cleanup(func() {
		if id.session != nil {
			id.session.Close()
		}
	})
	tr := azuretlsTransport{}
	ctx := context.Background()

	first, err := tr.do(ctx, id, google.URL+"/first")
	require.NoError(t, err)
	assert.Equal(t, 200, first.Status)
	assert.True(t, strings.HasPrefix(string(first.Body), ")]}'"))

	_, err = tr.do(ctx, id, google.URL+"/second")
	require.NoError(t, err)

	sorry, err := tr.do(ctx, id, google.URL+"/sorry")
	require.NoError(t, err)
	assert.Equal(t, http.StatusFound, sorry.Status, "a redirect is returned, not followed")
	assert.Contains(t, sorry.FinalURL, "/sorry/index")
	verdict, _ := classifyRPC(sorry, nil)
	assert.Equal(t, verdictBlocked, verdict)

	// Every request reached the target through the proxy, with this identity's credentials.
	host := strings.TrimPrefix(google.URL, "http://")
	want := "Basic " + base64.StdEncoding.EncodeToString([]byte("alice:s3cret"))
	proxy.mu.Lock()
	require.NotEmpty(t, proxy.targets)
	for n, target := range proxy.targets {
		assert.Equal(t, host, target)
		assert.Equal(t, want, proxy.auths[n])
	}
	proxy.mu.Unlock()

	// The identity's cookies and user agent went with it.
	require.Len(t, *seen, 3)
	assert.Equal(t, "UA-identity-a", (*seen)[1].Get("User-Agent"))
	assert.Contains(t, (*seen)[1].Get("Cookie"), "NID=visitor-1")
}

func TestTheRealTransportNeverFallsBackToADirectConnection(t *testing.T) {
	google, seen := fakeGoogle(t)

	// A proxy address nothing listens on.
	dead, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := dead.Addr().String()
	require.NoError(t, dead.Close())

	id := &reviewIdentity{proxy: "http://alice:s3cret@" + addr, userAgent: "UA"}
	t.Cleanup(func() {
		if id.session != nil {
			id.session.Close()
		}
	})

	_, err = azuretlsTransport{}.do(context.Background(), id, google.URL+"/first")
	assert.Error(t, err)
	assert.Empty(t, *seen, "the target was never reached without the proxy")
}
