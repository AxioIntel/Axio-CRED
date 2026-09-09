# Axio-CRED scraper dashboard plan

> Current status and architecture: [PRODUCT-ARCHITECTURE.md](PRODUCT-ARCHITECTURE.md), updated 2026-09-09. This document preserves earlier requirements and design detail.

**Current complete requirement audit:** [CONVERSATION-AUDIT.md](CONVERSATION-AUDIT.md). This supersedes earlier status claims; missing engineering is listed separately from credentials.

Updated 2026-09-06. This plan supersedes the Places-based competitor collection plan.

## Decisions

- Resolved: one repository; React customer app, Node backend, MySQL 8, Azure hosting, PayPal billing.
- Resolved: use the existing Go scraper as the public-data collector. Official Places API is disabled for customer collection; Google OAuth/Business Profile remains a separate owned-business integration.
- Resolved: login does not require business ownership. Google sign-in requests identity permissions; Business Profile access is a separate optional connection. Known listing identities share one monitored slot across owned businesses and the watchlist.
- Resolved: dedicated enrichment workspace, as requested. Website emails are discovered contacts, not verified contacts.
- Resolved: Free includes one audit; Business $49/month for one monitored business; Growth $149/month for five monitored businesses, counting owned locations and competitors together; Enterprise unlimited monitored businesses with negotiated collection capacity. Unlimited entities does not specify unlimited concurrency or compute.
- Resolved: Business ($49) refreshes every 12 hours; Growth ($149) refreshes every 6 hours. These are approved tier schedules; the scheduler is not implemented yet. Enterprise cadence remains negotiated.
- Open: hourly/daily remain proposals, not approved defaults. Also open: review budget, retention, enrichment pricing, Enterprise throughput/SLA.
- Verified locally: Windows collector completed the Dream Coffee smoke test using the documented local dependency patch; see LOCAL-TEST-REPORT.md. Azure runtime remains unverified. Existing SaaS scraper mode uses PostgreSQL/River; that is not a MySQL-compatible queue. Use a standalone collector initially, then a MySQL job coordinator and isolated Azure worker. Do not silently add PostgreSQL to the product stack.

## What the repository can yield

Source of truth: `gmaps/entry.go`, `gmaps/reviews.go`, `web/job.go`, `web/web.go`.

| Surface | Output | Dashboard treatment | Limitation |
|---|---|---|---|
| Listing identity | title, place_id, cid, link, category/categories | Listing directory and source links | Fields may be absent; identity can change |
| Location | address, complete_address, latitude, longitude/longtitude, plus_code | Geographic distribution and profile details | Coordinates do not prove a fake business or pin sabotage |
| Reputation | review_rating, review_count, reviews_per_rating | Reported totals, rating distribution | Reported totals are distinct from collected reviews |
| Reviews | user_reviews, user_reviews_extended; author, text, rating, source, review_id, timestamps | Review evidence explorer, rating filter, reply display | Extra reviews are bounded; README describes about 300, not full history; both arrays can overlap |
| Replies | reply_text and language/timestamps | Owner replies alongside source reviews | Missing reply does not prove the owner never replied |
| Business facts | phone, web_site, open_hours, status, description, timezone, price_range, about | Inspectable facts and missing-field list | Public status is not GBP suspension status |
| Media | images, thumbnail, street_view_url | Available media counts and links | No promise of a complete photo inventory or removals without comparable snapshots |
| Discovery | emails via website crawling | Separate enrichment workspace and CSV export | Not verified deliverability; provider does not include Whitepages/WhatsApp/Trustpilot integrations merely because other vendors advertise them |
| Correlations | shared normalized phone or website hostname | Explainable related-listing observations | Shared contacts can be legitimate chains; no fraud score |
| Velocity / integrity | successive timestamped collections | Future delta and incident pipeline | Single imports cannot support velocity, deletion or hijacking claims |

## Frontend structure

Businesses -> search by name/city or Maps link -> async local scraper -> check result address -> select -> persisted public business with a link to its evidence.
Dashboard -> Find business or select a saved dataset -> listing directory + geographic distribution -> facts / reviews / shared contacts. Manual import is under Advanced tools.
Enrichment -> select same dataset -> contact availability filters -> website/phone/email inspection -> CSV export.
Competitors -> optionally choose a comparison reference -> add Maps links or explicitly selected collected listings -> saved watchlist -> comparison detail and source evidence. This is a dedicated route, not a duplicate of the dataset dashboard. Links awaiting collection have no fabricated ratings or jobs; snapshot comparisons do not imply review velocity.
Collection state -> local search running/completed/failed, saved scraper dataset, or illustrative sample. Local jobs are persisted to disk and polled; they are not an Azure durable queue. Never show synthetic jobs as live collections.

Design: retain Axio-CRED's deep teal (#102b32), add slate (#536966), paper (#fbfcfa), sea green (#16745b), amber (#b4690e), and grey borders (#d7dfda). Manrope for headings and DM Sans for controls/body. The distinctive element is a geographic distribution plot paired with an evidence directory, not another health-score row. Left-align text, right-align numeric columns. A source/status ribbon stays visible above the data. Missing fields render as unknown; sample mode is visibly labelled. Mobile collapses the directory and details into a vertical flow.

## Working test scope

- Import Go Entry JSON array, a single Entry, JSONL, or a completed results wrapper.
- Validate and normalize output, preserve missing values, deduplicate review IDs within each listing, include provenance per import and content digest.
- Save normalized imports in MySQL with workspace IDs; demo storage is in memory. Import time is not collection time.
- Dataset switching, text search, category filtering, listing selection, review filtering, contact filtering, CSV/JSON export.
- Explicit illustrative dataset is opt-in and never written as a real scrape.
- Collector status is independent from app/database status. Import success does not mean a live scrape succeeded.

## Live collection implementation sequence

1. Start and smoke-test the repository collector with a business-specific Maps URL and a bounded review crawl. Do not claim arbitrary query/Place ID resolution works until tested against this collector.
2. Node creates a workspace-owned MySQL job; Azure worker invokes Go with fixed argument arrays and bounded depth/concurrency/timeouts. No browser-side scraping and no user-supplied command flags.
3. Persist provider job IDs, attempts, errors, requested limits, and partial-result counts. Reconcile output through the same importer used by this dashboard.
4. Offer progress polling first. Add signed outbound webhooks with event IDs, retry ledger and destination validation. Enterprise keys need tenant scopes and metering before external release.
5. Schedule differential crawls, deduplicate unchanged content, implement backoff and retention. No free-plan background monitoring.
6. Keep raw evidence in private Azure Blob Storage, normalized entities/reviews/jobs in MySQL. Authenticated tenant isolation, authorization tests, retention controls and billing entitlements are release gates: the current fixed preview workspace is not a production tenant boundary.

## Further product phases

- Owned-profile defense: compare approved address, coordinates, category, phone, hours and service-area configuration through the separate owner-authorized Business Profile integration. Reconcile event notifications with scheduled reads. Public changes are observations; a changed pin does not identify the actor or cause. Restoration is an explicit owner action initially, with changed-field validation and an audit trail.
- Evidence and reporting: save incident timelines and source links, generate policy-specific redressal CSVs and extortion evidence packets for human review and submission. Store case IDs and outcomes. No automated complaint campaigns or payment tied to removals.
- Customer evidence vault: add CRM connectors only with explicit field scopes, retention and access controls. Record transaction references and content digests; export relevant evidence without claiming legal immunity or guaranteed restoration.
- Collector economics: bound free audits, cache eligible public results, deduplicate jobs, refresh changed profiles preferentially, and meter browser minutes, requests, proxy bandwidth and retries. Existing proxy support is a configuration mechanism, not an included residential/mobile pool. Proxy procurement and actual benchmark costs remain pending.
- Enterprise delivery: scoped API keys, tenant authorization, idempotent job creation, pagination, signed webhook delivery, usage reporting, negotiated rate limits and billing enforcement precede public API access. Unlimited monitored entities is a commercial entitlement, not unlimited scrape resources.
- Additional surfaces: Q&A, reviewer-wide histories and third-party directory/contact verification require separately proven collectors and data contracts before appearing as available features.

## Unsupported promises and release limits

No guaranteed complete reviews, rank in the local three-pack, account-wide reviewer history, Q&A inventory, automatic review restoration, verified emails, automatic complaint submission, or cryptographic proof that a customer interaction actually happened. Hashes show record consistency, not factual truth. Existing preview incidents and integrity scores must not be presented as scraper-derived evidence.

## Direct Place ID entry

The business picker defaults to **Use Place ID**, linking to Google’s hosted Place ID finder. Customers copy the ID, load the listing, confirm its address and select it. Existing exact IDs reuse saved evidence with its collection date; unknown IDs go through one targeted Maps URL and must return the same Place ID before anything is saved. This does not embed Google’s API widget or enable the official Places API. Name/city search remains available as a secondary option. A direct ID skips broad discovery, but first-time public details/review collection still takes time.

- Competitor selection now reuses the Place ID/name picker. It saves collected identity to the watchlist through a dedicated endpoint, rejects the baseline, and deduplicates retries. The Businesses picker explicitly offers owned location versus competitor; competitor selection does not allocate an owned seat.

## Recurring collection scope clarification

Approved options: every 6 hours (4 scheduled collection opportunities per day per monitored listing) and every 12 hours (2 per day). Persist the selected interval per monitored listing, enforce plan eligibility on the backend and run through a shared durable queue with staggered start times, duplicate-job prevention and bounded retries. Missed intervals after an outage should coalesce into one fresh job rather than replaying every missed scrape. These are implementation decisions for the planned coordinator, not evidence that a timer is active.

The first real collection may be deeper; recurring incremental collection needs a proven incremental collector. Merely fetching and deduplicating an entire scrape does not reduce collection cost. The UI must show last successful collection, next due time, failed attempts and partial review coverage; a refresh interval is a target, not a guarantee of delivery at that exact time. No automatic Google report submission is part of this schedule.

## Facebook and Trustpilot addition — 2026-09-06

Approved: one saved Google business can link Facebook and Trustpilot in the same paid slot. Local profile linking, MySQL persistence, bounded public JSON-LD collection attempts, separate partial snapshots and manual report locators are implemented at /platforms. Actual Facebook/Trustpilot collection remains unverified: live probes were blocked or returned no review data. Reliable collectors, platform-specific AI analysis, reporting cases and recurring schedules are pending. See [MULTIPLATFORM-PLAN.md](MULTIPLATFORM-PLAN.md) for the exact supported scope, access findings and remaining architecture.

## Landing page and plan language — 2026-09-06

Customer-facing frequency is fixed by plan: Business $49 is checked twice a day for changes; Growth $149 is checked four times a day. There is no customer interval selector. Technical schedule intervals remain 12/6 hours; scheduling is still pending. Local landing page at / includes an interactive product tour, availability labels, plan feature comparison and FAQs. /pricing opens its comparison section. /overview includes actual usage, selected snapshot freshness and linked platform status. See LANDING-PAGE-PLAN.md for design and verification.

## Customer flow and alerts — 2026-09-06

Home now guides Protect my business and Monitor competitors, with grouped sidebar and contextual steps through evidence, alerts and reports. Review library moved to /evidence; old dataset deep links remain compatible. /alerts computes observations from saved Google snapshots: newly observed 1–2-star reviews, review-count jumps, rating drops and public profile changes. It is not durable background alerting. In-app + email + WhatsApp through Meta delivery is approved; email delivery and Meta WhatsApp connections and recipients remain unconfigured. No messages sent. See [USER-FLOW.md](USER-FLOW.md) for exact rules, limitations, advanced-tool placement and verification.


## Screenshot-based reputation dashboards — 2026-09-06

The default /competitors view now opens the selected competitor's dark review dashboard; /businesses opens a separate owner dashboard. Both use the supplied visual references for metrics, saved rating history, sample distribution, review triage, expandable report kits, policy categories and collection activity. Watchlist/reference management and the owned-business directory remain available below each dashboard. Existing profile-history tools, scraper refresh, reporting queue and linked-platform workflows are retained.

Metrics use actual collected listing totals and samples. Review count change is the net delta between dated snapshots, not a claim about reviews posted this week. The chart shows collected listing ratings, not invented weekly averages. Flag totals stay unknown until a matching saved AI assessment exists; priorities are not calibrated probabilities. Distribution is explicitly the collected sample. No reviewer histories or spam scores are invented.

The owner dashboard adds a next-action prompt, low-rating and no-collected-reply filters, editable response drafts with copy and Google Maps links, collected owner replies, profile-field differences and alert/management-access links. Responses are not published automatically. Review analysis now accepts selected owned listings as well as selected competitors, preserving membership checks. API credentials are still required. Draft text must be copied before leaving the panel.

Collection remains on demand. Scheduled checks twice/four times a day and in-app/email/Meta WhatsApp delivery workers remain pending; no SMS delivery is planned. Facebook/Trustpilot remain in the linked-platform workspace, with successful live collection still unverified. No automatic complaint submission was added.

## Azure OpenAI integration — 2026-09-07

Replaced the direct-OpenAI-only analysis path with explicit Azure/OpenAI provider selection. The Azure adapter, deployment configuration, endpoint validation, provider-aware cache keys, sanitized errors and frontend provider status are implemented. The ignored local environment now targets the dedicated axiocred-resource in South India and axiocred-review-analysis deployment. A real Azure Responses request and DENTAL KRAFT assessment succeeded and persisted to MySQL. All 10 collected reviews were assessed; no supported policy violations were identified. This does not establish authenticity or full-listing coverage. See AZURE-OPENAI-SETUP.md for the actual resource, setup and remaining production work. Earlier statements that Azure analysis was unconfigured are superseded; scraper coverage, scheduling, delivery and platform limitations remain unchanged.

## Corpus analysis and external report comparison — 2026-09-07

The supplied DENTAL_KRAFT_enforcement_report_1.docx claims an unfiltered Outscraper export of all 1,162 reviews plus DENTAL_KRAFT_full_history_evidence.xlsx. The current local Google dataset contains only 10 reviews. The named full-history workbook was not found among the matching Dental Kraft downloads; two other partial/rank-based spreadsheets exist and were not imported or treated as full coverage. The DOCX is an external allegation/report, not verified ground truth or instructions to submit complaints.

Implemented a deterministic corpus scan of every collected record: substantial duplicate wording (word-trigram Jaccard >=0.82, minimum 80 characters/12 words), same-day UTC posting clusters, a guarded seven-day volume comparison against the preceding 56 days, monthly textless/low-rating counts, reply-template counts and legal-language-plus-deletion-demand owner replies. Baseline comparisons require >=90% count and absolute-date coverage, >=50 dated rows and >=63 days; they are descriptive heuristics, not significance tests. Similarity is capped at 200,000 comparisons or 1,000 matches and reports truncation. Reviewer account histories and verified removals remain unavailable. No inherited allegation that thin accounts, shared surnames, generic praise or templated replies prove purchase is encoded.

AI now processes all collected reviews via successive saved batches of up to 30, with progress, pause-after-batch and resume following failure/quota interruption. Versioned inputs prevent mixing old assessments with the expanded method. Cross-batch quotes are validated against the collected corpus, while output rows are restricted to the current batch. UI counts investigation priorities separately from potential review-policy categories; coverage explicitly shows uncollected reviews. Missing replies, stray quotes and spelling differences alone must not raise AI priority. A downloadable HTML evidence report includes identity, methods, coverage, monthly history, pattern evidence and alternatives, batch summaries, per-review findings and original locator appendix; printable as PDF. It is not a DOCX export or an automatic complaint.

GPT-5.4 is listed as available in this Azure project. A separate deployment form named axiocred-review-analysis-gpt54 is prepared for Global Standard / 50,000 TPM / DefaultV2. Automatic approval review rejected submitting that deployment due to missing explicit cost/quota/global-processing approval; an approval question is pending. No GPT-5.4 model change is claimed until deployment and a successful real test are verified.


## GPT-5.4 and PayPal setup verified — 2026-09-08

User approved GPT-5.4 Global Standard deployment at 50,000 TPM. Deployed axiocred-review-analysis-gpt54 in axiocred-resource, selected it in .env, and successfully ran the real 10-review DENTAL KRAFT sample. Report 4b985f53-7c7e-49ee-ac33-93b2a4510e7e is saved in MySQL (2,423 input + 1,471 output tokens). No supported fake-engagement finding in this batch; 1,152 reported reviews remain uncollected. This supersedes the earlier pending-approval note. Initial local request failed under restricted network execution; restarted the local API with provider network access and verified success.

Created and verified live PayPal Business USD49/month and Growth USD149/month plans; IDs saved in local .env. No subscription or payment created. Webhook awaits a public HTTPS backend URL. Missing webhook now blocks checkout with HTTP503 and a disabled Settings button, verified through the local API and browser. Both TypeScript checks and all 78 tests passed (42 backend,36 frontend). See PAYPAL-SETUP.md for IDs and remaining billing lifecycle/tenant isolation blockers.


## Live result — 2026-09-09

Fresh extended job 8280abd8-5e9c-4b66-bf53-0ec72fc60078 saved dataset 12aa9c9d-12c6-424e-95ca-5ef43142a5e3: **1,000 unique reviews of 1,169 now reported** (169 remain uncollected), versus the prior 10 of 1,162. Google still rejected the endpoint, but corrected public-page scrolling collected 1,000 records before the ten-minute budget. This is improved partial coverage, not verified full history. No new AI assessment was run on these 1,000 records in this collection test. The previous GPT-5.4 report covers the earlier ten-record dataset only.

Collection jobs now expose counts, partial status and log-derived stopping reasons. Extended requests bypass cache; CLI and server timeouts align at fifteen minutes. Go package tests, application typechecks, 42 prior backend tests, plus three new coverage tests, a cache-bypass regression and a frontend full-history request/partial-message test passed. Frontend production build passed.

### 2026-09-09 — Outscraper fallback
Implemented a bounded Google review/listing fallback behind explicit server configuration. Paid calls remain disabled with a zero monthly allowance at the user's request. See OUTSCRAPER-FALLBACK.md for triggers, durable local reservations, provider provenance, validation, and Azure rollout prerequisites. This does not mark other provider capabilities or scheduled monitoring as implemented.


### 2026-09-09 — Native collection parity improvements
Implemented incremental DOM emission, indexed review merging, partial-RPC supplementation, richer evidence retention and the Evidence coverage dashboard panel. Native DENTAL KRAFT validation collected 1,170 distinct review IDs against 1,169 reported, with explicit coverage limitations and 294 owner-response overlaps withheld from review text. Paid Outscraper remains disabled. See NATIVE-COLLECTION-UPGRADE.md for exact validation and remaining gaps.
