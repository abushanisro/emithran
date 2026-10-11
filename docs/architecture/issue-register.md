# Architecture issue register

**Severity describes repository evidence; live exposure and policy state remain unverified.**

Baseline: `7ea13f68895b6bcb3249c431d49cb61fc8619f8c`, 2026-10-11. No secret values included.

| ID | Severity | Confidence | Status | Finding |
|---|---|---|---|---|
| EA-001 | Critical | Confirmed history; rotation unverified | BLOCKED | historical Supabase service credential |
| EA-002 | High | Confirmed repo code/policies; live unverified | BLOCKED | delivery/QC cross-tenant privileged/direct DB access |
| EA-003 | High | Confirmed | BLOCKED | credential assignments in tracked CAD env files |
| EA-004 | High | Confirmed code; live redirect exploit unverified | FIXED / unit-verified | file-proxy destination boundary bypass |
| EA-005 | High | Confirmed | BLOCKED | CAD proxy/memory endpoint authentication gaps |
| EA-006 | High | Confirmed advisories; reachability unassessed | Approval needed | vulnerable dependency baseline |
| EA-007 | Medium | Confirmed | FIXED / unit-verified | single-org guard ignores explicit foreign org |
| EA-008 | Medium | Confirmed | FIXED / full-suite verified | case-sensitive manufacturing reference paths |
| EA-009 | Medium | Confirmed | FIXED / CI-check verified | RLS-boundary CI violation |
| EA-010 | Medium | Confirmed | BLOCKED | production/CAD/integration verification gaps |
| EA-011 | Low | Confirmed | Deferred | lint debt and missing unit suites in CI |

## EA-001 — historical privileged credential

**Current-tree deletion does not revoke historically exposed authority.**

- Evidence/root cause: `backend/docs/rls-bypass-inventory.md`, Open item 1, records removal, six historical commits and cached/stale copies. Old-key validity was not probed.
- Impact/reproduction: service authority if still valid; use documented history evidence, never publish or test historical secret values.
- Minimal fix/mitigation: owner rotates/revokes keys in Supabase and updates deployment secrets; approved access/history cleanup separately.
- Verification/risk: owner confirms old authority rejected and new user/RLS flows work. Rotation/deploy changes require human action.

## EA-002 — delivery/QC tenancy

**Service-role calls bypass policies; permissive delivery policies also expose direct database access.**

- Location/reproduction: `backend/src/modules/delivery/delivery.service.ts`, `quality-control/quality-control.service.ts`, `quality-inspection.service.ts`; unscoped privileged queries. [Existing design](../../backend/docs/delivery-quality-tenant-isolation-design.md), sections 1–2, maps exact policy/view/RPC evidence.
- Root cause/impact: missing org ownership plus service authority permits cross-tenant reads/mutations in repo implementation; live schema unknown.
- Fix/dependencies: approved ownership backfill, integrity constraints, policies/grants/views/RPCs, org guards and user clients together. Blind client swaps are not safe.
- Mitigation/verification: approved ingress/direct-grant restrictions until fixed; isolated two-org negative reads/writes/RPC/views, same-org collaboration and rollback tests. Requires authoritative schema and data-resolution approval.

## EA-003 — tracked CAD credentials

**Two tracked environment files contain nonempty credential assignments.**

- Location/reproduction: metadata-only check of `cad-engine/.env.development` (CAD key/Redis password), `.env.production` (CAD key). Values withheld; credential validity not tested.
- Root cause/impact: runtime secrets in source expose service authority to clones/history copies.
- Fix/mitigation: owner rotates; move values to approved secret injection/untracked files and value-free examples after checking startup/Docker consumers.
- Verification/risk: history/presence scan and real CAD key/startup tests. Removing a file is not revocation; deployment compatibility requires approval.

## EA-004 — file-proxy destination boundary

**Validating only the initial hostname does not constrain the final fetch destination.**

- Location: `app/api/file-proxy/route.ts`, `isTrustedUrl` / `GET`; no scheme/userinfo validation, backend URLs unchecked, redirects followed by default. Query is decoded twice.
- Reproduction/root cause: trusted-host mocked 302 to private destination, untrusted backend URL, and percent-escaped filename; allowlist applies to only one input path rather than every fetch.
- Impact: possible SSRF if trusted storage redirects; signed URL corruption. No live attack performed.
- Minimal fix: HTTPS/no credentials, validate both modes, reject redirects, preserve signed query encoding.
- Verification/risk: 15 route contract tests pass (13 failed before fix), including negative/no-follow cases and positive streaming in both modes. Legitimate redirect URLs intentionally rejected, direct trusted URLs preserved.

## EA-005 — CAD authentication gaps

**The server key does not protect every path to CAD authority.**

- Location/reproduction: `app/api/cad/route.ts:POST` forwards key without caller auth; `cad-engine/main.py:get_memory_usage_report/optimize_memory_only` omit `Security(require_api_key)`. Next `proxy.ts` never rejects anonymous server requests.
- Root cause/impact: inconsistent boundary auth exposes compute/resources without verified identity; runtime exploit verification blocked by missing OCC stack.
- Fix/mitigation: verified caller-auth transport in Next, existing key dependency on Python compute/report routes; approved ingress restrictions meanwhile.
- Verification/risk: invalid/missing/valid identity tests through actual runtimes; confirm current callers and cookie/token contracts before compatibility changes.

## EA-006 — dependency advisories

**Critical/high advisories predate this PR; no package versions changed.**

- Reproduction: root/backend `npm audit --json`: 26 (3 critical/15 high) and 47 (2 critical/39 high). Not a unique union or GitHub alert count.
- Root cause/impact: vulnerable locked dependency versions; application reachability not yet established.
- Fix/verification/risk: approve targeted upgrades, use package manager, re-audit and run contract/runtime tests. No automatic `audit fix` or new/version-changed dependency without approval.

## EA-007 — explicit organization selection

**Single-membership fallback ignores a supplied foreign organization.**

- Location/reproduction: `backend/src/common/guards/organization-context.guard.ts:canActivate`, singleton return before header read; one-org request with foreign `X-Organization-Id` succeeds.
- Root cause/impact: fallback precedes selection; mutations target actual org despite requested different org. Not proof of foreign-org data access.
- Fix/verification: supplied header validated first; 11 passing guard tests cover foreign/malformed headers, matching singleton, missing-header singleton, ambiguous multi-org and lookup failure. Missing/inactive membership rejects before selection.
- Risk: invalid ignored headers now receive intentional 400/403; valid selections preserved.

## EA-008 — reference path casing

**Linux cannot load fixtures requested with capitalization differing from tracked paths.**

- Location/reproduction: full backend Jest baseline: 14 failed suites, ENOENT for Sheetmetal/Machining/Plastic Modeling. Fixture paths under `backend/src/test/modules/bom-items/costing/` and memory-domain checks.
- Root cause/impact: case-insensitive development filesystem hides mismatch; real manufacturing regression coverage fails on Linux.
- Fix/verification/risk: exact tracked casing in test reads and two folder fields in `backend/src/modules/processes/memory-reference-domains.json`, not business labels or source versions. Full Linux suite: 125 suites / 1,783 tests pass with real data and unchanged assertions/formulas.

## EA-009 — RLS-boundary CI violation

**A dynamic reason defeats the existing searchable-literal audit contract.**

- Location/reproduction: `backend/src/modules/raw-materials/services/raw-material-editor.service.ts:save`, baseline line 38; `npm run check:rls` reports one `privileged-reason` error.
- Root cause/impact: template string instead of literal blocks backend CI.
- Fix/verification/risk: descriptive literal, item ID preserved in existing save log; actual-source regression scan passes; boundary check 0 errors / 0 warnings. No RPC/authorization change or relaxed CI rule.

## EA-010 — verification environment

**Compile-only results cannot certify runtime or tenant behavior.**

- Evidence: unconfigured baseline root build fails Supabase config collection; build-only placeholder URL/anon key permits successful compile/220 pages but does not exercise Auth/RLS. Python deps absent; e2e source uses live dev DB/FX and removed client API.
- Root cause/impact: incomplete reproducible runtime and isolated fixture prevent production/security verification.
- Fix/verification/risk: build-only placeholder config (not runtime proof), Node 20, conda/OCC image, isolated two-org fixture; real production build and CAD/integration suites. Never use production writes/migrations to make checks pass.

## EA-011 — lint and CI coverage

**Current CI omits unit suites; lint has a large pre-existing failure baseline.**

- Location/reproduction: `.github/workflows/ci.yml`, root `npm run lint` (44,225 diagnostics); backend lint scripts only echo skip messages.
- Root cause/impact: build-only coverage misses real-data regressions; lint debt is not proof every diagnostic is a runtime bug.
- Fix/verification/risk: restore suites then add real CI test runs; bounded substantive lint remediation, no broad reformat or disabled rules. Validate on CI's Node/conda versions.
