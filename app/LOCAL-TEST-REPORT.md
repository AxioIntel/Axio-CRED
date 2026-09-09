# Local real-business smoke test

Tested 2026-09-06. This validates a manual collector → API → MySQL → dashboard path, not production readiness.

## Target and provenance

### Customer-owned baseline: White Dental Healthcare

Follow-up test on 2026-09-06 using the user's share link `https://share.google/cQ9Xj4AcFMPGjBGvT`:

- Resolved business: White Dental Healthcare, Indirapuram, Ghaziabad.
- Place ID: `ChIJHy8fZ7P6DDkREnuw1bPQYfw`; decimal CID `18186046241101609746`.
- Collection: 08:30:44–08:31:11 UTC. Dataset `b0d709f9-4ab4-41ec-aa88-f35565df88a6`, **White Dental Healthcare — partial baseline**.
- Google Maps and scraper agreed on 4.9 stars and 752 reported reviews. Ten review records were collected, with eight owner replies after the importer fix. This is incomplete review coverage.
- The review RPC returned HTTP 403; the browser fallback stopped after ten records. This is a collector limitation, not evidence of missing/deleted customer reviews.
- Public Maps phone field is absent in both the live browser and scraper. Maps offered “Add place's phone number.” Cause and historical changes are unknown; no public edit was made.
- Website crawl discovered `whitedentalhealthcare@gmail.com`. Deliverability was not tested. Six media links were returned, without a completeness guarantee.
- Fixed importer omission of `reply_text_original`; a regression test now checks original-only and original-plus-translated replies. Existing baseline was re-normalized from the same raw export, preserving collection/import timestamps and dataset identity.
- Raw export/log/provenance: `.dev/collections/2026-09-06T08-30-44-693Z/`. User-declared ownership is not Google OAuth verification.
- Backend tests (four), TypeScript check and backend build passed. Dashboard rendering and counts checked with the persisted baseline selected. Competitor collections remain pending user links.

### Initial smoke test: Dream Coffee

- Dream Coffee, Eakou 74, Ilion 131 22, Greece.
- Place ID: `ChIJoRVrMS-joRQRkzrMbbRUnBY`.
- Fresh collection: 08:23:21–08:23:57 UTC, approximately 37 seconds.
- Dataset: `1ce03caf-9dd3-4e46-a8d4-76facf96b262`, labelled **Dream Coffee — live local test**.
- Raw output, logs and digest: `.dev/collections/2026-09-06T08-23-21-031Z/` (ignored by Git).
- Reference: live public Google Maps listing inspected independently in the browser. No official Places API used.

## Observed results

| Field | Collector / database | Live Maps cross-check |
|---|---|---|
| Rating | 4.7 | Matches |
| Reported reviews | 67 | Matches |
| Collected review records | 67 unique | Total matches; individual records only spot-checked |
| Review text | 22 with text; 45 without collected text | One named five-star review spot-checked; original Greek preserved |
| Rating distribution | 58 five-star, 5 four-star, 1 three-star, 1 two-star, 2 one-star | Matches |
| Address and phone | Eakou 74, Ilion; +30 21 0261 6578 | Matches |
| Coordinates | 38.0331931, 23.7094475 | Matches listing URL |
| Website | vrisko.gr directory listing | Matches; not represented as the business-owned domain |
| Media | 3 image links | Completeness not established |
| Owner replies | None collected | Absence across the full listing not established |
| Emails | None collected | Email crawling intentionally not enabled for this directory link |

MySQL was queried independently: one persisted listing with 67 review records. Both dashboards displayed the stored result and collection timestamp. The one-star filter displayed two matching records. Source links and geographic position were present.

## Defects found and local fixes

1. Docker Desktop fails during startup because its local ingest socket cannot be accessed. No factory reset or Docker data removal performed. A checksum-verified Go 1.26.8 runtime and matching Playwright Chromium were installed under `.tools/` instead.
2. Pinned scrapemate v1.3.0 has an inverted `isClosed()` predicate and a recovery path that can return a nil page without an error. The unmodified build returned `unexpected page type` and no results.
3. Its alternate browser path closed the browser prematurely on this PC. Replacing the upstream launch flags (including single-process and disabled security flags) with normal Chromium defaults allowed the collection to complete.
4. `scripts/build-local-scraper.mjs` reproduces the local dependency fixes in a private module copy. The module cache and repository go.mod stay unchanged; production Docker does not yet include these fixes.
5. The local collection script rejects empty/wrong-identity results even if the scraper exits with code zero. Both failed runs were rejected before import.
6. Dashboard provenance now displays supplied collection timestamps rather than always claiming collection time is unknown.

## Remaining before launch

Validation passed: backend and frontend TypeScript checks, six app tests, frontend/backend builds, Go parser and runner tests, and two consecutive local scraper rebuilds. The Go tests ran without the race detector; the full repository race suite was not run on this Windows setup.

- Test the intended customer's actual business and a small competitor set; test another language/region and blocked/partial results.
- Test email extraction on a business-owned website; no email-deliverability verification exists.
- Integrate durable dashboard jobs, retries, schedules, cancellation and usage limits; manual operator scripts are not customer-facing collection.
- Resolve and test the dependency fixes in the Azure build, then measure worker memory/concurrency and costs.
- Complete tenant authentication/authorization, real Google Business Profile connection, PayPal sandbox lifecycle, retention/deletion and deployment checks.

The real collection succeeded; the MVP is suitable for continued local testing, not a public launch sign-off.

## Built-in business search and selection — 2026-09-06

- Browser submitted **White Dental Healthcare Indirapuram** through Add business. Local API started the repository Go scraper and polled completion; no official Places API was used.
- Job ad3881df-6a8a-4035-bf3f-4dc3000672e1, started 2026-09-06T09:56:39.934Z, completed 2026-09-06T09:56:56.981Z (17 seconds). Dataset 381f189e-2beb-4dbf-bec5-d384a266780b.
- Returned exact Place ID ChIJHy8fZ7P6DDkREnuw1bPQYfw, rating 4.9, 752 reported reviews and 8 collected review records. Discovery is a subset, not a full review crawl.
- Selected the returned card and clicked Add selected business. The businesses page showed White Dental Healthcare, correct address, 4.9 / 752 and a working evidence link; workspace location count increased from 2 to 3.
- Fixed premature first-navigation cancellation caused by upstream inactivity clock starting at zero. Overall three-minute timeout remains.
- Sandboxed API browser children initially failed with ERR_NETWORK_ACCESS_DENIED. Restarting the compiled local API with network access resolved the live test. Errors now distinguish this condition from empty Google results.
- Job files are local and process concurrency is one. Durable Azure scheduling, tenant authentication and launch gates above remain outstanding.

## Direct Place ID validation — 2026-09-06

- The broad `dental` search found 20 places and took 81 seconds (job `217b386d-3b09-40f9-91c0-b1315321be32`).
- The default picker now accepts a Place ID and links to Google’s hosted finder. Saved exact-ID response measured 31 ms over the local API; browser displayed the cache notice and matching White Dental Healthcare card.
- Fresh targeted lookup completed in 35.2 seconds (job `a88a7fe2-38f0-4281-8011-f7867b2abd54`), verified exact ID `ChIJHy8fZ7P6DDkREnuw1bPQYfw`. This test used isolated demo storage with a real scraper, so it did not replace the customer’s saved evidence.
- Fixed GmapJob URL parameter merging: upstream GetFullURL appended a second question mark, corrupting the ID. Regression test checks preserved api/query/query_place_id/hl fields. Wrong-identity outputs fail before saving.
- Validation: 17 app tests, TypeScript checks, app builds and Go gmaps package tests passed. Full Go race suite was not run. Timings are individual local observations, not a performance guarantee.

## Competitor selection correction — 2026-09-06

User confirmed DENTAL KRAFT is a competitor. It had been saved as an owned location; watchlist was empty. Original generic 500 was not reproduced: same-state PUT and a rolled-back MySQL save both succeeded. Added dedicated collected-competitor selection, explicit owned/competitor destination and shared discovery picker on Competitors. UI verified Place ID load, competitor save and watchlist persistence for Dental Kraft. Removed the erroneous owned row only after saving the competitor and checking no incidents, jobs, transactions or snapshots referenced it; backup remains in `.dev/dental-kraft-owned-correction.json`, scraper dataset retained. Added operation-specific error text and reference IDs for unexpected errors without returning SQL details. All 18 app tests, checks and builds passed.

## OpenAI integration — 2026-09-06

24 tests passed across backend/frontend, including mocked provider success, cache reuse, exact-quote validation, incomplete-coverage rejection, missing credentials, missing competitor eligibility, provider errors, disabled setup UI and report display. TypeScript checks, builds and MySQL migration passed. No OPENAI_API_KEY was configured; no live OpenAI request or actual AI report has been generated. Provider quality and full live behavior remain unverified.

## Report kit dropdown — 2026-09-06

Frontend: 13 tests passed and production build passed. Live local Playwright checks confirmed eight independent kits for Dental Kraft in Overview and Competitors, editable evidence, TXT download and no kit overflow at 390px width. Clipboard permission was unavailable in the headless browser and correctly exposed the download fallback; the clipboard success path was tested with a mock. No complaint was submitted and no live AI assessment was generated.

## Reporting queue and team workflow — 2026-09-06

30 app tests passed (16 backend, 14 frontend), including duplicate source cases, stale versions, required approval, approval invalidation, locked submitted evidence, member limits, unverified/unauthorized identity rejection, revoked-session denial, cross-origin write rejection, anonymous production denial and the inactive Auto add information control. App builds and MySQL migration passed. Live local UI verified Auto add placement/description, Settings team controls, Reports queue and mobile panel sizing. A temporary Dental Kraft source case persisted to MySQL and was reused on a duplicate request; only that unchanged test draft was removed afterward. No test cases or team members were left behind. Google OAuth code was not exercised against a live Google account; credentials are absent. No Google report was submitted.

## Full conversation audit — 2026-09-06

35 app tests passed (19 backend / 16 frontend) and both app builds passed. Added regression coverage for contributor identity matching/deduplication, timestamp eligibility, redressal source/formula escaping, forced extended collection, and Google account/location pagination/category parsing. Local browser verified two timestamped Dental Kraft snapshots, fresh/extended buttons, reviewer overlap panel, mobile sizing and both-tier PayPal selector. CSV contains actual Dental Kraft evidence and no legacy Northstar competitor data. Extended scrape job 36be43bf-8622-4867-8f8b-2983f712a19d completed and imported dataset 88e52c69-0262-40a4-8f95-1e7989d0149f with 10 collected reviews out of 1,162 reported; full coverage remains unfulfilled. Google account/location fix is mock-tested, not live OAuth-tested. See CONVERSATION-AUDIT.md for all remaining requirements.

## Pricing and identity-only login — 2026-09-06

Approved $49/month for one and $149/month for five monitored businesses, any owned/competitor mix. All 39 app tests passed (23 backend / 16 frontend), and both builds passed. Tests cover identity deduplication, limits, competitor selection without a reference business, retired legacy-create route, Google identity-only versus optional Business Profile scopes, and rejection of stale $50/$150 PayPal plans. Local MySQL accepted the fifth monitored entry and rejected the sixth; temporary entries were removed, restoring 4/5 usage. Restarted API verified 4/5. Headless local UI verified checkout prices, optional GBP connection, login copy, and an enabled competitor form with no reference business (intercepted empty watchlist; no user state changed). Initial browser check expected a dialog rather than the actual inline form; corrected locator passed. Google OAuth and PayPal checkout remain untested live because provider configuration is absent. Production tenant isolation, billing lifecycle and recurring schedules remain incomplete.

## Facebook / Trustpilot profile workspace — 2026-09-06

45 app tests passed (27 backend / 18 frontend); builds and MySQL migration passed. Tests verify URL allowlists/canonicalization, partial-data parsing and review deduplication, redirect refusal, Google-anchor requirement, same-business confirmation, shared slots, duplicate profile mapping rejection, collection cooldown, old snapshot retention after failure, cross-origin write rejection, unlinking, and no fabricated UI metrics. MySQL persisted a temporary isolated platform record without changing 4/5 usage; only that test record was removed. Local browser verified White Dental Healthcare and DENTAL KRAFT in the selector, both platform forms, and no horizontal overflow at 390px. Live HTTP probes: Trustpilot /review/trustpilot.com returned 403; Facebook /Trustpilot/reviews returned 404 with no JSON-LD. No successful live platform review collection claimed.

## SaaS landing page and dashboard summary — 2026-09-06

22 frontend tests and frontend build passed. New tests cover approved $49/$149 amounts and fixed daily wording, inactive scheduler disclosure, keyboard tab selection, mobile menu state, actual plan usage/profile status and unknown dates/failed requests. Live Chromium checks passed at 375, 390, 768, 1024, 1280, 1440 and 1920px with no horizontal overflow. 125/150 percent CSS zoom, mobile navigation, plan comparison, feature tabs, preview CTA, /pricing deep entry and 390px dashboard passed; zero page errors. No backend changes this turn. Browser-family coverage and Lighthouse were not run.

## Goal-based UX and alert inbox — 2026-09-06

29 frontend tests and production build passed. Chromium verified real local home/competitor finder workflows, scoped competitor evidence, mobile navigation, tablet tools and no home overflow at 375/390/768/1024/1440px. An isolated browser fixture verified a low-review alert deep-links to the correct dataset/listing and highlighted review. No MySQL data or external reports/messages were changed. In-app observations are calculated on page load; automated collections and email/SMS remain unimplemented. USER-FLOW.md records the approved three-channel decision and remaining delivery architecture.


## Separate competitor and owner reputation dashboards — 2026-09-06

All 28 backend tests and the pre-existing 29 frontend tests passed; four additional dashboard tests passed after implementation. Both backend and frontend production builds passed. Added coverage for selected-owned analysis eligibility, unknown history and AI state, excluding future snapshots, sample distribution, owner reply filtering/copy, saved AI flags and expandable report kits. A broad Auto add test locator and an unsupported testing-library option were corrected; final targeted tests and build passed.

Local Chromium verified DENTAL KRAFT (10 collected / 1,162 reported) and White Dental Healthcare (8 / 752), real snapshot charts, report-kit expansion and information disclosure at 390px, owner draft entry, next-action filtering, and readable OpenAI configuration state. No horizontal overflow at 390px or 1440px and no page errors. API restarted with selected-owned eligibility; both dashboards return configuration state without errors. No external report, reply, message, paid analysis or new scrape was sent. Evidence stored under .dev/*-dashboard-*.png. Provider and scheduling gaps remain documented in DASHBOARD-PLAN.md.

## Azure OpenAI live connection — 2026-09-07

33 backend and 33 frontend tests passed, and both production builds passed. An additional Azure frontend status regression then passed with the existing two analysis panel tests (67 total test cases now covered across these runs). Tests cover Azure authentication/endpoint routing, no key fallback, invalid endpoints and redirects, missing deployment errors, provider/resource cache separation and accurate configuration wording. The first synthetic checker falsely failed after receiving success because of an undefined error-code access; corrected and rerun successfully (HTTP 200, completed, 14 tokens).

Created dedicated Foundry resource axiocred-resource/project axiocred in South India. Deployed axiocred-review-analysis, GPT-4.1-mini 2025-04-14, Global Standard, DefaultV2. Saved key only in ignored local .env and restarted backend and existing MySQL; live database readiness restored. DENTAL KRAFT report f8ddcba5-846e-4849-8f5d-5d1b7e14109c covers 10/1,162 reported reviews and used 3,611 tokens. Seven low, one medium investigation priority and two insufficient-evidence assessments; all report no identified policy concern. Browser verified saved Azure status, individual reasoning, 0 policy flags and expanded report kit with no supported reporting reason. No external reports or messages submitted. Hosting and notification workers remain pending.

## Pattern analysis, resumable AI and evidence report — 2026-09-07

All 75 tests passed (39 backend / 36 frontend), plus frontend/backend production builds. Added regression coverage for sample/metadata limits, substantive duplicates vs short praise/same-profile content, owner-response pressure, explicit baseline eligibility, resumable 31-review analysis with cache reuse, cross-batch quote validation, investigation priorities without policy categories, and escaped HTML exports. Browser verified the remaining 1,152 uncollected records warning, monthly/pattern panel, saved revised assessment and report controls.

Reran the new method through the existing Azure GPT-4.1-mini deployment while GPT-5.4 provisioning approval remained pending. Report 3673896d-f4d1-4b99-852c-86d576ef9575 assessed all 10 collected DENTAL KRAFT reviews: 8 low, 2 insufficient evidence, no supported review-policy concerns or deterministic pattern matches. Usage: 2,425 input + 1,190 output tokens. This does not clear the other 1,152 reviews. Generated .dev/DENTAL-KRAFT-investigation.html from live saved data. No full-history export was imported, no extra scraping completed, and no complaint/message was submitted. The separately prepared GPT-5.4 deployment was rejected by automatic approval review for missing explicit cost/quota/global-processing authorization; do not claim it is deployed until approval and verification.


## GPT-5.4 and PayPal setup verified — 2026-09-08

User approved GPT-5.4 Global Standard deployment at 50,000 TPM. Deployed axiocred-review-analysis-gpt54 in axiocred-resource, selected it in .env, and successfully ran the real 10-review DENTAL KRAFT sample. Report 4b985f53-7c7e-49ee-ac33-93b2a4510e7e is saved in MySQL (2,423 input + 1,471 output tokens). No supported fake-engagement finding in this batch; 1,152 reported reviews remain uncollected. This supersedes the earlier pending-approval note. Initial local request failed under restricted network execution; restarted the local API with provider network access and verified success.

Created and verified live PayPal Business USD49/month and Growth USD149/month plans; IDs saved in local .env. No subscription or payment created. Webhook awaits a public HTTPS backend URL. Missing webhook now blocks checkout with HTTP503 and a disabled Settings button, verified through the local API and browser. Both TypeScript checks and all 78 tests passed (42 backend,36 frontend). See PAYPAL-SETUP.md for IDs and remaining billing lifecycle/tenant isolation blockers.


## Live result — 2026-09-09

Fresh extended job 8280abd8-5e9c-4b66-bf53-0ec72fc60078 saved dataset 12aa9c9d-12c6-424e-95ca-5ef43142a5e3: **1,000 unique reviews of 1,169 now reported** (169 remain uncollected), versus the prior 10 of 1,162. Google still rejected the endpoint, but corrected public-page scrolling collected 1,000 records before the ten-minute budget. This is improved partial coverage, not verified full history. No new AI assessment was run on these 1,000 records in this collection test. The previous GPT-5.4 report covers the earlier ten-record dataset only.

Collection jobs now expose counts, partial status and log-derived stopping reasons. Extended requests bypass cache; CLI and server timeouts align at fifteen minutes. Go package tests, application typechecks, 42 prior backend tests, plus three new coverage tests, a cache-bypass regression and a frontend full-history request/partial-message test passed. Frontend production build passed.
