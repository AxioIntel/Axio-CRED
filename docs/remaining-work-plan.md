# Axio-CRED remaining work plan

Reviewed 2026-09-09 at commit `5e84451` on `main`.

## Objective and scope

Finish the existing evidence-based business protection and competitor monitoring application, progressing from the local MVP to a tested private pilot and then public launch. Keep React, Express, MySQL and the repository Go collector. Preserve collected evidence and extend the modular monolith incrementally.

This document sequences the remaining work. [Product architecture](../app/PRODUCT-ARCHITECTURE.md) remains the product and architecture baseline; [ADR 001](../app/docs/adr/001-evidence-centered-monolith.md) records the persistence strategy. Root `docs/saas.md`, `recipes.md`, `proxies.md` and `development-saas.md` describe the upstream scraper. Its PostgreSQL/River SaaS is separate from Axio-CRED's MySQL application.

This review changed documentation only. It did not run migrations, collect business data, call paid providers, send notifications, create subscriptions or deploy infrastructure.

## Current position

| Area | Existing implementation | Remaining gap |
|---|---|---|
| Customer experience | Landing/pricing, businesses, competitors, evidence, reports, platforms, enrichment and settings | Authenticate real customers and validate the complete journey |
| Evidence | Normalized imports, provenance, indexed subjects/snapshots/review observations, atomic saves, direct dataset lookup | Collection quality, identity aliases, bounded history APIs and retention |
| Collection | Exact Place ID discovery, native extended reviews, deduplication and explicit partial coverage | Windows-local process/file coordinator; durable Linux worker missing |
| Analysis | Provider adapter, quote/reference checks, cached resumable batches of 30, pattern observations | Durable orchestration, tenant budgets and quality evaluation on larger usable collections |
| Reporting | Human-reviewed kits, cases, assignment and outcome records | Full tenant/role authorization and production identity verification |
| Billing | Shared prices/limits, provider signature verification and transactional replay handling | Stable subscription ownership and full lifecycle entitlement reconciliation |
| Monitoring | Snapshot comparisons and in-app observations | Scheduled collection, persistent deduplicated alerts and delivery outbox |
| Production | Container/Bicep definitions and CI gates | Customer API intentionally returns 503 pending tenant authorization; collector absent from app image |

Source checks confirm that `server.ts` creates one application store, `app.ts` returns a fixed preview workspace in the session endpoint, and legacy snapshot paths in `mysql-store.ts` contain queries by business/subject ID without workspace predicates. The newer evidence index does not solve authorization for those routes.

### Documentation reconciliation

- Earlier claims that AI can assess only 30 reviews total are stale: `review-analysis.ts` resumes from the saved analyzed count. Extend this implementation instead of rebuilding batching.
- The Azure setup notes record successful live analysis, including a later model deployment. Those are historical verification records; credentials and current provider availability were not rechecked here.
- PayPal setup records live catalog plans, not a tested subscription lifecycle. A separate sandbox application/buyer is needed for payment testing.
- The latest native collection report supersedes the earlier ten-review limitation: it records 1,170 IDs against 1,169 reported, 866 usable texts and 294 quarantined texts. The discrepancy remains unresolved. The final selector correction has regression coverage but no documented repeat of the full live collection.
- `.azure/deployment-plan.md` still describes local crawling as unconnected and names a removed customer-app workflow. Local discovery now exists; durable cloud collection does not. Current workflows are `ci.yml` and `publish.yml`.
- Historical validation references another checkout and locally provisioned tools. These are not evidence that this checkout is ready to run.

## Delivery sequence

Progress update: [local 6/12-hour schedules](scheduled-monitoring.md) now provide opt-in recurring native collection and saved due/lease state. This delivers a local portion of milestone 4 and expands milestone 5's comparison rules; it does not complete the hosted worker, tenant/billing boundary or notification outbox.

### 0. Restore the development baseline

1. Reproduce the pinned CI runtime locally: Node 22 and the Go version declared in `go.mod`; install npm dependencies from the lockfile.
2. Establish a disposable MySQL test database and supported collector/browser runtime. Keep real stored evidence separate from synthetic test data.
3. Run app lint, TypeScript checks, unit tests and builds; run migration/isolation verification on the disposable database and appropriate Go checks. Use Linux CI for race and container checks.
4. Update stale setup/status references and record exact commands, versions and results in a new validation entry.

**Acceptance:** a new checkout can run the app and required checks using documented steps, without relying on another machine's ignored `.tools`, `.dev` or `.env` files.

### 1. Close the evidence-quality gap

1. Verify the final native selector and review/reply separation with fixtures covering the observed failure, star-only reviews, translations and repeated IDs.
2. Run a bounded recollection against the known listing using the corrected binary, retaining the previous dataset and raw provenance. Record runtime, stop reason, reported count, collected count and usable/quarantined text separately.
3. Investigate the one-record discrepancy; preserve an explicit unresolved status if it cannot be explained. Never infer completeness from a count comparison alone.
4. Exercise analysis resume and source binding with synthetic batches first, then a metered usable collection when provider testing is authorized. Verify that old assessments cannot appear to cover a newer dataset.

**Acceptance:** review text is not copied from owner replies; unresolved capture problems remain visible; reports cite the correct dataset; failures and partial results cannot appear complete. Recovery of all missing text is not a prerequisite for honest partial operation.

### 2. Implement tenant identity and authorization

1. Add users, workspace memberships and revocable sessions using additive migrations. Bind identity to stable provider subjects and use identity-only login independently of optional Business Profile access.
2. Resolve workspace and role on each request; construct scoped repositories/services from that trusted context. Remove preview owner/plan defaults from authenticated customer paths.
3. Inventory every route and store operation, including legacy snapshots, imports/exports, collection status/artifacts, analysis caches, platforms, reports, integrations and billing. Enforce parent ownership and workspace predicates/composite foreign keys as applicable.
4. Apply explicit owner/member/reporting permissions, session expiry/revocation, CSRF protection for cookie-authenticated writes and validated OAuth state/redirect handling.
5. Retain the production block until the route inventory is covered. Then expose only intentional public auth/health routes and a separately verified provider webhook boundary.

**Acceptance:** two tenants and a lower-privilege member cannot read, mutate, export, analyze or run jobs against each other's resources, including guessed IDs and stale sessions. Anonymous customer access is denied before provider work.

### 3. Complete subscription ownership and entitlements

Depends on tenant identity.

1. Persist a checkout intent bound to the authenticated workspace and map returned provider subscription IDs to that owner. Never choose ownership from an untrusted webhook workspace field.
2. Resolve subscription/payment events without depending on every event containing a plan ID. Handle activation, updates, suspension, expiration, cancellation, failed payment, refunds and reversals according to an explicit access policy.
3. Preserve transactional event processing; handle duplicate, delayed and out-of-order events and reconcile against provider state when necessary.
4. Test with sandbox credentials and a test buyer. Preserve Business $49/one business and Growth $149/five businesses with shared owned/competitor allowance.

**Acceptance:** forged or replayed events cannot grant access; failures roll back; retries converge; the wrong workspace cannot claim a subscription; entitlement changes match the agreed lifecycle policy.

### 4. Build one durable collection and analysis worker

Depends on tenant scoping; paid scheduling also depends on billing.

1. Use MySQL as the initial job authority, consistent with the existing application. Add runs, attempts, leases, fencing/ownership checks, heartbeats, deduplication keys, cancellation, retry/backoff and budget reservations.
2. Replace API-owned subprocess execution with a separate bounded Linux collector worker. Validate Chromium and required scraper fixes in the worker image; local Windows patching is not container validation.
3. Persist artifacts with workspace-scoped access and checksums; integrate private Blob storage for staging. Commit normalized evidence and its projection atomically.
4. Schedule Business every 12 hours and Growth every 6 hours, with jitter, capacity limits and no overlapping runs for the same monitored identity. Handle suspension and missed schedules explicitly.
5. Put existing resumable analysis behind the same job authority with per-workspace token budgets and shared admission limits. Preserve checkpoints and cache reuse; account for ambiguous provider outcomes before retrying billable work.
6. Meter worker time, retries, bytes, coverage and model tokens. Keep Outscraper disabled unless separately enabled with a budget.

**Acceptance:** a worker restart or expired lease recovers safely; competing workers cannot both commit the same run; schedules survive API restarts; quotas hold under concurrency; partial results and job failures remain distinguishable.

### 5. Persist alerts and deliver notifications

Depends on durable runs and comparable evidence snapshots.

1. Convert current snapshot comparison rules into stored alert events with stable deduplication keys, linked source snapshots, read/dismiss state and a retention policy.
2. Create a transactional notification outbox and delivery attempts. Implement retry/backoff, destination verification, opt-outs, consent and approved templates.
3. Support the recorded channel scope: in-app, email and Meta WhatsApp. Validate external delivery with explicitly authorized test recipients.

**Acceptance:** repeated detection creates one logical alert; dispatch retries retain deduplication/audit records; every alert opens its evidence; failed deliveries are visible and do not mark a collection unsuccessful.

### 6. Consolidate persistence and qualify private staging

Implement schema changes needed by earlier milestones within those milestones; avoid a full rewrite prerequisite.

1. Introduce monitored-subject aliases and purpose flags, then relational platform profiles, analysis findings and case events with reconciled backfills. Do not create a competing watchlist or charge twice for one known business.
2. Add paginated history and memory-bounded summary APIs. Decide and implement deletion/retention across JSON evidence, projections, artifacts, analyses, cases and backups.
3. Update Bicep for API/worker separation, secret management, scoped identities, database networking and evidence storage. Select subscription/region/registry before cloud validation.
4. Rehearse migrations and application rollback, backup restore, worker recovery, observability and load at the proposed cadence.
5. Validate the complete pilot journey: login → subscribe → add business → scheduled collection → inspect coverage → assessment → alert → human-reviewed report.

**Acceptance:** private staging passes tenant, billing, recovery, retention and end-to-end tests. Public access remains gated until all required evidence is recorded and product claims match supported behavior.

### 7. Expand after the core pilot

- Metered free audit with abuse protection, bounded cost and conversion flow.
- Reliable Facebook/Trustpilot adapters with validated access, pagination, source-specific coverage and policies; present JSON-LD linking remains limited.
- Authorized Business Profile collectors/corrections, specialist case evidence, neutral review requests and CRM integrations.
- Scoped enterprise API keys, rotation/revocation, jobs APIs, pagination, signed outbound webhooks and measured capacity.
- Reviewer-history, rank and other enrichment work only after collector feasibility is demonstrated.

## Decisions needed at the relevant milestone

These do not block local baseline work or writing tenant-isolation tests.

| Decision/configuration | Needed before |
|---|---|
| Initial launch markets and applicable product/privacy requirements | Retention policy and public pilot approval |
| Retention periods, deletion behavior and per-plan collection/AI budgets | Unattended production operation |
| Cancellation/refund grace and downgrade behavior | Billing lifecycle acceptance |
| Google identity project and exact redirect configuration | Live sign-in verification |
| Separate PayPal sandbox app/buyer | Subscription lifecycle smoke tests |
| Azure subscription, region, registry and operational ownership | Staging resource creation |
| Email sender, Meta configuration and authorized test recipients | External notification testing |

Keep credentials in private environment/secret storage. Current provider configuration must be checked without assuming earlier machines' settings exist.

## Verification performed during this review

- Git checkout started clean at the merged MVP/PR-fix commit; branch is `main`.
- CI guard tests: **4 passed**.
- CI guard: **passed** action pinning, runtime alignment in committed configuration, lockfile consistency, disabled fallback defaults and tracked-file checks.
- Local Node is **24.8.0**, while the app Dockerfile/CI target Node 22. `app/node_modules` is absent. Go, Docker and make were not found on PATH.
- Full app tests/builds, database checks, live collection, provider status and remote CI results were not verified in this review. Earlier documents' test totals are historical, not fresh results.

## First implementation increment

Local setup has now been completed in this checkout; see [setup and validation](local-setup.md). The app runs on dedicated ports with an isolated MySQL database, installed collector runtime and passing app/database/targeted Go checks. Linux race/container checks and a fresh live collector validation remain separate gates.

Start with milestone 0, then verify the collector correction in milestone 1. The first production-enabling PR should deliver the tenant/session schema, request-scoped store boundary and a route authorization matrix with two-tenant denial tests. Keep production access closed while extending that coverage across legacy routes. Billing and durable jobs follow that boundary; further dashboard expansion is lower priority.
