package gmaps

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

// Every public address a business lists is collected the way a person would find them: from its
// website's front page and from its own contact, about and team pages. Only pages of the business's
// own site are read, a few at most, and nothing is submitted to any of them.

const (
	// maxContactPages is how many pages beyond the front page are read for one business.
	maxContactPages = 4
	// maxEmailsPerBusiness caps what one site can contribute; a page listing hundreds of addresses
	// is a directory, not a business's contact details.
	maxEmailsPerBusiness = 25
	contactPageTimeout   = 15 * time.Second
	contactPageMaxBytes  = 2 << 20
)

// contactPageWords mark a link to the page a business keeps its contact details on.
var contactPageWords = []string{
	"contact", "about", "impressum", "kontakt", "contacto", "contatti", "nous-contacter",
	"get-in-touch", "reach-us", "team", "location",
}

// Addresses in text. Deliberately plain: the candidates are filtered by `usableEmail` afterwards.
var emailInText = regexp.MustCompile(`(?i)[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,24}`)

// junkEmailDomains are addresses that appear on business sites but are never the business's:
// site-builder and error-tracker plumbing, and template placeholders.
var junkEmailDomains = map[string]bool{
	"example.com": true, "example.org": true, "example.net": true, "domain.com": true,
	"yourdomain.com": true, "email.com": true, "yoursite.com": true,
	"sentry.io": true, "wixpress.com": true, "sentry-next.wixpress.com": true,
	"sentry.wixpress.com": true, "godaddy.com": true, "squarespace.com": true,
	"wordpress.com": true, "w3.org": true, "schema.org": true, "latofonts.com": true,
	"typekit.com": true, "mysite.com": true, "company.com": true, "website.com": true,
}

// junkEmailSuffixes are "addresses" that are really asset file names (logo@2x.png).
var junkEmailSuffixes = []string{
	".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".bmp", ".ico", ".css", ".js",
	".mp4", ".webm", ".pdf", ".woff", ".woff2", ".ttf",
}

var junkLocalParts = map[string]bool{
	"name": true, "your": true, "yourname": true, "you": true, "user": true, "username": true,
	"email": true, "someone": true, "john.doe": true, "johndoe": true, "test": true,
}

// usableEmail normalises a candidate and says whether it can be a business's contact address.
func usableEmail(raw string) (string, bool) {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(strings.TrimPrefix(s, "mailto:"), "MAILTO:")

	if i := strings.IndexAny(s, "?#"); i >= 0 {
		s = s[:i]
	}

	if decoded, err := url.PathUnescape(s); err == nil {
		s = decoded
	}

	s = strings.ToLower(strings.Trim(s, " \t\r\n.,;:<>()[]\"'"))

	at := strings.LastIndex(s, "@")
	if at <= 0 || at == len(s)-1 || strings.Count(s, "@") != 1 {
		return "", false
	}

	local, domain := s[:at], s[at+1:]

	if !emailInText.MatchString(s) || emailInText.FindString(s) != s {
		return "", false
	}

	if junkLocalParts[local] || junkEmailDomains[domain] || !strings.Contains(domain, ".") {
		return "", false
	}

	for _, suffix := range junkEmailSuffixes {
		if strings.HasSuffix(s, suffix) {
			return "", false
		}
	}

	// A hex-looking local part is a tracking id (sentry DSNs and the like), not a mailbox.
	if len(local) >= 24 && isHex(local) {
		return "", false
	}

	return s, true
}

func isHex(s string) bool {
	for _, r := range s {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}

	return true
}

// decodeCloudflareEmail reverses Cloudflare's email obfuscation: the first byte is a key XORed
// into every following byte. Many small-business sites sit behind it, and their address is then
// in the page only in this form.
func decodeCloudflareEmail(encoded string) (string, error) {
	b, err := hex.DecodeString(encoded)
	if err != nil || len(b) < 2 {
		return "", errors.New("not a cloudflare-encoded address")
	}

	key := b[0]
	out := make([]byte, len(b)-1)

	for i := 1; i < len(b); i++ {
		out[i-1] = b[i] ^ key
	}

	return string(out), nil
}

// emailsOnPage collects every usable address on one page: mailto links, Cloudflare-protected
// addresses, and addresses written in the page.
func emailsOnPage(doc *goquery.Document, body []byte) []string {
	var found []string

	add := func(raw string) {
		if e, ok := usableEmail(raw); ok {
			found = append(found, e)
		}
	}

	if doc != nil {
		doc.Find("a[href]").Each(func(_ int, s *goquery.Selection) {
			href, _ := s.Attr("href")

			switch {
			case strings.HasPrefix(strings.ToLower(href), "mailto:"):
				for _, part := range strings.Split(strings.SplitN(href[len("mailto:"):], "?", 2)[0], ",") {
					add(part)
				}
			case strings.Contains(href, "/cdn-cgi/l/email-protection#"):
				enc := href[strings.Index(href, "#")+1:]
				if e, err := decodeCloudflareEmail(enc); err == nil {
					add(e)
				}
			}
		})

		doc.Find("[data-cfemail]").Each(func(_ int, s *goquery.Selection) {
			enc, _ := s.Attr("data-cfemail")
			if e, err := decodeCloudflareEmail(enc); err == nil {
				add(e)
			}
		})
	}

	for _, m := range emailInText.FindAll(body, -1) {
		add(string(m))
	}

	return found
}

// rankEmails dedupes and orders addresses: the business's own domain first, then the rest, each in
// the order found; at most maxEmailsPerBusiness.
func rankEmails(found []string, siteHost string) []string {
	site := registrableHost(siteHost)
	seen := map[string]bool{}

	var own, other []string

	for _, e := range found {
		if seen[e] {
			continue
		}

		seen[e] = true

		if site != "" && registrableHost(e[strings.LastIndex(e, "@")+1:]) == site {
			own = append(own, e)
		} else {
			other = append(other, e)
		}
	}

	out := make([]string, 0, len(own)+len(other))
	out = append(out, own...)
	out = append(out, other...)

	if len(out) > maxEmailsPerBusiness {
		out = out[:maxEmailsPerBusiness]
	}

	return out
}

// registrableHost is a host without "www." and without subdomains beyond the last two labels (or
// three, for a two-letter country code under a short second level, like example.co.uk).
func registrableHost(host string) string {
	h := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(host), "www."))
	if i := strings.IndexByte(h, ':'); i >= 0 {
		h = h[:i]
	}

	labels := strings.Split(h, ".")
	if len(labels) <= 2 {
		return h
	}

	n := 2
	if tld := labels[len(labels)-1]; len(tld) == 2 && len(labels[len(labels)-2]) <= 3 {
		n = 3
	}

	return strings.Join(labels[len(labels)-n:], ".")
}

// contactPageLinks are links on the front page to the same site's contact-like pages, best first.
func contactPageLinks(doc *goquery.Document, base *url.URL) []string {
	if doc == nil || base == nil {
		return nil
	}

	type candidate struct {
		url   string
		score int
	}

	seen := map[string]bool{base.String(): true}

	var cands []candidate

	doc.Find("a[href]").Each(func(_ int, s *goquery.Selection) {
		href, _ := s.Attr("href")

		ref, err := url.Parse(strings.TrimSpace(href))
		if err != nil {
			return
		}

		u := base.ResolveReference(ref)
		u.Fragment = ""

		if (u.Scheme != "http" && u.Scheme != "https") || registrableHost(u.Host) != registrableHost(base.Host) {
			return
		}

		if ext := strings.ToLower(path.Ext(u.Path)); ext != "" && ext != ".html" && ext != ".htm" && ext != ".php" && ext != ".aspx" {
			return
		}

		haystack := strings.ToLower(u.Path + " " + s.Text())
		score := 0

		for i, w := range contactPageWords {
			if strings.Contains(haystack, w) {
				score = len(contactPageWords) - i

				break
			}
		}

		if score == 0 || seen[u.String()] {
			return
		}

		seen[u.String()] = true

		cands = append(cands, candidate{url: u.String(), score: score})
	})

	sort.SliceStable(cands, func(i, j int) bool { return cands[i].score > cands[j].score })

	out := make([]string, 0, maxContactPages)
	for _, c := range cands {
		if len(out) == maxContactPages {
			break
		}

		out = append(out, c.url)
	}

	return out
}

// pageFetcher reads one page of a business's own website.
type pageFetcher func(ctx context.Context, pageURL string) ([]byte, error)

var contactPageClient = &http.Client{
	Timeout: contactPageTimeout,
	CheckRedirect: func(_ *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}

		return nil
	},
}

// fetchSitePage is the production pageFetcher: a plain GET with a browser's user agent, a timeout
// and a size limit.
func fetchSitePage(ctx context.Context, pageURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, http.NoBody)
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "+
		"(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")

	resp, err := contactPageClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	if ct := resp.Header.Get("Content-Type"); ct != "" && !strings.Contains(ct, "html") {
		return nil, fmt.Errorf("not a page (%s)", ct)
	}

	return io.ReadAll(io.LimitReader(resp.Body, contactPageMaxBytes))
}

// guessedContactPaths are tried when the front page links to no contact-like page at all: many
// small-business sites have one that only their menu script links to.
var guessedContactPaths = []string{"/contact", "/contact-us", "/about", "/about-us"}

// findBusinessEmails is the whole search for one business: every address on the front page and on
// up to maxContactPages of its own contact, about and team pages, the business's own domain first.
func findBusinessEmails(ctx context.Context, siteURL string, doc *goquery.Document, body []byte,
	fetch pageFetcher) []string {
	base, _ := url.Parse(siteURL)

	host := ""
	if base != nil {
		host = base.Host
	}

	found := emailsOnPage(doc, body)
	if fetch == nil || base == nil {
		return rankEmails(found, host)
	}

	links := contactPageLinks(doc, base)
	if len(links) == 0 {
		for _, p := range guessedContactPaths {
			links = append(links, base.ResolveReference(&url.URL{Path: p}).String())
		}
	}

	for _, link := range links {
		page, err := fetch(ctx, link)
		if err != nil {
			continue
		}

		pageDoc, err := goquery.NewDocumentFromReader(strings.NewReader(string(page)))
		if err != nil {
			pageDoc = nil
		}

		found = append(found, emailsOnPage(pageDoc, page)...)
	}

	return rankEmails(found, host)
}
