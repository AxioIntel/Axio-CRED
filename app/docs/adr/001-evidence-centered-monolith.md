# ADR 001: keep one application and normalize evidence incrementally

Date: 2026-09-09. Status: accepted for this local implementation; target workflow migration remains proposed.

## Context

Axio-CRED's goal is business protection, competitor monitoring and evidence-backed human reporting. Repeated feature additions split identities across owned tables and workspace JSON, while some consumers treated a recent collection window as the evidence repository. Rewriting the working collector, app and all persistence at once would risk losing source evidence and make verification harder.

## Decision

Keep React + Express + Go collection in one repository with MySQL as the application database. Introduce an additive relational evidence projection and direct workspace-scoped dataset lookup. Commit new payloads and their projection atomically. Preserve old source payloads and use a restartable backfill. Share the plan contract across pricing validation and entitlement presentation. Make collection quality, assessment status and human action the organizing workflow.

## Options considered

| Option | Benefit | Cost / reason |
|---|---|---|
| Keep JSON-only and expand LIMIT | Small patch | No stable relationships; evidence still disappears at a later threshold |
| Rewrite all data and deploy microservices | Full redesign flexibility | Unnecessary operational cost and migration risk before real tenant authentication |
| Add an indexed projection and migrate incrementally | Fixes current retrieval/relationship errors; preserves source | Temporary dual representation and explicit reconciliation responsibility |

Selected the third option. Raw evidence remains authoritative; the index is derived. It is not a second editable review store.

## Trade-offs

- A projection adds storage and write work, but avoids duplicating text and provides queryable identity/coverage.
- The dashboard pins two snapshots per monitored identity; arbitrary historical pagination and memory-bounded summary APIs remain necessary for Enterprise scale.
- Existing JSON watchlists and case state retain transactional locks, but are not the final relational model.
- Scoped FK tests establish only the new evidence boundary. They do not replace full tenant authentication and authorization tests.

## Consequences and action items

Run the additive migration before the new app, verify indexing and source preservation, and leave old tables intact. Next implement tenant identity/subscription binding and one durable worker, then migrate watchlists, platforms, findings and cases with a reconciled read cutover. Use the current/target ER diagrams and delivery gates in `PRODUCT-ARCHITECTURE.md` as the baseline. No paid fallback calls or cloud deployment are part of this decision.
