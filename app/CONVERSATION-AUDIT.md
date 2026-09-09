# Axio-CRED conversation-to-implementation audit

> Current status and architecture: [PRODUCT-ARCHITECTURE.md](PRODUCT-ARCHITECTURE.md), updated 2026-09-09. This document preserves earlier requirements and design detail.

Audit date: 2026-09-06. Scope: the full supplied conversation, both capability tables, the strategic assessment (Exomill is Axio-CRED), the dashboard/report-kit references, and the current repository and local MySQL app.

**Conclusion: the local prototype works, but the full planned SaaS has not been delivered.** Several earlier updates described individual features correctly while failing to make the remaining product work sufficiently prominent. Credentials alone will not complete this product. This document records engineering omissions separately from integration setup and limitations that cannot honestly be promised.

Statuses: **Local** = implemented and testable locally; **Partial** = useful implementation exists but the requested workflow is incomplete; **Missing** = engineering still required; **Setup** = external configuration/testing required; **Replaced** = a later explicit user decision changed the requirement; **Unproven** = needs evidence or a validated collector; **Not offered** = cannot truthfully or appropriately promise the proposed behavior.

## Decisions and foundations

| ID | Your request / decision | Status and evidence | What remains |
|---|---|---|---|
| F01 | Connect AxioIntel/Axio-CRED; use the scraper already in the repo | Local: Git origin is the requested repository; existing Go scraper used | App work is local and substantially untracked; no commit, push, PR or release has been completed |
| F02 | Project subfolder inside Codex, not Claude | Local: E:/Codex/Axio-CRED; customer app under app/ | None for folder choice |
| F03 | One frontend/backend repo | Local: React/Vite frontend, Node backend and Go collector in one repository | Production CI/deployment verification |
| F04 | Azure, MySQL 8 and local preview | Local MySQL preview; Azure Bicep/Docker definitions are Partial | Azure subscription, region, registry, validation, worker design and actual deployment; no Azure service is live |
| F05 | Azure rather than GCP application hosting | Resolved | Google OAuth/GBP project approval is still necessary for Google integrations; that does not move app hosting to GCP |
| F06 | Fully functional customer login, businesses and competitors | Partial: identity-only Google login code, no business ownership prerequisite; optional Business Profile connection; local operator available | Tenant membership, workspace selection and authorization across all routes; current store uses one fixed workspace |
| F07 | Connect owned businesses through Google Business Profile | Partial + Setup: OAuth and paginated account/location reads; category/read-mask bug fixed in this audit | Live approved Google project, consent verification as applicable, correct account/resource persistence, complete owned-profile sync; public selection alone does not prove ownership |
| F08 | One free audit | Missing: public audit UI and quota/cache helpers exist, but /api/public-audits is disabled | Scraper-backed public-audit job/result flow, identity/abuse controls, failure/refund-of-allowance semantics and separate paid capacity |
| F09 | $49 for one monitored business; $149 for five (supersedes $50/$150) | Local: combined owned/watchlist allowance, identity deduplication, transactional MySQL limits, pricing and both PayPal checkout choices; plan amount validated before checkout | PayPal sandbox plans must match new prices; full subscription renewal/cancellation/delinquency behavior remains incomplete |
| F10 | Enterprise unlimited monitored businesses | Partial commercial plan only | Current watchlist validator caps at 500. Paginated entity storage, real enterprise entitlements, budgets, throughput and SLA needed; unlimited entities is not unlimited compute |
| F11 | Use PayPal | Partial + Setup: subscription and verified-webhook code exists | Real sandbox credentials, product/plan IDs, webhook registration and full lifecycle tests. No live payment taken; checkout is not an account-management portal |
| F12 | Local test before going live | Local: real White Dental and Dental Kraft data collected | No production release approval implied; complete the release gates below |

## Collection, investigation and dashboard

| ID | Your request / decision | Status and evidence | What remains |
|---|---|---|---|
| C01 | Avoid official Places API | Local: collection endpoints disabled; scraper is active | Preserve this choice in public audits and future workers |
| C02 | Search/select real business by name/link | Local: bounded asynchronous search and exact-identity selection | Durable worker queue, better error recovery and production throughput |
| C03 | Direct Place ID entry; link to Google's finder for own/competitor listings | Local | CID-only records lack the new exact-Place-ID refresh action |
| C04 | Inbuilt collection rather than mandatory JSON import | Local for search; explicit fresh/extended collection added in this audit | Public free-audit connection and schedules. JSON remains an optional operator tool |
| C05 | Correct Dental Kraft from owned to competitor | Local: saved to watchlist, erroneous owned row corrected earlier with backup | Existing Northstar preview records remain; they were not silently deleted |
| C06 | Competitors screen distinct from dashboard | Local | Greater scale/pagination and actual recurring status |
| C07 | Separate enrichment workspace | Local for website-discovered contacts, filters and CSV | Email collection is available in operator CLI; the normal picker does not enable website crawling |
| C08 | Internal Maps requests/headless scraper on server | Local Windows worker verified | Linux/Azure image and runtime are not equivalent to local patched dependency build |
| C09 | Residential/mobile proxy pools and rotation | Setup + Unproven: repo has proxy configuration, no pool is included | Provider selection, costs, authorization and benchmark. No proxy service bought, configured or promised |
| C10 | Async jobs, request IDs, polling, webhooks | Partial: local job IDs, files and polling | Durable MySQL leasing, retries/jitter/dead-letter queue, cancellation, restart recovery and signed webhook delivery |
| C11 | Continuous/hourly monitoring | Missing | App scheduler, persisted cadence, jobs, reconciliation and delivery. Business $49: every 12 hours; Growth $149: every 6 hours. Tier mapping approved; scheduler not enabled |
| C12 | Ratings and review-count velocity | Partial: timestamped history and net-count changes added in this audit | Uses loaded datasets (currently latest 20), not all history; per-day figure requires ≥24h. No extrapolated fake-review counts |
| C13 | Full competitor review text/history | Partial collection + Unproven completeness | Extended collection is now available in UI, bounded at six minutes. Google may return a subset; API/DOM failures cannot be repaired by inventing missing text |
| C14 | Reviewer histories / same cluster of businesses | Partial: observed cross-business contributor-ID overlap added | Full public-profile collector, coverage indicators and history collection are unproven; never join identities by name alone |
| C15 | Maps spam/burner networks | Partial: shared phones/domains and approximately identical coordinates | Reliable entity normalization, wider spatial clustering, authoritative address/virtual-office evidence, investigator confirmation |
| C16 | Exact local three-pack rank at coordinate/query | Missing + Unproven | Separately validated rank collector with geography/device/query/time provenance; schematic maps and Nearby prominence are not rank |
| C17 | Website emails, extra phones, Whitepages, Yellowpages, WhatsApp, Trustpilot | Partial for website emails and listing phone only | Directory/verification providers and connectors, permissions, data minimization, provenance and cost. Discovered email does not mean verified |
| C18 | Frontend corresponding to mineable fields | Partial: identity, primary category, address, coordinates, hours, rating distribution, sampled reviews/replies, media counts, contacts | Full category arrays, all rich attributes, media inventory and additional raw fields are not all normalized/displayed |
| C19 | Timeline, weekly changes, rating trend, bursts, confidence, policy totals, activity from screenshots | Partial: actual history table, distributions and case ledger | Weekly/burst analysis, charts and triage aggregates still missing. No screenshot's fictional figures are to be copied as live data |
| C20 | Shared data architecture and source truth | Partial: MySQL normalized JSON imports and hashes; reporting source snapshot retained | Normalized entity/review/history schema, private Blob storage, retention/deletion, tenant access; MySQL/evidence remains authoritative, Pub/Sub is only a trigger |

## Owned-profile defense and strategic additions

| ID | Requested capability | Status and remaining work |
|---|---|---|
| D01 | Pin displacement, suite injection, category/phone/hours/closed-status changes | Partial: supplied-snapshot diff endpoints and now public saved-snapshot comparisons. Missing automatic owned GBP polling, approved baselines, full category/hours coverage and real alerts. A coordinate change does not prove sabotage or geocoding downgrade |
| D02 | SAB unmasking / changed service areas | Missing live auditor. Corrected owned-listing classification uses serviceArea.businessType; no automatic public/private reconciliation. regionCode is not an address-hidden flag |
| D03 | Automatic restoration of phone/address, pin or hidden SAB address | Missing; no provider writes implemented. Requires owner authority, approved baseline, field-level validation, conflict/reversion limits and audit trail. Cannot promise execution before suspension |
| D04 | Photos/media inventory and removal detection | Partial media links only. Missing full owner inventory, stable media identifiers, authoritative reconciliation and removal alerts; a missing sample item is not deletion |
| D05 | Q&A monitoring/spam | Missing collector. Official Q&A API was discontinued 2025-11-03; that route cannot be enabled by a ChatGPT key. Public collection must be separately proved |
| D06 | Visibility collapse through GBP Performance | Partial manual snapshot endpoint. Missing authorized Performance API retrieval, comparable time windows, scheduled sync and alerts |
| D07 | Hybrid Pub/Sub + reconciliation polling | Missing. Neither GBP notifications ingestion nor polling scheduler is connected; no event latency guarantees |
| D08 | CRM evidence vault / transaction hashing | Partial manual keyed-hash record. No ServiceTitan, Dentrix or Clio connectors, attachment storage, consent/retention or verified customer-to-review linkage |
| D09 | “Anti-DSA” proof and guaranteed restoration | Not offered as a guarantee. A hash can help detect changes to a stored record but cannot prove the original transaction happened or neutralize a legal process. Evidence export and jurisdiction-specific review remain needed |
| D10 | Extortion-specific route and evidence packet | Partial: official specialist guidance and required-evidence checklist added to kit. Missing structured communication uploads and dedicated packet generator. Only appropriate for directly experienced extortion; no guaranteed priority/removal |
| D11 | Recovery and Product Expert escalation packs | Partial: review locator, source, notes, case references, activity/outcome ledger and JSON/TXT export. Missing specialized appeal schema, attachments, original decisions, multi-incident chronology and escalation workflow |
| D12 | LSA fraud and spam networks | Missing LSA data/collector and validation. Shared listing coordinates alone do not prove ad interception |
| D13 | Unbiased review solicitation / lock out review gating | Missing Grow/request-sending module. No gating exists because there is no solicitation workflow yet. Build one uniform public-review path, opt-out controls and delivery consent; don't market an unbuilt compliance engine |

## AI and reporting

| ID | Your request | Status and remaining work |
|---|---|---|
| R01 | ChatGPT analysis of competitor reviews | Partial + Setup: server-side Responses API, strict output schema, quotes validated, MySQL cache. OPENAI_API_KEY absent; no actual model analysis has run |
| R02 | Probability of fakeness | Not supplied as a calibrated probability. Qualitative investigation priorities exist. Needs representative labels, independent evaluation and calibration; model confidence is not measured fraud probability |
| R03 | Include unsupported policy categories from examples | Advertising/solicitation omission fixed in this audit; new prompt/schema version. Further evaluation needed across languages, harassment, personal information, threats, spam and innocent alternatives |
| R04 | Analyze all collected reviews, not a small selection | Partial: current model call covers at most 30 records with text limits | Batch orchestration, merged coverage, per-tenant budgets and evaluation missing; no claim that all 1,162 reported Dental Kraft reviews were analyzed |
| R05 | Dropdown Report kit | Local: locator, original text, optional AI finding, editable notes, copy/download and correct public Maps reporting route |
| R06 | Auto report through up to 20 Google accounts | Replaced by your accepted team/case workflow. No account rotation or multi-account complaint amplification implemented |
| R07 | Workable team design: 20 authorized people | Local workflow + Setup: capped pending/active team, identity-only OAuth, independent sessions and revocation; external credentials absent. No invitation email is sent |
| R08 | Reports queue, assignment, approval and outcomes | Local: persisted cases, duplicate prevention, original source, versions, approval invalidation, manual-submission confirmation and ledger. Outcomes are user-recorded, not Google-verified |
| R09 | Auto add Coming soon + info button beneath Maps link | Local disabled control and explanation, per your explicit request. Future evidence queueing/assignment is deliberately not active |
| R10 | Bulk competitor-spam redressal CSV | Partial: corrected in this audit to use actual watchlist name/address/Maps URL, timestamp, dataset and evidence fields; formula-safe. Missing incident-level corroboration and tailored provider payload validation. It is a draft, not a submitted complaint |
| R11 | Mass automated complaints sold on purge count | Not offered. Accepted replacement is evidence-based individual case handling; no removal guarantees or payment tied to removals |
| R12 | Notification/WhatsApp/webhooks for new suspicious reviews or critical edits | Partial: in-app observations from saved snapshots. User approved in-app + email + WhatsApp through Meta. Missing durable detections, production dispatch, consent, destination verification, retries and sender setup |

## Economics, enterprise and release readiness

| ID | Request | Status and next action |
|---|---|---|
| E01 | Optimize scraper cost | Partial: exact-ID cache, single worker, bounded jobs, import/review dedup and on-demand analysis cache. Missing metering, paid/free queue partitioning, changed-only refresh, proxy budget, cadence and load benchmarks |
| E02 | Cost per free audit / $0.20 assumption | Unmeasured. No defensible cost figure is available; free audit is disabled. See COST-MODEL.md for the calculation and required measurements |
| E03 | Enterprise API | Prototype only: one overview endpoint and a shared environment key. Missing tenant scopes, key issuance/rotation/revocation, jobs API, paging, webhook signing, usage reporting, rate limits and documentation. Settings no longer claims these are available |
| E04 | Lawsuit/privacy risk | Not legally cleared. Target jurisdiction question pending; need privacy/retention terms, complaint safeguards, provider/data terms and qualified jurisdiction-specific review. No zero-lawsuit-risk or blanket compliance claim |
| E05 | Scalable Azure architecture | Partial Bicep; missing scraper worker, durable queue, network/TLS validation, secret management rollout, Blob integration and operational checks. Local Windows patch is not applied to container scraper build |
| E06 | MVP ready for real customers | Not achieved: missing tenant isolation, auth across legacy routes, live billing, free audit, recurring collection, retention/deletion, provider readiness and observability |
| E07 | Real tests and release evidence | Existing local tests plus audit regressions pass; actual collected examples available. No Azure deployment, no live OAuth/PayPal/OpenAI test, no load test and no full Go race-suite execution |

## Corrections to assumptions in the supplied report

- The FTC review rule went into effect on **October 21, 2024**, not as a new “2026 Consumer Review Rule.” The applicable rules and penalties require precise review; no fixed per-violation penalty or claim of immunity is built into product copy. [FTC FAQ](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers).
- Google's Q&A deprecation date is confirmed, including removal of Q&A notification types. No working replacement collector has been demonstrated here. [Google change log](https://developers.google.com/my-business/content/qanda/change-log).
- GBP quota limits vary by API and project. “300 QPM + 10,000 daily updates” is not a verified universal quota contract. [Google limits](https://developers.google.com/my-business/content/limits).
- Business Information uses `categories.primaryCategory`, `latlng`, `serviceArea` and metadata; the older `LocationState` object and `regionCode` cannot be treated as interchangeable visibility/security flags. [Location schema](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations).
- Extortion reporting needs evidence of the actual demand and directly affected business; it does not guarantee rapid takedown. [Google guidance](https://support.google.com/business/answer/16404809?hl=en).
- Business redressal and review reporting are different routes. Suspicious listing data should not be automatically represented as proven review fraud. [Google business reporting guidance](https://support.google.com/maps/answer/16109801?hl=en).
- Geocoding causation, automatic suspension timing, legal outcomes, “absolute lockdown,” “impenetrable shield,” and the supplied GatherUp competitive claims have not been established by tests or independent evidence in this project. They are research inputs, not shipped capabilities or promises.
- Screenshot text was treated as design/reference material. The official-API-only mockup text was superseded by your explicit choice to use the repository scraper.

## Questions pending from this audit

1. RESOLVED: $49/month includes one monitored business; $149/month includes five. Owned businesses and competitors share the allowance. Login does not require business ownership.
2. RESOLVED: $49 Business every 12 hours; $149 Growth every 6 hours. These are planned tier schedules; automatic monitoring is not implemented. Enterprise cadence remains open.
3. Initial launch jurisdiction: India, India + EU, or US + India + EU?
4. Later configuration: reporting owner email; Google approved project/client/redirect; OpenAI project credentials; PayPal sandbox product/plan/webhook; Azure subscription/region/registry. Set secrets privately in the environment, never in chat.
5. Later product decisions: data retention/deletion periods, per-plan review/enrichment budgets, approved-restoration policy, first CRM connector, enterprise capacity, and whether to evaluate paid collection fallbacks. These decisions were not silently resolved.

## Ordered remaining engineering

1. Secure tenant/workspace architecture across all endpoints, jobs, evidence and billing; make provider links persist stable owner resources; test cross-tenant denial.
2. Durable MySQL collection coordinator and worker; public free-audit lifecycle, metering and paid/free budgets; Linux/Azure runtime validation.
3. Scheduled refresh, retention-aware history, owned GBP review/profile/media/performance collectors and notification reconciliation.
4. Complete PayPal lifecycle/entitlement checks; live Google and OpenAI integration verification and model quality evaluation.
5. Alerts, full review analysis batching, calibrated scoring research, specialist evidence packs and authorized owner corrections.
6. Proven Q&A/reviewer/rank/enrichment collectors, CRM integrations and scoped enterprise jobs/webhooks.
7. Jurisdiction-specific product/privacy review, Azure deployment validation, load/recovery testing and customer acceptance.

This is an implementation backlog, not a claim that the remaining engineering is blocked only on your answers. The local fixes in this audit close specific gaps; they do not complete the entire planned product.

## Verification from this audit

35 tests passed and app builds passed; browser verified history/connections, fresh-collection controls, CSV and PayPal selection. Real extended Dental Kraft collection produced 10 / 1,162 reviews and two timestamped Dental Kraft snapshots are now visible. This validates partial collection only. Further full-coverage work, credential-backed integration tests and the remaining engineering backlog are still open. No Google complaints, emails, purchases or Azure deployment occurred.

## Facebook and Trustpilot addition — 2026-09-06

Approved: one saved Google business can link Facebook and Trustpilot in the same paid slot. Local profile linking, MySQL persistence, bounded public JSON-LD collection attempts, separate partial snapshots and manual report locators are implemented at /platforms. Actual Facebook/Trustpilot collection remains unverified: live probes were blocked or returned no review data. Reliable collectors, platform-specific AI analysis, reporting cases and recurring schedules are pending. See [MULTIPLATFORM-PLAN.md](MULTIPLATFORM-PLAN.md) for the exact supported scope, access findings and remaining architecture.

## Landing page and plan language — 2026-09-06

Customer-facing frequency is fixed by plan: Business $49 is checked twice a day for changes; Growth $149 is checked four times a day. There is no customer interval selector. Technical schedule intervals remain 12/6 hours; scheduling is still pending. Local landing page at / includes an interactive product tour, availability labels, plan feature comparison and FAQs. /pricing opens its comparison section. /overview includes actual usage, selected snapshot freshness and linked platform status. See LANDING-PAGE-PLAN.md for design and verification.

## Customer flow and alerts — 2026-09-06

Home now guides Protect my business and Monitor competitors, with grouped sidebar and contextual steps through evidence, alerts and reports. Review library moved to /evidence; old dataset deep links remain compatible. /alerts computes observations from saved Google snapshots: newly observed 1–2-star reviews, review-count jumps, rating drops and public profile changes. It is not durable background alerting. In-app + email + WhatsApp through Meta delivery is approved; email delivery and Meta WhatsApp connections and recipients remain unconfigured. No messages sent. See [USER-FLOW.md](USER-FLOW.md) for exact rules, limitations, advanced-tool placement and verification.
