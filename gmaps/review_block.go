package gmaps

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"
)

// rpcResponse is one answer from Google's review endpoint, however it was fetched: the status,
// the URL it finally landed on (a browser fetch follows redirects, so a /sorry/ page shows up
// here), and the body.
type rpcResponse struct {
	Status   int
	FinalURL string
	Body     []byte
}

type rpcVerdict int

const (
	verdictOK rpcVerdict = iota
	// verdictBlocked: Google refused this identity. Retrying it as-is will not help.
	verdictBlocked
	// verdictTransient: the request did not complete, or the server failed. Retrying may help.
	verdictTransient
	// verdictInvalid: an answer came back, but not a reviews page and not a recognisable block.
	verdictInvalid
)

// What a block page says, in any of the forms Google has served one. Matched case-insensitively
// against the start of a body that did not carry the reviews prefix.
var blockMarkers = []string{"unusual traffic", "/sorry/", "g-recaptcha", "captcha"}

// classifyRPC reads one response as ok, blocked, transient or invalid, with a short detail safe to
// write into the results. It never reads a 200 as ok on the status alone: a block page is often
// served with 200, and only the body tells them apart.
func classifyRPC(resp rpcResponse, err error) (verdict rpcVerdict, detail string) {
	if err != nil {
		return verdictTransient, scrubDetail(err.Error())
	}

	if strings.Contains(resp.FinalURL, "/sorry/") {
		return verdictBlocked, "redirected to Google's /sorry/ page"
	}

	switch {
	case resp.Status == 403 || resp.Status == 429:
		return verdictBlocked, fmt.Sprintf("HTTP %d", resp.Status)
	case resp.Status == 0 || resp.Status >= 500:
		return verdictTransient, fmt.Sprintf("HTTP %d", resp.Status)
	case resp.Status != 200:
		return verdictInvalid, fmt.Sprintf("HTTP %d", resp.Status)
	}

	if len(resp.Body) < 10 {
		return verdictInvalid, "empty body"
	}

	if !bytes.HasPrefix(resp.Body, []byte(")]}'")) {
		head := resp.Body
		if len(head) > 64<<10 {
			head = head[:64<<10]
		}

		lower := strings.ToLower(string(head))
		for _, marker := range blockMarkers {
			if strings.Contains(lower, marker) {
				return verdictBlocked, "block page (" + marker + ")"
			}
		}

		return verdictInvalid, "not a reviews response"
	}

	return verdictOK, ""
}

var proxyCredentials = regexp.MustCompile(`(https?|socks5h?)://[^\s/@]+:[^\s/@]+@`)

// scrubDetail keeps a stop detail short and free of proxy credentials, which a transport error
// can quote verbatim.
func scrubDetail(detail string) string {
	detail = proxyCredentials.ReplaceAllString(detail, "$1://[redacted]@")
	if len(detail) > 200 {
		detail = detail[:200]
	}

	return detail
}
