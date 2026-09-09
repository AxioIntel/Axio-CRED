# Pull-request quality gates

CI runs on every PR to `main`, pushes to `main`, and manual dispatch. It has no path filters that could leave required checks permanently pending. Superseded runs are cancelled. All actions are pinned to verified commit SHAs; PR jobs use a read-only token and do not receive provider credentials.

| Check | Blocking condition |
|---|---|
| Workflow & runtime guard | Unpinned action, invalid workflow, Node/Docker major drift, mismatched npm lockfile, tracked local data or enabled paid-fallback template |
| Lint & TypeScript | ESLint error/warning or TypeScript compilation failure |
| Backend unit tests | Any backend test fails; JUnit results retained |
| Frontend unit tests | Any UI/interaction test fails; JUnit results retained |
| Go lint, vet & build | Formatting, existing golangci rules, vet, module consistency/verification or build failure |
| Go unit tests (race) | Go test/race failure or bundled scraper-skill tests fail |
| MySQL migrations & isolation | Fresh or repeated schema migration fails; history retention, workspace FK, idempotence, evidence rollback or PayPal rollback/concurrent retry assertion fails |
| Application & container build | Exact Docker context fails to build or runtime lacks artifacts, contains local data or runs as root |
| Semgrep security scan | Community `p/ci` or application-specific security finding; SARIF retained |
| Secret scan | Gitleaks detects a credential in proposed commits; values redacted in reports |
| Dependency vulnerabilities | npm high/critical vulnerability, reachable Go vulnerability or scanner execution failure |
| Required checks | Any of the eleven checks fails, is cancelled or is skipped |

The aggregate `Required checks` context is the branch-protection requirement. Enforce it for administrators as well, require an up-to-date branch, and do not add a review-count requirement implicitly. The aggregate covers all listed jobs; a skipped scanner cannot produce a passing aggregate. The gate's evaluator is also tested against failure, cancellation, skips and empty input.

The previous two broad build workflows are consolidated here. Their Go vet, lint, module and vulnerability checks are retained, and the Docker build is retained. Release-publishing behavior is unchanged; action references are pinned.

## Scanner scope and limits

- Semgrep scans product TypeScript/React and native Google collection code. Test fixtures, local data and dependencies are excluded through `.semgrepignore`. The upstream Go repository also retains its existing full-repository gosec/static analysis via golangci-lint.
- Semgrep uses its open CLI and registry rules without a cloud token. This does not install or claim the separate Semgrep Cloud Platform GitHub App. Tool version is pinned; registry `p/ci` rules can evolve and may reveal new findings.
- Gitleaks uses the checksum-verified CLI release, not a paid GitHub Action wrapper. PR scans cover commits from the base SHA through the checkout, including a secret introduced and later removed within the PR. Manual runs without a commit range scan the working tree. Reports are redacted and retained for seven days.
- npm findings at moderate severity are reported but do not block; high and critical findings block. No blanket scanner bypass or `continue-on-error` is used.
- MySQL runs against a disposable CI service, never the developer/customer database. No Azure, OpenAI, PayPal, Google or Outscraper secrets are passed to tests. Paid fallback stays disabled by default.
- These checks are not a production security audit, full collection-completeness proof, or tenant-authentication implementation. See `PRODUCT-ARCHITECTURE.md` for release gates.

## Local commands

```powershell
# Repository root
node --test .github/scripts/ci-guard.test.mjs
node .github/scripts/ci-guard.mjs
# App directory
npm ci
npm run lint
npm run check
npm test
npm run build
```

Run MySQL verification only with a local/disposable database configured: `npm run migrate -w backend`, then `node --import tsx scripts/verify-evidence-index.mjs`. The script accepts `MYSQL_URL` from the environment so CI does not need an `.env` file. Go lint/test/vet and Linux race/container/security checks also run in GitHub Actions.

Implementation references: [Semgrep CI configuration](https://semgrep.dev/docs/semgrep-ci/sample-ci-configs), [ESLint configuration](https://eslint.org/docs/latest/use/configure/configuration-files), [Gitleaks CLI](https://github.com/gitleaks/gitleaks).

## PR review regression coverage

Production API tests require 503 before workspace access or provider work, while health/readiness remain available. MySQL driver tests verify certificate and hostname checks for Azure and explicit TLS URLs. The disposable MySQL job injects a payment failure after the subscription insert, verifies rollback, then sends concurrent retries and checks that exactly one commits. Outscraper integration tests exhaust the allowance with a pending reservation, restart the provider and resume it without a second paid submission.
