# Engineering governance

The baseline eMithran is built and run against, and where each part is enforced. A control counts here only if a test, a CI job or a
GitHub setting enforces it, or a written procedure covers it; anything else is listed under **Gaps**. The detailed security controls
are in [DEPLOYMENT_SECURITY.md](DEPLOYMENT_SECURITY.md); this page ties them to the standards.

| Baseline | Reference |
|---|---|
| Branch protection with GitHub Rulesets | [GitHub Rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) |
| Quality gates on every pull request | `ci.yml`, `security.yml` |
| Application security verification | [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/), [OWASP Top 10](https://owasp.org/www-project-top-ten/) |
| Secure development practices | [NIST SSDF (SP 800-218)](https://csrc.nist.gov/projects/ssdf) |
| Build and supply-chain integrity | [SLSA](https://slsa.dev/) |
| Controlled production releases | this page, [DEPLOYMENT_SECURITY.md](DEPLOYMENT_SECURITY.md#environments-and-promotion) |
| Incident response and disaster recovery | [ops/incident-response.md](ops/incident-response.md) |

## Branch protection

`main` is protected by the ruleset in [`.github/rulesets/main.json`](../.github/rulesets/main.json), the source of truth for the
setting. GitHub does not read it from the repository: after changing it, apply it with

```bash
gh api -X PUT repos/abushanisro/emithran/rulesets/$(gh api repos/abushanisro/emithran/rulesets -q '.[] | select(.name=="main") | .id') \
  --input .github/rulesets/main.json
```

- No deletion and no force push. A history rewrite (as for `memory/` on 2026-10-31) means disabling the ruleset for that push on purpose.
- Changes land only through a pull request, squash-merged, with every review conversation resolved.
- All `ci.yml` and `security.yml` jobs must pass on a branch that is up to date with `main`.
- CodeQL must have analysed the change; a new high or critical alert blocks the merge.
- Required approvals are 0 while there is one maintainer (GitHub does not let authors approve their own pull request); raise to 1
  when a second engineer joins. Repository admins may bypass only through a pull request, for emergencies.

A new CI job that should block merges must also be added to the ruleset's required checks.

## Quality gates

Every pull request runs, and the ruleset requires:

- **Build and tests:** frontend and backend type-check, unit and domain tests and production build; SQL migration tests; the
  PostgREST, object-store and local-stack integration suites; the Python engine, Rust core and C++ geometry worker builds and tests.
- **Costing regressions:** byte-for-byte golden snapshots of costing output (`backend/src/test/golden`).
- **Security:** gitleaks over the whole history, dependency review and lock-file scan, Trivy on Dockerfiles, compose and images,
  CodeQL for JavaScript/TypeScript and Python, and the deployment hardening tests.

## OWASP ASVS and Top 10

Each control is listed with its ASVS chapter in [DEPLOYMENT_SECURITY.md → What is enforced where](DEPLOYMENT_SECURITY.md#what-is-enforced-where).
Top 10 coverage by automated checks:

| Top 10 (2021) | Enforced by |
|---|---|
| A01 Broken access control | Row-level security and `npm run check:rls`; organisation guards; authentication on every Next.js API route (`test/api/unauthenticated-routes.test.ts`) |
| A02 Cryptographic failures | Secrets and tokens stay on the server: no data clients in browser code (`npm run check:boundary`), only `NEXT_PUBLIC_*` build arguments in the frontend image (`test/deploy/compose-hardening.test.ts`), no token endpoint (`lib/auth0.ts`); HSTS; `crypto` randomness (CodeQL) |
| A03 Injection | Validated DTOs and array bodies; quoted PostgREST filters (`postgrest-filter.ts`); CodeQL |
| A05 Security misconfiguration | Production boot checks (`env.validation.ts`); compose hardening tests; Trivy config scan |
| A06 Vulnerable components | Dependabot, lock-file and image scans, dependency review |
| A07 Identification and authentication failures | Auth0 with no browser-held tokens; inactivity timeout; sign-in callback errors handled without leaking detail |
| A08 Software and data integrity failures | Actions pinned by SHA, images by digest; migrations immutable once applied |
| A09 Logging and monitoring failures | [ops/monitoring.md](ops/monitoring.md), [ops/observability.md](ops/observability.md) |
| A10 Server-side request forgery | Trusted storage host allow-list with re-checked redirects (`lib/server/safe-fetch.ts`) |

## NIST SSDF

| Practice group | How it is met |
|---|---|
| **PO** Prepare the organisation | This page and [ENGINEERING.md](ENGINEERING.md); security requirements in [DEPLOYMENT_SECURITY.md](DEPLOYMENT_SECURITY.md); toolchain defined in the workflows |
| **PS** Protect the software | Protected `main` (ruleset); two-factor authentication on every account with write access; secret scanning with push protection; proprietary reference data in a private repository with a read-only deploy key |
| **PW** Produce well-secured software | Reviewed pull requests; required tests, SAST and dependency checks; pinned dependencies and base images |
| **RV** Respond to vulnerabilities | Private vulnerability reporting ([SECURITY.md](../SECURITY.md)); Dependabot and code-scanning alerts triaged with a fix or a recorded reason; time-limited exceptions in `.trivyignore.yaml`; [ops/incident-response.md](ops/incident-response.md) |

## SLSA

- **Source:** the history of `main` is kept (no force pushes or deletion), and every change goes through a reviewed, checked pull request.
- **Dependencies:** lock files committed; GitHub Actions pinned by commit SHA; container base images pinned by digest; Dependabot
  proposes bumps weekly.
- **Build:** production images are built on the deployment host, so they carry no build provenance yet (see Gaps).

## Releases

- **Frontend (Vercel):** every pull request gets a preview deployment. Production does not follow `main` (`vercel.json`); a release
  is a deliberate promotion of a tested deployment (`vercel promote <url>`), and rolling back is promoting the previous one.
- **Backend, engines, database:** pull request → CI → merge → **stage** → QA sign-off → **production**, as in
  [DEPLOYMENT_SECURITY.md](DEPLOYMENT_SECURITY.md#environments-and-promotion). Migrations are applied with a dry run first.

## Gaps

- **Build provenance (SLSA Build L2):** build the images in CI, push them by digest and attest them with
  `actions/attest-build-provenance`; the host then pulls the attested digest instead of building.
- **Recovery time:** the backup restore check exists but has not been timed, so there is no measured recovery-time objective yet.
- **Key rotation:** the 39 credentials in history (`.github/gitleaks-baseline.json`) must be rotated; until then they are an open risk.
- **Two-factor authentication:** not verifiable from the repository; confirm it is on for every account with write access.
- **Production environment reviewers:** GitHub Environment `production` should require a reviewer before its secrets are used.
