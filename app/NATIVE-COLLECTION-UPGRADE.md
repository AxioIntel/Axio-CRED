# Native collection improvements inspired by Outscraper

2026-09-09. Outscraper's public API is a reference for useful collection controls and output fields, not access to its proprietary scraping implementation. Paid fallback remains disabled.

## Implemented

- **Incremental public-page extraction:** unchanged DOM cards are no longer returned to Go on each pass. Changed/expanded cards are emitted again. A browser WeakMap avoids retaining removed cards.
- **Partial RPC supplementation:** a nonempty RPC response below the reported total no longer ends collection automatically. The public-page path can supplement it. Both result sets survive the place collector and are deduplicated by review ID. At the safety cap or with a nonempty result and unknown reported total, the collector does not make an unbounded supplementary pass.
- **Indexed identity merging:** native deduplication uses a review-ID index instead of repeatedly scanning all accumulated reviews. Different IDs with the same author/text remain separate. Anonymous and star-only reviews survive when an identity is present. Richer DOM fields enrich a matching primary record before deduplication.
- **Chronological collection attempt:** after opening the public review panel, select its Newest option when available. Logs record whether selection succeeded; the collector does not claim chronological order when the control is absent. No negative-rating filter is applied.
- **Bounded quantity:** native DOM collection now has a 15-minute data-collection window within a 20-minute process timeout. It stops at the reported count, sustained lack of progress, cancellation, timeout, or 5,000-review safety cap. Existing RPC pagination is retained. Raising time limits alone is not a completeness guarantee.
- **Richer review evidence:** retain public reviewer links, review photo links, profile-photo URLs, original/translated text and language where returned, owner reply, exact published/updated/reply timestamps when present, and the original relative date otherwise. Missing ratings become unknown rather than a false zero-star rating.
- **Richer business evidence:** retain all collected categories, structured address, plus code, public attributes, thumbnail and review-list link in addition to existing rating, count, contact, address, hours and coordinates.
- **Dashboard evidence coverage:** expandable business-level field coverage and per-review metadata expose what was actually collected. These fields are also retained in MySQL dataset JSON. Older saved imports are not silently rewritten.

## Accuracy controls

Do not derive exact timestamps from phrases such as “a month ago.” Public DOM owner responses are extracted separately from review text. A profile image is not counted as a review photo. The extractor expands review-text controls, not arbitrary “More actions” menus. Unknown values stay unknown. No provider attribution or fraud claim is inferred from missing fields.

Only mapped fields have been added to the app's stored schema. Features such as complete reviewer account histories, reliable Q&A capture, deleted-review recovery, arbitrary website enrichment, geo-grid rankings, resume cursors across browser sessions, and multi-worker scheduling are **not** newly implemented by this change. Existing Outscraper billing gates and limits are unchanged.

## Verification

Regression tests cover incremental DOM emission, owner-response separation, restricted text-expansion buttons, anonymous star ratings, metadata preservation, primary/DOM enrichment, distinct IDs, and the native safety cap. The Go merge benchmark compares a full 5,000-record repeat pass; it measures only local merging, not network or end-to-end collection speed. Live collection findings should be recorded separately below.

Reference: [Outscraper Google Maps Reviews API](https://docs.outscraper.com/endpoints/google-maps-reviews/) documents bounded review quantities, ordering, async results and review/listing fields. [Outscraper fallback configuration](OUTSCRAPER-FALLBACK.md) remains a separate paid recovery path.

## Live verification: DENTAL KRAFT

- Job `b54f944d-328d-4e6c-b2a9-2367a5518839`, dataset `b30de78e-5f60-434e-b871-efc703fbb118`.
- Native run: 2026-09-08 19:07:08–19:18:44 UTC (approximately 11 minutes 37 seconds).
- 1,170 unique review IDs versus 1,000 previously collected; listing reported 1,169. No duplicate author/text/rating triples were found, but the one-record discrepancy is unresolved and this is not independently verified completeness.
- RPC returned HTTP 403. Public-page Newest selection succeeded. This live run verifies the improved DOM path; partial-RPC supplementation is regression-tested, not live-tested against a successful RPC session.
- 1,170 profile links; 1,156 owner replies; 10 categories; 9 public attribute groups; structured address retained. Only 8 exact timestamps and no review-photo links were available in this collection.
- During validation, 294 review-text values matched the owner reply exactly. The in-flight test binary predated the final owner-response selector correction. Those texts were withheld from the saved dataset's analysis input, with a capture-issue explanation. The original raw response and pre-correction dataset are preserved in the job directory. The corrected dataset has 866 usable review texts and 304 ratings without collected text, including the 294 quarantined texts.
- The final corrected selector, primary enrichment and partial-RPC changes were rebuilt into the local binary after the run. They have regression coverage; a second full live run of that final binary was not performed. No claim is made that the 294 missing review texts have been recovered.
- API verification confirmed the corrected dataset contains zero review-text/owner-reply overlaps. No paid Outscraper or AI request was made. Paid fallback remains disabled with a zero monthly allowance.
- Validation: 64 backend tests, 43 frontend tests, Go `gmaps` tests, `go vet ./gmaps`, both application builds and the local scraper build passed.
