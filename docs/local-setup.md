# Local development setup

Verified on 2026-09-09 in `C:/Github/Axio-CRED`.

## Running application

- Dashboard: http://127.0.0.1:5187/overview
- API: http://127.0.0.1:8087/api/health
- Database readiness: http://127.0.0.1:8087/api/ready
- Project MySQL: `127.0.0.1:3307`, database `axiocred_dev`.

Ports 8080 and 5173 were already in use. This checkout uses `PORT=8087`, `WEB_PORT=5187` and the matching `APP_URL` in its ignored `app/.env`. Vite reads the port settings server-side, binds to IPv4 loopback and fails if its port is occupied. Provider secrets are not injected into frontend code. For fresh setups, use `http://127.0.0.1:5173` and keep `APP_URL` aligned with the browser hostname and `WEB_PORT` so monitoring writes pass the origin check.

The database is a separate local MySQL 8.0.45 instance using the installed MySQL executable and an ignored data directory at `app/.dev/mysql/data`. The existing MySQL80 service and other databases were not changed. Generated application credentials and session secret are in `app/.env`; a local database administrator option file is in `app/.dev/mysql/admin.cnf`. Keep both private. The temporary bootstrap SQL was removed after successful initialization.

The new database was initialized with an empty **Local preview** workspace with a test Growth allowance of five businesses. This is not a paid subscription. Earlier collections and provider credentials from another checkout have not been imported. AI, Google OAuth, PayPal and external notification delivery require separate private configuration. Paid Outscraper fallback remains disabled with zero monthly allowance.

## Start, check and stop

From the `app` directory in PowerShell:

```powershell
.\scripts\dev-start.ps1
.\scripts\dev-check.ps1
.\scripts\dev-stop.ps1
```

Start uses the project-local Node 22 runtime and restarts the project MySQL instance if its saved process is absent. API/frontend logs and process records live under `app/.dev`. Stop terminates the recorded API/frontend process trees and leaves MySQL running. It checks process name and, for new records, creation time before stopping a process.

To stop the project database cleanly, use its private option file with the installed client (this does not stop the separate MySQL80 service):

```powershell
& 'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqladmin.exe' '--defaults-file=C:/Github/Axio-CRED/app/.dev/mysql/admin.cnf' shutdown
```

Run start again to restart the project database. Do not delete its data directory as a troubleshooting step.

## Runtime and checks

Downloaded Node 22.23.2 and Go 1.26.6 from official distribution endpoints and verified archive SHA-256 checksums. They are under ignored `app/.tools`; the system-wide Node installation was not changed. Dependencies were installed with `npm ci` from the committed lockfile.

From `app`, activate the matching Node runtime for the current shell:

```powershell
. .\scripts\dev-runtime.ps1
npm.cmd run lint
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd run migrate -w backend
node --import tsx scripts/verify-evidence-index.mjs
```

The database verification script creates and removes only synthetic test workspaces. Migrations were run twice successfully on the new database. Existing `dev-setup.ps1` now preserves an existing `.env`, installs locked dependencies, and invokes the backend migration workspace correctly; it is not necessary to rerun it on this configured checkout.

## Collector runtime

The patched local scraper is `app/.tools/axiocred-scraper.exe`. The documented isolated dependency patch was applied by `app/scripts/build-local-scraper.mjs`; committed `go.mod` and `go.sum` were not modified. Playwright driver, Chromium, headless shell and helper binaries are installed under `app/.tools` at the paths expected by the local worker.

To rebuild from the repository's source, activate Node as above and run:

```powershell
node scripts/build-local-scraper.mjs
```

This setup installed the browser runtime and compiled the scraper. It did not run a new live business collection or verify full-review coverage. The next evidence milestone remains the corrected-selector recollection in [the remaining-work plan](remaining-work-plan.md).

## Validation results

- App lint and TypeScript checks passed.
- Backend: 74 tests passed. Frontend: 48 tests passed.
- Frontend and backend production builds passed.
- Fresh and repeated MySQL migrations passed.
- SQL integration checks passed: retained monitored history, direct lookup, cross-workspace read/FK denial, idempotent projection, evidence rollback, PayPal rollback and concurrent retry.
- Go tests and vet passed for `gmaps`, `internal/...` and `grid`.
- Browser verified the dashboard loading from MySQL with 0/5 preview slots and no saved collections.
- Frontend, API health and database readiness each returned HTTP 200 on the dedicated ports.
- A clean stop/start cycle passed, with all three readiness checks returning HTTP 200 afterward.

Full Linux Go race tests, container builds, cloud deployment, live OAuth/billing/AI, and a new live scraper collection were not performed. Docker and make remain absent from PATH; the native Windows app does not require Docker to run. CI remains the Linux/container verification gate.
