# Local scheduled monitoring

Implemented and verified 2026-09-09. This supersedes earlier statements that the application has no recurring collection. Hosted production monitoring remains a separate release requirement.

## Use

Open a monitored business's evidence and use **Enable 6-hour checks** (Growth) or **Enable 12-hour checks** (Business) below the manual collection buttons. The server derives the cadence from the existing plan contract. Owned businesses and competitors use the same schedule mechanism and one Place ID has one schedule per workspace. Free and negotiated Enterprise cadence are not automatically enabled.

The panel shows enabled/paused state, next check, last attempt, any failure, and the last scheduled evidence. **Pause automatic checks** stops future runs; an already-running collection may finish. Initial enablement schedules the first check one interval from now. Repeated enable requests preserve that time. Subsequent successful runs schedule the next check one interval after completion; this avoids overlapping work. Failed runs retry after 30 minutes and display the failure.

The local API and PC must remain running. Closing the browser does not stop the scheduler. PC sleep or API downtime delays checks; after restart, overdue work resumes without a burst of historical catch-up runs. This is not an always-on cloud service or a guarantee of an exact wall-clock collection start.

## Collection and changes

- Scheduled checks force fresh extended collection, bypassing the saved-snapshot cache.
- Only the native collector is used. Scheduled work cannot invoke paid Outscraper fallback or AI, even when a fallback key is configured.
- Each successful collection saves a separate dated dataset and its evidence index atomically. Partial coverage remains visible when opening that evidence.
- Alerts now include newly observed reviews of all ratings, reported-count decreases, reviews absent from the latest sample, and existing rating/profile changes. A newly observed review is not necessarily newly posted.
- Missing review IDs are an unconfirmed absence, not a verified removal. Their evidence link opens the previous snapshot. Switching providers suppresses review-ID addition/absence comparisons until there is a comparable baseline.
- Missing fields are not treated as edits; profile comparisons require comparable captured values. Review-count decreases do not identify which reviews disappeared or why.
- The in-app changes view compares loaded saved snapshots. It is not a durable notification inbox; email/WhatsApp delivery and an unbounded alert history remain pending.

## Implementation boundary

Migration `003_monitoring_schedules.sql` adds workspace-scoped schedule state. The local server checks for due work every 15 seconds and shares its native discovery coordinator with manual collection. Each schedule claim uses an InnoDB row lock and a 25-minute lease/token. Concurrent claims cannot own the same schedule, stale completions cannot overwrite a newer claim, and an expired claim can be recovered after restart. Pausing preserves the active lease.

The existing collector's outer timeout is 20 minutes; the scheduler's polling deadline is 21 minutes. This implementation targets one local API process. A separate supervised worker, orphan-process recovery under arbitrary host failure, tenant authorization, resource budgets, persistent run/notification history and production operations are still required for hosted service guarantees. Production customer routes remain blocked and the scheduler is not started in production mode.

## Verification

- 82 backend tests and 52 frontend tests passed, with lint, TypeScript checks and both builds. Tests include plan-cadence changes and business-name edits.
- Real MySQL tests verify 6/12-hour due times, repeated enable, workspace isolation, concurrent claims, lease recovery, stale completion rejection, failure retry and pause. An injected collector exercises due job → normalized/indexed evidence → saved next check without calling an external provider.
- Existing evidence/history/PayPal SQL integration checks still pass.
- Production-boundary tests include the new schedule endpoints; a discovery regression verifies that an enabled paid fallback is never called for scheduled partial collection.
- Browser verified the six-hour enable control, persisted enabled state and next-run time for the current monitored business. No immediate live scrape or AI request was needed to enable it.
- An API stop/start preserved the enabled schedule and exact next-run timestamp; frontend, API and database readiness checks passed afterward.

Run from `app` against a local/disposable database:

```powershell
. .\scripts\dev-runtime.ps1
npm.cmd run migrate -w backend
node --import tsx scripts/verify-monitoring-schedules.mjs
```

The SQL verification is also included in the existing MySQL CI job.
