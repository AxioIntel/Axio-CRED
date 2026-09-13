# Outscraper fallback — local MVP

Implemented in merged PR #1, reviewed code `9bd026b`, on 2026-09-09. Not deployed. **Paid calls remain disabled at the user's request.** The existing local API key was preserved. No live Outscraper collection or credential-validation call was made; execution was tested with injected provider responses.

## Configuration

Server-only `app/.env`:

```dotenv
OUTSCRAPER_API_KEY=<existing private key>
OUTSCRAPER_ENABLED=false
OUTSCRAPER_MONTHLY_REVIEW_LIMIT=0
OUTSCRAPER_MAX_REVIEWS_PER_JOB=2000
```

A key alone never enables collection. Activation requires both `OUTSCRAPER_ENABLED=true` and a positive monthly review allowance, followed by a backend restart. Activation and a spend allowance have **not** been authorized. Do not place the key in frontend variables, browser storage, links, or requests from the browser.

The per-job setting is dormant, not an approved spending budget. Supported per-job range is 1–5,000 (the current import schema limit); monthly range is 1–1,000,000. Invalid/zero limits block submissions. These limits reserve requested review volume, **not dollars**, and cannot cap spending from other applications or the provider dashboard. Even a query returning no reviews can consume provider usage.

## Conditions

1. Run the repository scraper first. Existing snapshot caching remains available for non-refresh lookups.
2. Consider Outscraper only for an explicitly supplied, valid **exact Google Place ID**:
   - collector exception, timeout, blocked/empty collection; or
   - an explicit full-history request returns no reviews despite a nonzero/unknown total; or
   - full-history coverage is short by at least `max(5, ceil(reported reviews × 2%))`.
3. Ordinary partial snapshots do not trigger a coverage fallback. Neither do broad name searches, identity mismatches, malformed normalized results, storage failures, or cancellation/permission errors carrying recognized error codes.
4. Persist a usable built-in sample before trying the provider. With fallback disabled or unsuccessful, retain that sample and show the fallback status alongside partial coverage.
5. For full history, request up to `reported total + 10`, bounded by per-job cap and remaining monthly allowance; unknown totals use the per-job cap. An allowance too small to increase the current sample blocks the paid call. Failure recovery for an ordinary snapshot requests up to 10 reviews.

Example: 1,000 collected out of 1,169 reported qualifies for fallback. Four missing reviews out of 1,169 do not: that small discrepancy could reflect changing totals and is still displayed as partial. These thresholds govern spending, not declarations of completeness.

## Execution and cost protection

- Uses `GET https://api.outscraper.cloud/google-maps-reviews`, `X-API-KEY` authentication, one exact-ID query, `limit=1`, `sort=newest`, `ignoreEmpty=false`, `source=google`, and `async=true`.
- Never requests unlimited (`reviewsLimit=0`) collection. No enrichment services are implicitly added.
- Reserves the entire requested limit before submission in `.dev/outscraper/ledger.json`. Conservatively retains the reservation on empty, failed or uncertain results. It does not assume an ambiguous response was free.
- Saves a returned request ID before polling. Polls only the fixed provider origin's `/requests/{id}` endpoint; ignores response-supplied URLs and rejects redirects. Submission is never automatically retried after a network failure. Result GETs can be retried.
- Polling is bounded to approximately 20 minutes (plus network time). A subsequent collection attempt can resume a still-pending provider request less than three hours old after the local collector runs, or directly if that collector is unavailable. An exhausted monthly allowance does not block resuming an already-reserved request; it still blocks a new paid submission. It does not submit another paid job for that business within 24 hours. Older pending/uncertain/failed reservations require checking the provider dashboard; the cooldown prevents automatic duplicate charges during that window.
- Completed provider results are cached locally for reuse within the same 24-hour window. Provider-side result expiry does not remove a downloaded result.
- HTTP 401/402/403 opens a one-hour account cooldown; 429 opens a one-minute cooldown. The per-business 24-hour submission limit still applies. Raw provider error bodies and credentials are not returned to users.
- A file lock and atomic ledger replacement prevent concurrent local reservations from overrunning the allowance. Corrupt or locked budget storage fails closed.

## Evidence, UI and AI

Mapped fields: listing identity, name/address/category, rating and total, rating distribution, available contact/location/hours fields; review author/link, text, rating, Unix timestamp converted to UTC, and owner reply. Missing fields remain missing. Star-only reviews are kept.

The provider's documented `reviews_id` repeats across multiple reviews and the place itself. It is **not** used as a unique review ID. Prefer `review_id` where present; otherwise generate a stable provider-namespaced hash. Different provider samples are never blindly concatenated because their review identifiers may differ.

Select the larger sample (or an equally large, newer sample). A smaller provider result remains in local provider storage and does not become the dashboard's latest dataset. Raw successful response, normalized result, request ID, reason, requested limit, and normalized evidence hash are retained. A source change does not by itself generate newly observed low-rating alerts; the next same-provider snapshot establishes that comparison.

Settings → Connections and the collection controls display enabled/disabled state. Collected dashboards show provider provenance. Existing AI analysis and report-kit workflows accept the normalized dataset. Collection does not automatically start billable AI analysis or submit complaints.

## Explicit limits / Azure deployment

This is a **Google review and listing fallback**, not an implementation of every Outscraper product. Facebook, Trustpilot, enrichment, reviewer histories, deleted reviews, rank tracking, or automatic reporting need separately verified integrations. No provider guarantees that every publicly reported review remains retrievable. Coverage remains explicit even after the reported count is reached.

The current allowance ledger and provider results are local files; normalized selected datasets use the existing MySQL store. Before enabling on a multi-instance Azure service, move reservations and request ownership to shared transactional storage, add durable worker leases, enforce authenticated workspace/plan budgets, and protect raw response storage. Do not deploy enabled workers with independent ephemeral ledgers. No multi-instance production or real provider billing test has been performed.

After an abrupt process crash, `ledger.lock` may remain. Stop all provider workers, inspect the ledger and corresponding provider jobs, then remove only that specific stale lock. Do not reset/delete the ledger to clear a budget error. A request reserved without a returned provider ID may still have incurred a charge.

## Validation

Automated tests cover disabled operation, exact-ID matching, normalization and deduplication, asynchronous completion/resumption, fixed-host polling, conservative monthly reservations, restart reuse, billing cooldown, uncertain submission, corrupted ledger, material coverage thresholds, preserving partial evidence, and avoiding smaller paid samples. No live provider requests were sent.

Official references: [Google Maps Reviews API](https://docs.outscraper.com/endpoints/google-maps-reviews/), [Request results](https://docs.outscraper.com/endpoints/requests-requestid/), [API explorer supplied by the user](https://app.outscraper.cloud/api-docs).
