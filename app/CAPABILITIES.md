# Axio-CRED capability status

Source: open, unmerged [PR #1](https://github.com/AxioIntel/Axio-CRED/pull/1), reviewed code `9bd026b`, 9 September 2026. Implemented means present and tested in the local MVP, not available as a hosted production service.

| Capability | Current behavior | Limit / next delivery gate |
|---|---|---|
| Business selection | Google Place ID, name/city or Maps link; select as owned or competitor | Public selection does not prove ownership; owner access is not required for monitoring |
| Native collection | Windows Go/Chromium process, on-demand jobs and saved results | One active local job; ordinary three-minute and extended twenty-minute process bounds; no guarantee of all reviews |
| Extended history | RPC pagination and DOM supplement | DOM ceiling 5,000, fifteen-minute DOM budget; partial results disclosed |
| Outscraper fallback | Exact-ID failures or material extended-history gaps; local reservation and resumption | Paid calls disabled, monthly allowance zero; injected tests only |
| Evidence store | MySQL payloads plus subject/snapshot/review-observation index | Recent 20 datasets plus two indexed snapshots per monitored identity; direct historical lookup; no arbitrary history pagination |
| Dashboards | Separate owned/competitor views, counts, distributions, dated comparisons, filters | Reported totals, captured records, usable texts and assessments stay distinct |
| Review analysis | Explicit Azure OpenAI/OpenAI choice; sequential 30-record batches, resume, exact-quote validation | Investigation priority, not fraud probability; requires explicit action and a configured/funded provider |
| Pattern findings | Repeated text, exact-date clusters, qualified baseline bursts, owner reply pressure | Bounded comparisons and explicit sampling/alternative-explanation limits |
| Report kits and cases | Locator, evidence draft, approval, assignment and manually recorded submission/outcome | Human files reports; platform outcomes are not verified by a local status change |
| Reporting team | Up to 20 authorized or pending identities; Google identity sign-in | Does not automate complaints across accounts; production API blocked |
| Other platforms | Link Facebook/Trustpilot to Google business in one slot; attempt bounded public JSON-LD collection | Partial/unreliable coverage; equivalent platform AI/cases/scheduler pending |
| Enrichment | Inspect/export discovered website emails, phones and websites | No verification, outreach, directory or WhatsApp presence checks |
| Alerts | Compute newly observed low reviews, count jumps, rating drops and profile differences | No durable notification stream or background delivery; email and Meta WhatsApp planned; no SMS |
| Pricing | $49: one business/twice daily; $149: five/four times daily; enterprise custom/unlimited contractual entities | Checking frequency is planned; same business across platforms counts once; free acquisition audit unfinished |
| PayPal | Price validation, signature verification, atomic event/subscription/entitlement writes | Ownership/lifecycle reconciliation incomplete; production checkout/webhook blocked; sandbox lifecycle testing required |
| Google managed access | Separate business.manage OAuth, paginated account/location discovery | Ordinary login uses identity scopes; tenant ownership/access controls incomplete |
| Azure | Container/Bicep scaffold, shared verified MySQL TLS, health/readiness | Customer API returns 503 in production; worker, queue, shared provider ledger and deployment validation pending |
| Enterprise API | Legacy shared-key overview endpoint exists locally | Not a tenant API; production blocked; scoped keys, quotas and webhooks pending |

## Claims the product must not make

No automatic review submission, guaranteed removal/restoration, verified fraud probability, complete reviewer history, guaranteed full collection, confirmed deletion from a partial sample, exact local-pack rank, or absolute profile lockdown. A hash binds a representation; it does not prove a transaction occurred or a review is genuine.

## Release order

1. Implement tenant identity and authorization, negative access tests, retention and secret handling before replacing the production denial.
2. Bind billing/budgets to tenant ownership; reconcile lifecycle events and test sandbox subscriptions.
3. Provision a durable Azure worker/coordinator and shared reservation ledger; validate leases, retries and recovery.
4. Add scheduled checks and a notification outbox with in-app, email and consented Meta WhatsApp delivery.
5. Validate provider coverage and model quality on representative evidence; expand platforms and enterprise capacity with explicit limits.

See [product architecture](PRODUCT-ARCHITECTURE.md), [CI checks](CI-CHECKS.md) and [validation](ARCHITECTURE-VALIDATION.md). Older conversation plans are requirement history, not delivery claims.
