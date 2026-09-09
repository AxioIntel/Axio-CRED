package gmaps

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gosom/scrapemate"
	"github.com/gosom/scrapemate/adapters/fetchers/stealth"
)

//go:embed review_dom.js
var reviewDOMScript string

type fetchReviewsParams struct {
	page        scrapemate.BrowserPage
	mapURL      string
	reviewCount int
}

type FetchReviewsResponse struct {
	pages [][]byte
}

type fetcher struct {
	httpClient scrapemate.HTTPFetcher
	params     fetchReviewsParams
}

func newReviewFetcher(params fetchReviewsParams) *fetcher {
	netClient := stealth.New("firefox", nil)
	ans := fetcher{
		params:     params,
		httpClient: netClient,
	}

	return &ans
}

// reviewPageBudget accommodates reported totals over 1,000, with a safety ceiling.
func reviewPageBudget(count int) int {
	if count <= 0 {
		return 100
	}
	pages := (count+19)/20 + 2
	if pages > 250 {
		return 250
	}
	return pages
}

func (f *fetcher) fetch(ctx context.Context) (FetchReviewsResponse, error) {
	requestIDForSession, err := generateRandomID(21)
	if err != nil {
		return FetchReviewsResponse{}, fmt.Errorf("failed to generate session request ID: %v", err)
	}

	reviewURL, err := f.generateURL(f.params.mapURL, "", 20, requestIDForSession)
	if err != nil {
		return FetchReviewsResponse{}, fmt.Errorf("failed to generate initial URL: %v", err)
	}

	// First, try to fetch using the browser's session (has cookies/authentication)
	if f.params.page != nil {
		ans, err := f.fetchWithBrowser(ctx, reviewURL, requestIDForSession)
		if err == nil && len(ans.pages) > 0 {
			return ans, nil
		}

		log.Printf("Browser-based RPC fetch failed: %v, trying HTTP", err)
	}

	// Fallback to direct HTTP (may fail due to lack of authentication)
	currentPageBody, err := f.fetchReviewPage(ctx, reviewURL)
	if err != nil {
		log.Printf("RPC fetch failed, will try DOM extraction: %v", err)
		return FetchReviewsResponse{}, err
	}

	ans := FetchReviewsResponse{}
	ans.pages = append(ans.pages, currentPageBody)

	nextPageToken := extractNextPageToken(currentPageBody)

	seenTokens := map[string]bool{}
	for nextPageToken != "" && len(ans.pages) < reviewPageBudget(f.params.reviewCount) {
		if ctx.Err() != nil || seenTokens[nextPageToken] {
			break
		}
		seenTokens[nextPageToken] = true
		reviewURL, err = f.generateURL(f.params.mapURL, nextPageToken, 20, requestIDForSession)
		if err != nil {
			log.Printf("Error generating URL for token %s: %v", nextPageToken, err)
			break
		}

		currentPageBody, err = f.fetchReviewPage(ctx, reviewURL)
		if err != nil {
			log.Printf("Error fetching review page with token %s: %v", nextPageToken, err)
			break
		}

		ans.pages = append(ans.pages, currentPageBody)
		nextPageToken = extractNextPageToken(currentPageBody)
	}

	return ans, nil
}

// fetchWithBrowser uses Playwright to fetch the review API with browser cookies
func (f *fetcher) fetchWithBrowser(ctx context.Context, initialURL, requestID string) (FetchReviewsResponse, error) {
	ans := FetchReviewsResponse{}
	page := f.params.page

	// Use JavaScript fetch to get the reviews with proper cookies
	jsCode := fmt.Sprintf(`async () => {
		try {
			const response = await fetch('%s', {
				method: 'GET',
				credentials: 'include',
				headers: {
					'Accept': '*/*',
					'Accept-Language': 'en-US,en;q=0.9'
				}
			});
			if (!response.ok) {
				return { error: 'HTTP ' + response.status };
			}
			const text = await response.text();
			return { data: text };
		} catch (e) {
			return { error: e.message };
		}
	}`, initialURL)

	result, err := page.Eval(jsCode)
	if err != nil {
		return ans, fmt.Errorf("browser fetch failed: %w", err)
	}

	resultMap, ok := result.(map[string]interface{})
	if !ok {
		return ans, fmt.Errorf("unexpected result type: %T", result)
	}

	if errMsg, hasError := resultMap["error"]; hasError {
		return ans, fmt.Errorf("fetch error: %v", errMsg)
	}

	data, ok := resultMap["data"].(string)
	if !ok || len(data) < 10 {
		return ans, fmt.Errorf("empty response from browser fetch")
	}

	ans.pages = append(ans.pages, []byte(data))

	// Get additional pages
	nextPageToken := extractNextPageToken([]byte(data))
	seenTokens := map[string]bool{}
	for nextPageToken != "" && len(ans.pages) < reviewPageBudget(f.params.reviewCount) {
		if ctx.Err() != nil || seenTokens[nextPageToken] {
			break
		}
		seenTokens[nextPageToken] = true
		nextURL, err := f.generateURL(f.params.mapURL, nextPageToken, 20, requestID)
		if err != nil {
			break
		}

		jsCode = fmt.Sprintf(`async () => {
			try {
				const response = await fetch('%s', {
					method: 'GET',
					credentials: 'include'
				});
				if (!response.ok) {
					return { error: 'HTTP ' + response.status };
				}
				return { data: await response.text() };
			} catch (e) {
				return { error: e.message };
			}
		}`, nextURL)

		result, err = page.Eval(jsCode)
		if err != nil {
			break
		}

		resultMap, ok = result.(map[string]interface{})
		if !ok || resultMap["error"] != nil {
			break
		}

		data, ok = resultMap["data"].(string)
		if !ok || len(data) < 10 {
			break
		}

		ans.pages = append(ans.pages, []byte(data))
		nextPageToken = extractNextPageToken([]byte(data))
	}

	return ans, nil
}

var (
	patternsOnce sync.Once
	patterns     map[string]*regexp.Regexp
)

const hexMatchPattern = `0x[0-9a-fA-F]+:0x[0-9a-fA-F]+` // Hex format place ID

// extractPlaceID extracts the place ID from various Google Maps URL formats
func extractPlaceID(mapURL string) (string, error) {
	patternsOnce.Do(func() {
		patterns = make(map[string]*regexp.Regexp)
		// Try multiple patterns for extracting place ID
		avail := []string{
			`!1s([^!]+)`,                             // Standard format: !1s0x...
			`place_id=([^&]+)`,                       // Query parameter format
			`/place/[^/]+/@[^/]+/data=!.*!1s([^!]+)`, // Full place URL
			hexMatchPattern,                          // Hex format place ID
		}

		patterns = make(map[string]*regexp.Regexp)
		for _, p := range avail {
			patterns[p] = regexp.MustCompile(p)
		}
	})

	for pattern, re := range patterns {
		match := re.FindStringSubmatch(mapURL)
		if len(match) >= 2 {
			rawPlaceID, err := url.QueryUnescape(match[1])
			if err != nil {
				rawPlaceID = match[1]
			}

			return rawPlaceID, nil
		}
		// For hex format, match[0] is the full match
		if pattern == hexMatchPattern && len(match) >= 1 {
			return match[0], nil
		}
	}

	return "", fmt.Errorf("could not extract place ID from URL: %s", mapURL)
}

func (f *fetcher) generateURL(mapURL, pageToken string, pageSize int, requestID string) (string, error) {
	rawPlaceID, err := extractPlaceID(mapURL)
	if err != nil {
		return "", err
	}

	encodedPlaceID := url.QueryEscape(rawPlaceID)
	encodedPageToken := url.QueryEscape(pageToken)

	// Updated pb components based on current Google Maps API format (Dec 2025)
	pbComponents := []string{
		fmt.Sprintf("!1m6!1s%s", encodedPlaceID),
		"!6m4!4m1!1e1!4m1!1e3",
		fmt.Sprintf("!2m2!1i%d!2s%s", pageSize, encodedPageToken),
		fmt.Sprintf("!5m2!1s%s!7e81", requestID),
		"!8m9!2b1!3b1!5b1!7b1",
		"!12m4!1b1!2b1!4m1!1e1!11m0!13m1!1e1",
	}

	// Use English language for consistent parsing
	fullURL := fmt.Sprintf(
		"https://www.google.com/maps/rpc/listugcposts?authuser=0&hl=en&pb=%s",
		strings.Join(pbComponents, ""),
	)

	return fullURL, nil
}

func (f *fetcher) fetchReviewPage(ctx context.Context, u string) ([]byte, error) {
	job := scrapemate.Job{
		Method: "GET",
		URL:    u,
	}

	resp := f.httpClient.Fetch(ctx, &job)
	if resp.Error != nil {
		return nil, fmt.Errorf("fetch error for %s: %w", u, resp.Error)
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("%s: unexpected status code: %d", u, resp.StatusCode)
	}

	return resp.Body, nil
}

func extractNextPageToken(data []byte) string {
	text := string(data)
	prefix := ")]}'\n"
	text = strings.TrimPrefix(text, prefix)

	var result []interface{}

	err := json.Unmarshal([]byte(text), &result)
	if err != nil {
		return ""
	}

	if len(result) < 2 || result[1] == nil {
		return ""
	}

	token, ok := result[1].(string)
	if !ok {
		return ""
	}

	return token
}

func generateRandomID(length int) (string, error) {
	numBytes := (length*6 + 7) / 8
	if numBytes < 16 {
		numBytes = 16
	}

	b := make([]byte, numBytes)

	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}

	encoded := base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString(b)
	if len(encoded) >= length {
		return encoded[:length], nil
	}

	return "", errors.New("generated ID is shorter than expected")
}

// DOMReview represents a review extracted from the DOM
type DOMReview struct {
	ReviewID                string
	AuthorName              string
	AuthorURL               string
	ProfilePicture          string
	Rating                  int
	RelativeTimeDescription string
	Text                    string
	Images                  []string
	PublishedAt             string
	ReplyText               string
}

// mergeDOMReviews indexes identities once instead of comparing every loaded card
// with every prior card on each scroll. Distinct IDs always remain distinct.
func mergeDOMReviews(reviews, incoming []DOMReview, index map[string]int) []DOMReview {
	for _, next := range incoming {
		key := next.ReviewID
		if key == "" {
			data, _ := json.Marshal([]any{next.AuthorURL, next.AuthorName, next.Rating, next.RelativeTimeDescription, next.Text})
			key = fmt.Sprintf("fallback:%x", sha256.Sum256(data))
		}
		if i, ok := index[key]; ok {
			old := &reviews[i]
			if len(next.Text) > len(old.Text) {
				old.Text = next.Text
			}
			if next.AuthorURL != "" {
				old.AuthorURL = next.AuthorURL
			}
			if next.PublishedAt != "" {
				old.PublishedAt = next.PublishedAt
			}
			if next.ReplyText != "" {
				old.ReplyText = next.ReplyText
			}
			if len(next.Images) > len(old.Images) {
				old.Images = next.Images
			}
			continue
		}
		if len(reviews) >= 5000 {
			break
		}
		index[key] = len(reviews)
		reviews = append(reviews, next)
	}
	return reviews
}

// ConvertDOMReviewsToReviews converts DOMReview slice to Review slice
func ConvertDOMReviewsToReviews(domReviews []DOMReview) []Review {
	reviews := make([]Review, 0, len(domReviews))

	for i := range domReviews {
		dr := &domReviews[i]
		review := Review{
			Name:           dr.AuthorName,
			ProfilePicture: dr.ProfilePicture,
			Rating:         dr.Rating,
			Description:    dr.Text,
			When:           dr.RelativeTimeDescription,
			Images:         dr.Images,
			ReviewID:       dr.ReviewID,
			AuthorURL:      dr.AuthorURL,
			ReplyText:      dr.ReplyText,
			Source:         "Google Maps public page",
		}
		if published, err := time.Parse(time.RFC3339, dr.PublishedAt); err == nil && !published.Before(earliestReviewPublishedAt) && !published.After(time.Now().Add(reviewPublishedAtFutureSkew)) {
			review.PublishedAt = &published
		}

		if review.Name != "" || review.ReviewID != "" {
			reviews = append(reviews, review)
		}
	}

	return reviews
}

// dedupeDOMReviewsAgainstPrimary enriches primary records before dropping a DOM
// duplicate. Matching is by review id only; an empty id is never a duplicate.
func dedupeDOMReviewsAgainstPrimary(primary, domReviews []Review) []Review {
	seen := make(map[string]int, len(primary))

	for i := range primary {
		if primary[i].ReviewID != "" {
			seen[primary[i].ReviewID] = i
		}
	}

	if len(seen) == 0 {
		return domReviews
	}

	kept := make([]Review, 0, len(domReviews))
	withID := 0

	for i := range domReviews {
		if domReviews[i].ReviewID != "" {
			withID++

			if j, dup := seen[domReviews[i].ReviewID]; dup {
				old, next := &primary[j], &domReviews[i]
				if len(next.Description) > len(old.Description) {
					old.Description = next.Description
				}
				if old.AuthorURL == "" {
					old.AuthorURL = next.AuthorURL
				}
				if old.ReplyText == "" {
					old.ReplyText = next.ReplyText
				}
				if old.PublishedAt == nil {
					old.PublishedAt = next.PublishedAt
				}
				if len(next.Images) > len(old.Images) {
					old.Images = next.Images
				}
				continue
			}
		}

		kept = append(kept, domReviews[i])
	}

	if withID > 0 && len(kept) == len(domReviews) {
		log.Printf("DOM review ids matched none of %d primary ids", len(seen))
	}

	return kept
}

func decodeDOMReviews(raw []any) []DOMReview {
	decoded := make([]DOMReview, 0, len(raw))

	for _, rawReview := range raw {
		reviewMap, ok := rawReview.(map[string]interface{})
		if !ok {
			continue
		}

		review := DOMReview{}
		if v, ok := reviewMap["published_at"].(string); ok {
			review.PublishedAt = v
		}
		if v, ok := reviewMap["reply_text"].(string); ok {
			review.ReplyText = v
		}
		if v, ok := reviewMap["review_id"].(string); ok {
			review.ReviewID = v
		}

		if v, ok := reviewMap["author_name"].(string); ok {
			review.AuthorName = v
		}

		if v, ok := reviewMap["author_url"].(string); ok {
			review.AuthorURL = v
		}

		if v, ok := reviewMap["profile_picture"].(string); ok {
			review.ProfilePicture = v
		}

		// Playwright decodes whole JS numbers as int, fractional ones as float64.
		switch v := reviewMap["rating"].(type) {
		case int:
			review.Rating = v
		case float64:
			review.Rating = int(v)
		}

		// The rating selectors also match non-star aria-labels, e.g. "12 reviews".
		if review.Rating < 1 || review.Rating > 5 {
			review.Rating = 0
		}

		if v, ok := reviewMap["relative_time_description"].(string); ok {
			review.RelativeTimeDescription = v
		}

		if v, ok := reviewMap["text"].(string); ok {
			review.Text = v
		}

		if v, ok := reviewMap["images"].([]interface{}); ok {
			for _, img := range v {
				if imgStr, ok := img.(string); ok {
					review.Images = append(review.Images, imgStr)
				}
			}
		}

		decoded = append(decoded, review)
	}

	return decoded
}

// extractReviewsFromPage extracts reviews directly from the page DOM
// This is a fallback when the RPC API fails
func extractReviewsFromPage(ctx context.Context, page scrapemate.BrowserPage, expectedCount int) ([]DOMReview, error) {
	log.Printf("Attempting DOM-based review extraction")

	// First, try to click the reviews section to open the reviews panel
	clickedReviews, _ := page.Eval(`() => {
		try {
			// Method 1: Click on the reviews count/link in the place info
			const reviewsButtons = document.querySelectorAll('button[jsaction*="reviewChart"], button[jsaction*="reviews"]');
			for (const btn of reviewsButtons) {
				if (btn.textContent.includes('review') || btn.getAttribute('aria-label')?.includes('review')) {
					btn.click();
					return 'reviews_button';
				}
			}

			// Method 2: Click on the reviews tab
			const tabs = document.querySelectorAll('button[role="tab"]');
			for (const tab of tabs) {
				const label = tab.getAttribute('aria-label') || tab.textContent || '';
				if (label.toLowerCase().includes('review')) {
					tab.click();
					return 'reviews_tab';
				}
			}

			// Method 3: Click the star rating area which often opens reviews
			const ratingArea = document.querySelector('.F7nice, .fontDisplayLarge');
			if (ratingArea) {
				ratingArea.click();
				return 'rating_area';
			}

			// Method 4: Look for "See all reviews" or similar links
			const allLinks = document.querySelectorAll('a, button');
			for (const link of allLinks) {
				const text = link.textContent?.toLowerCase() || '';
				if (text.includes('all review') || text.includes('see review') || text.includes('more review')) {
					link.click();
					return 'all_reviews_link';
				}
			}

			return false;
		} catch (e) {
			console.error('Error clicking reviews:', e);
			return false;
		}
	}`)

	if clickedReviews != nil && clickedReviews != false {
		log.Printf("Clicked reviews via: %v", clickedReviews)
	}

	// Wait for reviews panel to load
	time.Sleep(3 * time.Second)
	// Prefer the public UI's chronological ordering. If the control is unavailable,
	// retain the existing order and disclose it instead of claiming newest-first.
	sortOpened, _ := page.Eval(`() => {
        const button = [...document.querySelectorAll('button')].find(b => /sort reviews/i.test(b.getAttribute('aria-label') || ''));
        if (!button) return false;
        button.click(); return true;
    }`)
	if sortOpened == true {
		time.Sleep(time.Second)
		sorted, _ := page.Eval(`() => {
            const option = [...document.querySelectorAll('[role="menuitemradio"], [role="menuitem"], [role="option"]')].find(e => e.textContent.trim() === 'Newest');
            if (!option) return false;
            option.click(); return true;
        }`)
		log.Printf("Public review newest sort selected: %v", sorted == true)
		if sorted == true {
			time.Sleep(2 * time.Second)
		}
	}

	var reviews []DOMReview

	deadline := time.Now().Add(15 * time.Minute)
	reviewIndex := make(map[string]int)
	maxScrollAttempts := 1200
	lastCount := 0
	stuckCount := 0

	for attempt := 0; attempt < maxScrollAttempts; attempt++ {
		select {
		case <-ctx.Done():
			return reviews, nil
		default:
		}

		if time.Now().After(deadline) {
			log.Printf("Review time budget reached at %d reviews", len(reviews))
			break
		}
		// Extract reviews from the public review panel.
		reviewsJSON, err := page.Eval(reviewDOMScript)

		if err != nil {
			log.Printf("Error extracting reviews from DOM: %v", err)
		} else if reviewsJSON != nil {
			rawReviews, ok := reviewsJSON.([]any)
			if ok {
				decoded := decodeDOMReviews(rawReviews)

				reviews = mergeDOMReviews(reviews, decoded, reviewIndex)
			}
		}

		currentCount := len(reviews)
		if currentCount >= 5000 {
			log.Printf("Review safety limit reached at %d reviews", currentCount)
			break
		}
		if expectedCount > 0 && currentCount >= expectedCount {
			break
		}
		if currentCount == lastCount {
			stuckCount++
			if stuckCount >= 15 {
				log.Printf("Review count stuck at %d, stopping scroll", currentCount)
				break
			}
		} else {
			stuckCount = 0
			lastCount = currentCount
		}

		// Scroll the review's actual scrollable ancestor, not a layout sibling.
		_, _ = page.Eval(`() => {
            for (const review of document.querySelectorAll('[data-review-id], .jftiEf')) {
                if (!review.getClientRects().length) continue;
                for (let parent = review.parentElement; parent; parent = parent.parentElement) {
                    if (parent.clientHeight > 0 && parent.scrollHeight > parent.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(parent).overflowY)) {
                        parent.scrollBy(0, Math.max(800, parent.clientHeight * 0.9));
                        return true;
                    }
                }
            }
            return false;
        }`)

		select {
		case <-ctx.Done():
			return reviews, nil
		case <-time.After(time.Second):
		}
	}

	log.Printf("DOM extraction completed: %d reviews found", len(reviews))

	return reviews, nil
}

// FetchReviewsWithFallback attempts RPC-based extraction first, then falls back to DOM
func shouldSupplementRPC(collected, reported int) bool {
	return collected == 0 || (reported > collected && collected < 5000)
}

func FetchReviewsWithFallback(ctx context.Context, params fetchReviewsParams) (FetchReviewsResponse, []DOMReview, error) {
	fetcher := newReviewFetcher(params)

	// Try RPC-based extraction first
	rpcResponse, err := fetcher.fetch(ctx)
	if err == nil && len(rpcResponse.pages) > 0 {
		// Validate that we actually got reviews
		totalReviews := 0

		for _, page := range rpcResponse.pages {
			reviews := extractReviews(page)
			totalReviews += len(reviews)
		}

		if !shouldSupplementRPC(totalReviews, params.reviewCount) {
			log.Printf("RPC extraction successful: %d review pages, ~%d reviews", len(rpcResponse.pages), totalReviews)
			return rpcResponse, nil, nil
		}

		log.Printf("RPC coverage incomplete: %d of %d reported reviews; supplementing from public page", totalReviews, params.reviewCount)
	}

	// Fallback to DOM-based extraction
	if params.page != nil {
		domReviews, domErr := extractReviewsFromPage(ctx, params.page, params.reviewCount)
		if domErr == nil && len(domReviews) > 0 {
			log.Printf("DOM extraction successful: %d reviews", len(domReviews))
			return rpcResponse, domReviews, nil
		}

		if domErr != nil {
			log.Printf("DOM extraction failed: %v", domErr)
		}
	}

	// Return whatever we have
	if err != nil {
		return FetchReviewsResponse{}, nil, fmt.Errorf("all review extraction methods failed: %v", err)
	}

	return rpcResponse, nil, nil
}
