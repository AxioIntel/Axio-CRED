# Google, Facebook and Trustpilot monitoring

> Current status and architecture: [PRODUCT-ARCHITECTURE.md](PRODUCT-ARCHITECTURE.md), updated 2026-09-09. This document preserves earlier requirements and design detail.

Approved 2026-09-06: a business must have a saved Google listing. The same business may link one Facebook Page and one Trustpilot company profile, all within one paid slot. No business ownership or management permission is needed to save these public links. $49 covers one business at the planned 12-hour cadence; $149 covers five at the planned 6-hour cadence. Schedules are not enabled yet.

## Implemented locally

- /platforms workspace, reachable from Businesses and Competitor detail. Google listing identity is the reference; platform records do not change entitlements.
- Explicit same-business confirmation; canonical platform URL validation; one platform URL cannot silently map to several businesses. Company-level profiles spanning multiple branches need a later explicit grouping model.
- MySQL platform_workspaces JSON state uses serialized transactional mutations. Server-owned snapshots and errors cannot be supplied through the profile-link API. Demo store mirrors the contract.
- Bounded public HTML collector: fixed Facebook/Trustpilot hosts, no redirects or login, 20-second timeout, 3 MB response limit, up to 100 structured review texts, two concurrent attempts per API process, one-minute cooldown. It reads JSON-LD when publicly present; this is not a full Facebook or Trustpilot scraper.
- Each source retains three partial snapshots with collection time, source URL, observed rating/count, review text and content hash. Failed attempts retain old evidence without marking it fresh. Changing a URL clears its previous snapshots; unlinking explicitly removes this preview evidence.
- Platform-specific review display and expandable manual review locators/TXT export. These establish no fake-review finding and never submit complaints. Facebook Recommendations are not coerced into star ratings, and ratings are never blended across platforms.
- New platform endpoints are disabled in production until tenant authorization is integrated. Existing app-wide tenant isolation remains a separate release gate.

## Verified limits and next engineering

Live public requests to Trustpilot's own company profile returned HTTP 403; Facebook's Trustpilot reviews URL returned HTTP 404 and no JSON-LD. These probes do not prove all profiles inaccessible, but there is no verified successful live Facebook/Trustpilot collection yet. Parser success is fixture-tested only. No customer platform links have been supplied or guessed.

Trustpilot documents API-key-authenticated business profile and public reviews endpoints: https://developers.trustpilot.com/business-units-api . An API adapter, entitlement/access validation and configured credentials remain pending. Facebook's exact current Page review access must be verified with approved Meta access or an evaluated collection provider; no connector approval or access has been established. Neither is supplied by the Google Go scraper or by ChatGPT.

Remaining scope: reliable platform collectors, review pagination/reconciliation, durable jobs, per-platform coverage and freshness, Facebook/Trustpilot-specific AI policy analysis, reporting-case workflows, alert delivery, and the agreed tier schedules. The existing Google AI/reporting implementation is not reused as if other platforms had Google's rules.

For production replace the bounded workspace JSON with indexed business-platform/review/snapshot tables, tenant-level authorization, durable leases, explicit retention controls and shared worker budgets. One slot does not imply unlimited collection cost.
