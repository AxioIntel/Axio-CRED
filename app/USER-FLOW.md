# Customer workflow and alert experience

> Current status and architecture: [PRODUCT-ARCHITECTURE.md](PRODUCT-ARCHITECTURE.md), updated 2026-09-09. This document preserves earlier requirements and design detail.

Updated 2026-09-06. Primary goals: protect the user's own business; monitor and investigate competitors; prepare evidence-backed manual reports. Business ownership is optional.

## Navigation and next actions

- /overview is the action-oriented home: Protect my business and Monitor competitors. New users add a business directly; returning users open their businesses/watchlist. Manual preview records are explained when their slots differ from the real linked portfolio.
- Sidebar: Workspace home; Protect my business; Monitor competitors; Alerts & changes; Report queue. Review library, Linked platforms, Contact enrichment and Settings & billing are in Tools & settings. Mobile uses a labeled menu drawer; tablets have titled icons and an expandable tools menu.
- Contextual sub-navigation: Businesses/watchlist → Review evidence → Alerts & changes → Report queue. Scope is retained through the handoff.
- Add competitor opens the existing business finder directly. Optional reference-business comparison and manual Maps links/import matching live under secondary controls.
- /evidence is the review library. Owned/competitor scopes filter business identities; dataset, listing and review links select and highlight the exact review. Existing /overview?dataset= links still open evidence for compatibility.
- /reports leads with the real manual reporting queue and next-step instructions. CSV, transaction hashes and the explicitly labeled operator incident export remain in advanced tools. Legacy synthetic integrity/investigation screens redirect to observed changes; underlying records are preserved.

## Alert rules available locally

The in-app feed is computed when opened from the loaded dataset window (currently up to 20 imports), for selected Google businesses only. It is not a persisted notification/event service. Illustrative datasets and collections without timestamps do not produce new-change events. A first snapshot is a baseline, not an alert.

- Low-rated review: 1 or 2 stars, absent from every earlier loaded sample, present in the latest timestamped sample. Wording is newly observed, not newly posted: collection backfill cannot establish the actual posting date.
- Review activity jump: reported review count increases by at least 10 across two snapshots no more than 24 hours apart. This is an explicit initial investigation threshold, not calibrated fraud detection.
- Rating drop: reported rating decreases between the last two timed snapshots.
- Profile edit: comparable non-missing address, category, phone, website, status, coordinates or hours change. These can be legitimate edits.

Each observation provides the business, time window, rule explanation, source dataset and a review/evidence deep link. The feed can filter owned/competitor scope and event type. Zero matching observations never means complete coverage or proven protection. A burst is not a reporting reason by itself.

## Approved delivery channels

User selected in-app inbox, email and WhatsApp through Meta. All three are represented in alert setup/status. Email and WhatsApp are not connected and no messages were sent. Next engineering: durable server-side detections and event IDs, per-tenant alert preferences and destinations, consent/verification, notification outbox, configured email delivery and Meta WhatsApp connections, retry/deduplication, quiet hours and delivery history. Hook these into the approved twice/four-times-daily schedules when the collection scheduler is built. No automatic schedule is running today.

## Verification

29 frontend tests pass; frontend production build passes. Tests cover first-baseline suppression, sampled-review backfill semantics, review/count/rating/profile changes, long-window burst exclusion, unrelated imports, owned/competitor identity merging, independent onboarding paths, channel status and mobile navigation. Existing import/enrichment/report-kit tests remain passing. A test DOM needed the dialog showModal shim; corrected and reran successfully.

Live Chromium verified both finders, competitor-only evidence options, 375/390/768/1024/1440px home layout, tablet tools and mobile drawer routing, plus a filtered alert → highlighted review handoff using isolated browser response fixtures. No business records were changed and no external report or notification was sent. Synthetic ledger exports are explicitly labeled. Durable background alerting, delivery, tenant isolation, broader browser testing and production release remain pending.

Channel correction: the user replaced SMS with WhatsApp through Meta. The approved channels are in-app, email and Meta WhatsApp. No SMS delivery is in scope. This is a UI and architecture correction; the Meta connection and actual message delivery remain unimplemented.


## Screenshot-based reputation dashboards — 2026-09-06

The default /competitors view now opens the selected competitor's dark review dashboard; /businesses opens a separate owner dashboard. Both use the supplied visual references for metrics, saved rating history, sample distribution, review triage, expandable report kits, policy categories and collection activity. Watchlist/reference management and the owned-business directory remain available below each dashboard. Existing profile-history tools, scraper refresh, reporting queue and linked-platform workflows are retained.

Metrics use actual collected listing totals and samples. Review count change is the net delta between dated snapshots, not a claim about reviews posted this week. The chart shows collected listing ratings, not invented weekly averages. Flag totals stay unknown until a matching saved AI assessment exists; priorities are not calibrated probabilities. Distribution is explicitly the collected sample. No reviewer histories or spam scores are invented.

The owner dashboard adds a next-action prompt, low-rating and no-collected-reply filters, editable response drafts with copy and Google Maps links, collected owner replies, profile-field differences and alert/management-access links. Responses are not published automatically. Review analysis now accepts selected owned listings as well as selected competitors, preserving membership checks. API credentials are still required. Draft text must be copied before leaving the panel.

Collection remains on demand. Scheduled checks twice/four times a day and in-app/email/Meta WhatsApp delivery workers remain pending; no SMS delivery is planned. Facebook/Trustpilot remain in the linked-platform workspace, with successful live collection still unverified. No automatic complaint submission was added.
