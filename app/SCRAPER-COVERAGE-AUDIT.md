# Original scraper and coverage audit — 2026-09-09

Verified `git ls-remote origin HEAD refs/heads/main`: both resolve to `beca11f148c7dc9651ee2da9aa9ce111f3dd3bea`, matching local HEAD. Compared committed source with local changes without resetting or pulling over the workspace.

## What the original project provides

- [README at the verified commit](https://github.com/AxioIntel/Axio-CRED/blob/beca11f148c7dc9651ee2da9aa9ce111f3dd3bea/README.md#L454) documents extended reviews up to approximately 300, enabled with `-extra-reviews`.
- `docs/recipes.md` supplies the `-json -extra-reviews` CLI recipe. Our extended collection already passes both flags; `-depth 1` controls discovery depth, not review history.
- `gmaps/place.go` calls `FetchReviewsWithFallback` when extended reviews are requested.
- Original `gmaps/reviews.go` attempts the Google Maps review endpoint, follows next-page tokens, then falls back to the rendered public page. Browser pagination stops after 50 pages of 20. Fallback stops after 30 scroll attempts or six attempts without count growth. It selects the first matching layout container, which may not scroll the reviews.
- `gmaps/entry.go` appends extracted pages to `user_reviews_extended`; normalization ingests primary and extended records.

## Observed DENTAL KRAFT failure

Job `36be43bf-8622-4867-8f8b-2983f712a19d` was extended collection, not a basic snapshot. Its log shows HTTP 403 from both review-endpoint attempts, then public-page extraction stuck at 10. Eight of those records overlapped the listing's initial reviews. The imported dataset contains ten unique records against a reported total of 1,162.

The original repository does not substantiate a guarantee to collect all 1,162 reviews. Full-history support was previously overstated. AI already processes all records that are actually collected, in resumable batches of 30; raising AI model quality does not repair missing collection.

## Local corrections under validation

- Scroll the visible review's actual scrollable ancestor instead of the first layout div.
- Continue while progress is made, with a ten-minute public-page collection budget and fifteen-minute outer worker timeout.
- Replace the fixed 50-page cap with a reported-count-derived budget and an explicit 5,000-page safety ceiling; detect repeated page tokens and respect cancellation.
- Preserve public author URLs and use review IDs when deduplicating rendered records.
- Extended requests bypass snapshot cache even if the caller omits `refresh`.
- Label the dashboard action “Collect full review history” while disclosing that complete coverage is not guaranteed.

Go package tests and both application TypeScript checks passed. These code changes do not bypass Google authentication or establish that all reviews are accessible. The live collection result must be reported separately from implementation readiness.

The customer importer accepts up to 5,000 records per review array. AI preparation maps all normalized reviews and assessment resumes in batches of 30; there is no ten-review ingestion or AI cap. Very large datasets still need chunked ingestion, durable jobs and broader scaling work.


## Live result — 2026-09-09

Fresh extended job 8280abd8-5e9c-4b66-bf53-0ec72fc60078 saved dataset 12aa9c9d-12c6-424e-95ca-5ef43142a5e3: **1,000 unique reviews of 1,169 now reported** (169 remain uncollected), versus the prior 10 of 1,162. Google still rejected the endpoint, but corrected public-page scrolling collected 1,000 records before the ten-minute budget. This is improved partial coverage, not verified full history. No new AI assessment was run on these 1,000 records in this collection test. The previous GPT-5.4 report covers the earlier ten-record dataset only.

Collection jobs now expose counts, partial status and log-derived stopping reasons. Extended requests bypass cache; CLI and server timeouts align at fifteen minutes. Go package tests, application typechecks, 42 prior backend tests, plus three new coverage tests, a cache-bypass regression and a frontend full-history request/partial-message test passed. Frontend production build passed.

Browser verified the refreshed competitor dashboard: 1,000/1,169 collected, 22 records linked to 23 deterministic investigation signals, AI not analyzed for this new dataset, and 992 relative/unknown dates excluded from precise timing analysis. Signals are not confirmed fraud or automatic reporting reasons.
