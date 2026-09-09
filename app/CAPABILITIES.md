# Axio-CRED capability matrix

> Current status and architecture: [PRODUCT-ARCHITECTURE.md](PRODUCT-ARCHITECTURE.md), updated 2026-09-09. This document preserves earlier requirements and design detail.

**Current complete requirement audit:** [CONVERSATION-AUDIT.md](CONVERSATION-AUDIT.md). This supersedes earlier status claims; missing engineering is listed separately from credentials.

Updated 2026-09-06. See [DASHBOARD-PLAN.md](DASHBOARD-PLAN.md) for the scraper field mapping and product decisions.

## Testable dashboard capabilities

- Reputation dashboard at /overview; dedicated competitor watchlist at /competitors; separate enrichment workspace at /enrichment.
- Competitor screen persists its baseline and watchlist in MySQL, accepts Google Maps/share links or explicitly selected imported listings, links pending targets to evidence, and compares ratings/review totals. Imported businesses do not automatically become competitors. Saving a link does not start collection.
- Built-in name/city or Maps-link search in the owned-business picker. Async local collection saves results in MySQL; selecting a result persists its stable identity and source dataset without duplicate business seats.
- Optional advanced import of repository Go scraper JSON arrays, single entries, JSONL and completed results wrappers.
- Persist normalized imports in local MySQL; choose datasets; keep illustrative samples visibly separate and opt-in.
- Inspect listing identity, category, address, coordinates, reported ratings/counts, rating distributions, collected reviews, owner replies, hours, media-link counts and source links.
- Search and category filters, rating filter, shared phone/domain observations, contact availability filters.
- Export normalized dataset JSON and discovered-contact CSV with spreadsheet-formula escaping.
- Review-ID deduplication, import digest, missing-data handling and a schematic geographic plot.
- Official Places collection routes are disabled. Public free-audit collection awaits the repository scraper connection.
- Existing owned-business, incident and PayPal previews remain available. Their fixed preview workspace and synthetic integrity records are not production tenant isolation or scraper-derived evidence.

## Local on-demand collection verified; Azure jobs pending

The Go Entry schema includes 33+ listing fields, standard/extended reviews, replies and website emails. JSON imports exercise the dashboard without claiming that a new crawl ran. README describes bounded extended review collection around 300, not guaranteed complete coverage.

On 2026-09-06, a locally patched Windows build collected Dream Coffee in Ilion: 4.7 stars, 67 review records (22 with text), and 3 media links, persisted in MySQL and inspected in both dashboards. See LOCAL-TEST-REPORT.md. This is one successful listing test, not a guarantee of collection coverage.

Local worker startup, single-process job coordination and polling are implemented. Live White Dental Healthcare name search returned its exact Place ID, 4.9 rating and 752 reported reviews in 17 seconds, then selection persisted the business in MySQL. Durable multi-worker jobs, webhooks, schedules, differential snapshots and Azure worker provisioning remain implementation work. Runtime availability does not guarantee network access or successful Google collection.

## Data limits

- Discovered emails are not verified for deliverability, ownership or consent. Third-party directories, WhatsApp and Trustpilot enrichment are not implemented.
- Shared phones/domains are explainable observations, not fraud findings.
- Review totals are not the number of review texts collected. Sample replies do not establish all reply activity.
- Coordinates do not prove pin hijacking, exact search rank or rooftop geocoding accuracy.
- No verified Q&A surface, full reviewer history, automated mass complaints or guaranteed review restoration.
- Snapshot hashes identify a representation; they do not establish that a claimed transaction or review is authentic.

## Release gates

Real Google Business Profile OAuth and PayPal credentials; tenant authorization and isolation; worker runtime and collection smoke test; entitlement and usage metering; retention and deletion controls; Azure subscription/region/quota/registry; worker infrastructure and deployment verification.

## Direct Place ID entry

The business picker defaults to **Use Place ID**, linking to Google’s hosted Place ID finder. Customers copy the ID, load the listing, confirm its address and select it. Existing exact IDs reuse saved evidence with its collection date; unknown IDs go through one targeted Maps URL and must return the same Place ID before anything is saved. This does not embed Google’s API widget or enable the official Places API. Name/city search remains available as a secondary option. A direct ID skips broad discovery, but first-time public details/review collection still takes time.

- Competitor selection now reuses the Place ID/name picker. It saves collected identity to the watchlist through a dedicated endpoint, rejects the baseline, and deduplicates retries. The Businesses picker explicitly offers owned location versus competitor; competitor selection does not allocate an owned seat.

## OpenAI review analysis (local MVP)

Set `OPENAI_API_KEY` in `app/.env` (never a VITE_ variable), optionally set `OPENAI_MODEL` (default `gpt-4.1-mini-2025-04-14`), and restart the backend. In Competitors, inspect a collected competitor and click Analyze collected reviews; the same panel appears beside its review evidence. No automatic submissions. Live provider verification requires a configured, funded API project.

The Responses API receives at most 30 review records in source order, text capped at 2,400 characters and owner replies at 1,000. Author-name and profile-link fields are omitted; text may contain personal information. `store:false` is used, not a claim of zero provider retention. Results use qualitative investigation priority rather than uncalibrated fake probabilities. Every review reference and evidence quotation is validated; incomplete, refused, malformed or fabricated-quote responses are not saved. Model output is advisory, not proof, and still requires human verification.

Reports persist in MySQL `review_analyses`, cached by source input, model and prompt version. One in-flight analysis is allowed per API process, same-request retries share it, and output is capped at 12,000 tokens with a 90-second deadline. Run the migration before starting. This fixed local preview still needs tenant auth, retention/deletion, per-tenant budgets and quality evaluation before public launch. A representative labeled dataset would be necessary to calibrate any future probability score.

Sources checked 2026-09-06: https://developers.openai.com/api/docs/guides/structured-outputs ; https://developers.openai.com/api/docs/models/gpt-4.1-mini ; https://support.google.com/contributionpolicy/answer/7400114?hl=en ; https://support.google.com/contributionpolicy/answer/7445749 .

## Per-review report kits

Overview and the competitor inspector provide a keyboard-accessible Report kit dropdown for every collected review, including when OpenAI is not configured. Each kit carries listing identity, collected review reference, author, source date, collection date, dataset, original text, and any available AI observations with alternatives. Users can add evidence notes, copy the draft or download a text packet. Edits are temporary until copied/downloaded. The packet labels generated fingerprints accurately and opens the public Maps listing for manual reporting; it does not invent a review-report endpoint or submit a complaint.

## Assigned reporting workflow (local MVP)

Report kits now add a collected review to Reports. Cases preserve their original source snapshot, deduplicate by listing identity plus collected review reference, carry an assignee and verified-evidence draft, and track draft/approved/submitted/closed states. Approval requires a policy reason, evidence, assignee and explicit confirmation. Changing evidence or assignment resets approval; submitted evidence is locked. Recording submission requires confirmation and a reference or dated note. Outcomes and submission records are user statements, not Google-verified results. Cases have a chronological actor/action ledger and version checks against stale updates. MySQL serializes workspace mutations in a transaction.

Settings authorizes up to 20 active or pending reporting team members. No invitation messages are sent. Each person connects their own identity through /api/auth/google/start?purpose=reporting with openid/email/profile scopes, separately from Business Profile OAuth. Verified authorized emails bind to Google's stable subject; reporting sessions are checked against active membership on every request. Revocation invalidates access. No Gmail scopes or Google tokens are retained for this identity-only flow.

Local preview: only non-production loopback requests while Google is unconfigured receive the explicitly labeled local operator role. Production reporting endpoints require an authorized reporting session; cross-origin browser writes are rejected. The rest of this existing application still requires the previously documented tenant-auth/authorization hardening before public deployment. These reporting controls do not make the entire MVP production-ready.

Google setup: configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI (exactly registered callback), SESSION_SECRET (random, at least 32 characters), and REPORTING_OWNER_EMAIL in the backend environment. The owner signs in first to reserve a seat, then authorizes colleagues under Settings. Every member signs in on their own browser. Live Google verification remains pending credentials. OAuth reference: https://developers.google.com/identity/openid-connect/openid-connect .

The disabled Auto add · Coming soon button sits below Open business in Google Maps. Its keyboard-accessible information button describes future automatic evidence queueing/assignment with human verification and manual Google submission. The future automation does not run today.

## Conversation audit fixes — 2026-09-06

Added saved-snapshot history/net review-count change, comparable public-field diffs, public-contributor-ID overlap and approximate coordinate matches, all scoped to loaded datasets with explicit limits. Added uncached exact-ID snapshot refresh and optional six-minute extended review collection in the UI. Corrected the redressal CSV to use real watchlist evidence with name/address/Maps URL/provenance and formula escaping. Added advertising/solicitation to AI schema version review-triage-v2 and specialist extortion/appeal guidance. Fixed owned GBP account/location pagination, categories field path and SAB business type parsing. Removed unsupported Enterprise availability and unapproved competitor-limit copy; both paid PayPal tiers are selectable. No scheduled collection, public free audit, full review coverage or production tenant completion is implied.

## Approved pricing and access

Business is $49/month for one monitored business; Growth is $149/month for five, in any owned/competitor mix. Known identical listings count once; unresolved saved links count until resolved. Enterprise has a commercial unlimited-entities plan, with storage/throughput work still pending. Ordinary Google login requests identity scopes only; optional Business Profile access requests business.manage separately. No owned comparison reference is required to save competitors. Combined limits are enforced by MySQL transactions. The legacy competitor-create endpoint is retired so it cannot bypass watchlist limits. Production tenant authentication and PayPal lifecycle testing remain release gates.

Approved refresh cadence: Business ($49) every 12 hours; Growth ($149) every 6 hours. The pricing UI records these planned intervals; automatic scheduling is not implemented or enabled yet.

## Facebook and Trustpilot addition — 2026-09-06

Approved: one saved Google business can link Facebook and Trustpilot in the same paid slot. Local profile linking, MySQL persistence, bounded public JSON-LD collection attempts, separate partial snapshots and manual report locators are implemented at /platforms. Actual Facebook/Trustpilot collection remains unverified: live probes were blocked or returned no review data. Reliable collectors, platform-specific AI analysis, reporting cases and recurring schedules are pending. See [MULTIPLATFORM-PLAN.md](MULTIPLATFORM-PLAN.md) for the exact supported scope, access findings and remaining architecture.

## Customer flow and alerts — 2026-09-06

Home now guides Protect my business and Monitor competitors, with grouped sidebar and contextual steps through evidence, alerts and reports. Review library moved to /evidence; old dataset deep links remain compatible. /alerts computes observations from saved Google snapshots: newly observed 1–2-star reviews, review-count jumps, rating drops and public profile changes. It is not durable background alerting. In-app + email + WhatsApp through Meta delivery is approved; email delivery and Meta WhatsApp connections and recipients remain unconfigured. No messages sent. See [USER-FLOW.md](USER-FLOW.md) for exact rules, limitations, advanced-tool placement and verification.
