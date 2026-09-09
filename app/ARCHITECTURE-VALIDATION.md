# Architecture and workflow validation

Date: 2026-09-09. Environment: local Windows, MySQL 8, API `127.0.0.1:8080`, Vite `localhost:5173`. This is local implementation verification, not a production security assessment.

## Latest PR verification

Verified revision: `9bd026b` in merged [PR #1](https://github.com/AxioIntel/Axio-CRED/pull/1). [CI run 34314642463](https://github.com/AxioIntel/Axio-CRED/actions/runs/34314642463) passed all 12 checks. Local tests passed: 74 backend + 48 frontend (122 total), plus lint, TypeScript and builds.

Regression tests verify production API denial, actual MySQL2 certificate/hostname TLS options, PayPal rollback/retry behavior and reserved fallback resumption without additional submissions. Disposable MySQL integration confirms rollback after a subscription insert and exactly one processing of concurrent event retries. No live provider, payment or Azure deployment was used for these checks.

## Earlier local architecture results

| Check | Observed result |
|---|---|
| Backend tests | 67 passed, 16 test files |
| Frontend tests | 48 passed, 18 test files |
| Frontend/backend production builds | Passed |
| New evidence-index migration | Applied to local MySQL; 24 tables total |
| Migration re-run | Passed; SHA-256 of each stored source JSON payload unchanged for all 10 collections |
| Projection inventory after backfill | 26 subjects, 30 listing snapshots, 2,442 review observations |
| Isolated SQL integration test | Passed; temporary workspaces cleaned up; one original workspace remains |
| Historical evidence retention | Two monitored snapshots remained available after 21 unrelated collections |
| Direct evidence lookup | Existing source returned 200; missing UUID returned 404 through the frontend proxy |
| Workspace isolation in new evidence path | Other workspace cannot read the fixture by ID; cross-workspace observation FK rejected |
| Indexing retries | Repeated indexing leaves one observation for one source review |
| Atomic collection save | Invalid projection causes rollback; source import is not left behind |
| AI context regression | Context still loads when the recent-list method returns no datasets; no provider request needed |
| Local browser home smoke check | Next actions, collapsed returning-user setup, scoped evidence links and source-issue counts displayed |
| Local browser settings smoke check | Actual Growth allowance 4/5; AI configured; native collector available; Outscraper disabled; checkout disabled; scheduled/external delivery planned |

The test run caught a shared-price presentation regression (a missing currency symbol) and a test TypeScript option error. Both were corrected; final frontend tests and both builds pass.

## Real-data observation

Latest DENTAL KRAFT dataset `b30de78e-5f60-434e-b871-efc703fbb118`:

- Reported reviews: 1,169.
- Collected review records: 1,170; discrepancy remains unresolved.
- Usable review texts: 866.
- Quarantined text records: 294, preserved with capture-issue metadata.
- The home screen prioritizes resolving these collection issues.

These numbers describe stored evidence. This pass did not recollect the business or assess its 1,170 records with AI.

## Verification limits

- No paid Outscraper calls, live AI requests, customer messages or payment transactions were made.
- No Azure deployment, complete multi-tenant authorization audit, backup restore or concurrent production-worker test was performed.
- Browser verification inspected rendered UI/accessibility state; it was not a full cross-browser or pixel-level responsive audit.
- The ER diagrams document current physical relationships and a proposed target. The target tables are not represented as deployed.
- The current API retains a single preview workspace by default. Parameterizing the repository workspace and adding scoped evidence FKs does not add customer login or protect every legacy endpoint.

## Reproduction

```powershell
# From E:\Codex\Axio-CRED\app
npm run migrate -w backend
node --import tsx scripts/verify-evidence-index.mjs
npm test
npm run build
```

The SQL integration script creates only synthetic temporary workspaces and removes those generated UUIDs in its cleanup. Use a disposable/local database for repeated development verification.
