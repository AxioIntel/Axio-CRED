# Axio-CRED customer application

**Current product, architecture and delivery baseline:** [PRODUCT-ARCHITECTURE.md](PRODUCT-ARCHITECTURE.md), including current and target ER diagrams. [ARCHITECTURE-VALIDATION.md](ARCHITECTURE-VALIDATION.md) records the local verification. [CONVERSATION-AUDIT.md](CONVERSATION-AUDIT.md) is the earlier requirement history.

The customer app is in this folder; the repository Go scraper is the chosen public-data collector. The official Places collection path is disabled.

Production customer API access returns **503** until tenant authorization exists; only health/readiness API routes remain accessible. Local development continues to work. Implementation through `9bd026b` was merged in [PR #1](https://github.com/AxioIntel/Axio-CRED/pull/1) on 9 September 2026. These documentation corrections are a follow-up; no production deployment is claimed.

## Collecting with the native scraper

Open `/collections` for batch discovery, center/grid searches, language, website-email and extended-review options. Inspect saved datasets in the review library, then select businesses to protect or monitor. The native scraper is primary; broad collection never invokes Outscraper. See [native feature parity and architecture](NATIVE-COLLECTION-ARCHITECTURE.md) for configuration, limits and the complete gosom commit audit.

Optional server configuration is documented in `.env.example`: `NATIVE_SCRAPER_BINARY`, `NATIVE_SCRAPER_PROXIES_FILE`, and bounded worker tuning. No proxy credentials belong in the browser or git.

## Local preview

From this folder in PowerShell:

```powershell
.\scripts\dev-start.ps1
.\scripts\dev-check.ps1
```

Open http://localhost:5173/overview for your next business-protection and competitor-monitoring actions. Evidence lives at `/evidence`; discovered contacts live at `/enrichment`. The evidence library offers a clearly labelled illustrative sample separately from collected data.

Open http://localhost:5173/competitors for the dedicated watchlist. Add a Google Place ID or use the business finder; a reference business is optional. Collect reviews, inspect source coverage, then assess and prepare a human-reviewed report when supported. Run `npm run migrate -w backend` before starting an updated backend. `/settings` shows the actual allowance and connection readiness.

For a fresh setup, run `scripts/dev-setup.ps1 -DemoOnly`, or `scripts/dev-setup.ps1 -PasswordlessRoot` on this development PC to configure local MySQL. The application password is prompted privately; root credentials are not stored. Existing environment configuration is ignored by Git.

## Optional advanced import

Choose **Import scraper JSON**. Supports Go Entry arrays, a single Entry, JSONL, or an object with an entries/results array. Each entry must have a title. The UI accepts files below 9 MB; the API allows up to 10 MB and 1,000 listings per import.

For a reproducible local test, import `fixtures/illustrative-scraper-export.json`. It contains one explicitly fictional listing with a duplicated review to exercise deduplication; it is not collected business evidence.

The dashboard persists normalized imports in MySQL and supports search, filtering, listing facts, review text/replies, contact correlations and exports. JSON import time is recorded independently from collection time; an export without a collection timestamp is labelled unknown. Unknown values are not rendered as zero.

The enrichment workspace exposes website-discovered emails, phone numbers and websites. Email verification is not implemented. Contacts are not sent to anybody when imported or exported.

Built-in local search is available at `/businesses` → **Add business**. Enter a business name and city or a Google Maps link, run **Search Google Maps**, check the returned address, then **Add selected business**. The API runs the repository scraper, polls job status, saves results in MySQL and links the selected listing to your business by Place ID/CID. JSON import is an optional advanced tool. Search collects public listing details and a review subset; it does not prove ownership or grant Google management access.

The local worker allows one active search, depth 1, a three-minute timeout and at most 20 returned listings. Job metadata/raw results remain in `.dev/discovery/`; interrupted jobs are reported as failed after restart. This is a single-process Windows preview, not the planned durable Azure queue. Run the database migration when updating to create `business_sources`. A built scraper and Chromium runtime are required (see below). If the tool sandbox blocks browser networking, start the local API from a normal network-enabled terminal; the API binds to loopback in local mode. Webhooks and recurring monitoring remain planned.

## Repeat the real-business smoke test

The project-local Go runtime and Chromium are under ignored `.tools/`. From this app directory:

```powershell
node scripts/build-local-scraper.mjs
node scripts/local-collect.mjs --url 'https://www.google.com/maps/search/?api=1&query=Dream+Coffee+Ilion+Greece&query_place_id=ChIJoRVrMS-joRQRkzrMbbRUnBY' --place-id ChIJoRVrMS-joRQRkzrMbbRUnBY --label 'Dream Coffee - live local test'
```

The script runs one scrape job at a time, stops after six minutes, checks the expected Place ID, and saves matching results to the running local API. Logs, raw output and provenance remain in `.dev/collections/`. Zero or ambiguous matches are not imported. `--email` enables website crawling explicitly; the smoke test omits it because this listing links to a third-party directory.

For a resolved Maps URL whose Place ID is not yet known, `--cid <decimal CID>` can supply the exact identity check instead. Resolve share links in the browser first; search names alone are not accepted as an identity check.

The local build uses an isolated copy of pinned `scrapemate v1.3.0` to correct its inverted page-closed check and nil-page recovery, and replace its crashing Windows browser flags with normal Chromium defaults. The repository `go.mod` and module cache are untouched. These fixes are local to this recipe and are **not applied to the Azure Docker build**.

See [LOCAL-TEST-REPORT.md](LOCAL-TEST-REPORT.md) for verified results and remaining release gates.

## Checks

```powershell
npm run migrate -w backend
npm run check
npm test
npm run build
```

## Integrations and Azure

Google Business Profile auth and PayPal use placeholders until credentials are configured. Live public audits and Places lookup are disabled; they do not silently fall back to the official API.

The existing Bicep defines web/API Container Apps, MySQL Flexible Server, storage and logs. A separate scraper worker and MySQL job coordinator are planned; the current Bicep does not provision them. The scraper SaaS edition has a PostgreSQL/River dependency, so it cannot simply be pointed at MySQL.

See [deployment plan](../.azure/deployment-plan.md) and [capability matrix](CAPABILITIES.md) for implemented versus planned behavior. Production tenant authentication, authorization and usage enforcement still need hardening beyond the local fixed preview workspace.

## Direct Place ID entry

The business picker defaults to **Use Place ID**, linking to Google’s hosted Place ID finder. Customers copy the ID, load the listing, confirm its address and select it. Existing exact IDs reuse saved evidence with its collection date; unknown IDs go through one targeted Maps URL and must return the same Place ID before anything is saved. This does not embed Google’s API widget or enable the official Places API. Name/city search remains available as a secondary option. A direct ID skips broad discovery, but first-time public details/review collection still takes time.

## OpenAI review analysis (local MVP)

Choose `AI_PROVIDER=azure` with `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT` and the exact `AZURE_OPENAI_DEPLOYMENT` name, or `AI_PROVIDER=openai` with `OPENAI_API_KEY` and optional `OPENAI_MODEL` (code default `gpt-4.1-mini-2025-04-14`). Configure only the ignored backend `.env`, never VITE_ variables, and restart the backend. Provider/model availability must be verified separately; no latest-model claim is implied. In Competitors, inspect a collected competitor and click Analyze collected reviews; the same panel appears beside its review evidence. No automatic submissions. Live provider verification requires a configured, funded API project.

The UI processes the collected corpus in sequential batches of at most 30 review records in source order, text capped at 2,400 characters and owner replies at 1,000. Author-name and profile-link fields are omitted; text may contain personal information. `store:false` is used, not a claim of zero provider retention. Results use qualitative investigation priority rather than uncalibrated fake probabilities. Every review reference and evidence quotation is validated; incomplete, refused, malformed or fabricated-quote responses are not saved. Model output is advisory, not proof, and still requires human verification.

Reports persist in MySQL `review_analyses`, cached by source input, model and prompt version. One in-flight analysis is allowed per API process, same-request retries share it, and output is capped at 12,000 tokens with a 120-second deadline per batch. Run the migration before starting. This fixed local preview still needs tenant auth, retention/deletion, per-tenant budgets and quality evaluation before public launch. A representative labeled dataset would be necessary to calibrate any future probability score.

Sources checked 2026-09-06: https://developers.openai.com/api/docs/guides/structured-outputs ; https://developers.openai.com/api/docs/models/gpt-4.1-mini ; https://support.google.com/contributionpolicy/answer/7400114?hl=en ; https://support.google.com/contributionpolicy/answer/7445749 .

## Approved pricing and access

Business is $49/month for one monitored business; Growth is $149/month for five, in any owned/competitor mix. Known identical listings count once; unresolved saved links count until resolved. Enterprise has a commercial unlimited-entities plan, with storage/throughput work still pending. Ordinary Google login requests identity scopes only; optional Business Profile access requests business.manage separately. No owned comparison reference is required to save competitors. Combined limits are enforced by MySQL transactions. The legacy competitor-create endpoint is retired so it cannot bypass watchlist limits. Production tenant authentication and PayPal lifecycle testing remain release gates.

Approved refresh cadence: Business ($49) every 12 hours; Growth ($149) every 6 hours. The pricing UI records these planned intervals; automatic scheduling is not implemented or enabled yet.

Marketing preview: http://localhost:5173/ . Plan feature comparison: http://localhost:5173/pricing . App dashboard: http://localhost:5173/overview . Fixed plan wording uses twice/four times a day, with scheduled checks explicitly marked as planned.
