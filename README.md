# Axio-CRED

Axio-CRED is a reputation intelligence application for monitoring public business profiles, detecting review and profile-change signals, preserving source evidence, and preparing human-reviewed complaint dossiers.

The repository contains two connected parts:

- `app/` — the React, Express and MySQL customer application.
- The repository root — the native Go collection engine used by the application for public Google Maps data.

## Product workflow

1. Add a public business profile by Google Place ID, Maps link or native search.
2. Mark the business as owned, a competitor, or both.
3. Collect public profile facts and available reviews with the native collector.
4. Compare snapshots for rating changes, review bursts and profile-integrity changes.
5. Assess collected review evidence and prepare a report kit for a person to verify and submit.

Outscraper is an optional fallback for narrowly defined collection failures. Paid fallback calls are disabled by default. The application does not use the official Places API for review collection and does not claim that a screening signal proves fraud.

## Local customer-app preview

From `app/` in PowerShell:

```powershell
.\scripts\dev-start.ps1
.\scripts\dev-check.ps1
```

Open `http://localhost:5173/overview`. See [`app/README.md`](app/README.md) for MySQL setup, collection configuration and the verified local workflow.

## Native collector development

Run the Go tests from the repository root:

```bash
go test ./...
```

Build the collector:

```bash
go build -o axio-cred-collector .
```

The customer application invokes a locally built collector through `NATIVE_SCRAPER_BINARY`. Proxy files and provider credentials remain server-side.

## Architecture and limits

- [`app/PRODUCT-ARCHITECTURE.md`](app/PRODUCT-ARCHITECTURE.md) describes the product, current schema, target data model and release gates.
- [`app/NATIVE-COLLECTION-ARCHITECTURE.md`](app/NATIVE-COLLECTION-ARCHITECTURE.md) describes native collection coverage, bounded jobs and the proposed Azure worker architecture.
- [`app/ARCHITECTURE-VALIDATION.md`](app/ARCHITECTURE-VALIDATION.md) records the current verification evidence.

Production customer routes remain fail-closed until tenant authorization is implemented. Local demo mode is for development and does not establish tenant isolation, deployment readiness or provider completeness.

## License

This repository is distributed under the MIT License. See [`LICENSE`](LICENSE). Third-party dependencies retain their own package coordinates and license terms.
