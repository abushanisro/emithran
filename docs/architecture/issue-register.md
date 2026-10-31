# Architecture issue register

**Severity describes repository evidence; live exposure and policy state remain unverified.**

Baseline: `7ea13f68895b6bcb3249c431d49cb61fc8619f8c`, 2026-10-11. No secret values included.

| ID | Severity | Confidence | Status | Finding |
|---|---|---|---|---|
| EA-001 | Critical | Confirmed history; rotation unverified | BLOCKED | historical Supabase service credential |
| EA-002 | High | Confirmed repo code/policies; live unverified | BLOCKED | delivery/QC cross-tenant privileged/direct DB access |
| EA-003 | High | Confirmed | PARTIAL — removed from tree; rotation BLOCKED (owner) | credential assignments in tracked CAD env files |
| EA-004 | High | Confirmed code; live redirect exploit unverified | FIXED / unit-verified | file-proxy destination boundary bypass |
| EA-005 | High | Confirmed | FIXED / CAD runtime-verified, Next unit-verified; live Supabase check pending | CAD proxy/memory endpoint authentication gaps |
| EA-006 | High | Confirmed advisories; reachability unassessed | PARTIAL — runtime fixes applied; dev-tooling majors remain | vulnerable dependency baseline |
| EA-007 | Medium | Confirmed | FIXED / unit-verified | single-org guard ignores explicit foreign org |
| EA-008 | Medium | Confirmed | FIXED / full-suite verified | case-sensitive manufacturing reference paths |
| EA-009 | Medium | Confirmed | FIXED / CI-check verified | RLS-boundary CI violation |
| EA-010 | Medium | Confirmed | BLOCKED | production/CAD/integration verification gaps |
| EA-011 | Low | Confirmed | Deferred | lint debt and missing unit suites in CI |
| EA-012 | High | Confirmed code; live exploit unverified | FIXED / unit-verified | unauthenticated server-side fetch of caller-supplied URL in VAVE drawing proxy |
| EA-013 | Low | Confirmed | FIXED / runtime-verified | CAD image's baked `ENVIRONMENT=production` is not read by `AppConfig` |
| EA-014 | High | Confirmed code | FIXED / unit-verified | copilot engineering memory shared across all users and tenants |
| EA-015 | Medium | Confirmed code; runtime unverified | FIXED / unit-verified | RFQ email attaches BOM files by storage path |

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
- Fix (done): nothing loads these files (`load_dotenv()` reads `.env`, compose uses `env_file: .env`, `.dockerignore` and root `.gitignore` exclude them; they were force-added). The three credential values are now empty in place; non-secret settings kept. Metadata scan: 0 nonempty secret assignments in any tracked env file. Values remain in git history, so owner rotation is still required.

## EA-004 — file-proxy destination boundary

**Validating only the initial hostname does not constrain the final fetch destination.**

- Location: `app/api/file-proxy/route.ts`, `isTrustedUrl` / `GET`; no scheme/userinfo validation, backend URLs unchecked, redirects followed by default. Query is decoded twice.
- Reproduction/root cause: trusted-host mocked 302 to private destination, untrusted backend URL, and percent-escaped filename; allowlist applies to only one input path rather than every fetch.
- Impact: possible SSRF if trusted storage redirects; signed URL corruption. No live attack performed.
- Minimal fix: HTTPS/no credentials, validate both modes, reject redirects, preserve signed query encoding.
- Verification/risk: 15 route contract tests pass (13 failed before fix), including negative/no-follow cases and positive streaming in both modes. Legitimate redirect URLs intentionally rejected, direct trusted URLs preserved.

## EA-005 — CAD authentication gaps

**The server key did not protect every path to CAD authority, and Next proxies forwarded it for anonymous callers.**

- Root cause: auth attached per route by hand in `cad-engine` (one router carried a divergent copy that did not fail closed), and no Next API route verified caller identity.
- Fix (CAD engine): `main.py` registers the copilot and drawing routers with `dependencies=[Security(require_api_key)]` and adds it to both memory routes; duplicate `copilot/router.py:_require_api_key` removed. Verified with `TestClient` against the real app (scratch conda env, `pythonocc-core` 7.7.2): key set → 403 for missing/wrong key; production with no key → 503; development with no key → open (unchanged); `/health` public.
- Fix (Next): `getAuthenticatedUser()` in `lib/database/supabase-server.ts` verifies the existing Supabase cookie session with `auth.getUser()` (Auth-server validation, not local JWT decode) via the existing `createServerSupabaseClient()`. `/api/cad`, `/api/vave/drawing-analysis`, `/api/manufacturing-copilot/chat` return 401 before any upstream call when it is null. Cookie session chosen on evidence: sessions are cookie-based (`createBrowserClient` + `proxy.ts` refresh), `AppLayout` redirects every dashboard page to `/auth` without a user, every caller is a same-origin dashboard fetch, and no `auth`/`demo`/`developer` page uses these routes, so no client change is needed.
- Verification: 17 route tests + 4 helper tests (14 route tests fail on the original code); frontend 254/254, `tsc` clean, production build 220 pages. Remaining: one live sign-in → STEP view/copilot/VAVE analysis smoke test against a real Supabase project.
- Regression risk: `getUser()` adds one Auth round trip per call on these compute/LLM routes; Auth outage now returns 401 instead of proceeding.


## EA-006 — dependency advisories

**Locked dependency versions carried known advisories.**

- Fix (done, owner-approved): `npm audit fix` without `--force` in root and backend (lockfile only, 125 packages changed, 0 major bumps; `next` 16.3.2 → 16.4.0, backend `axios` 1.20.0, `multer` 2.4.0). Backend `nodemailer` ^9.0.5 → ^10.1.0, the only runtime package whose advisories required a major: v10's sole breaking change is Node ≥ 20 (backend Dockerfiles and `.nvmrc` are Node 20); `createTransport`/`SendMailOptions` usage verified with a real v10 message build.
- Result: root 26 → 17 (critical 3 → 2), backend 47 → 38 (critical 2 → 0). Backend 1,783/1,783, backend build, frontend 254/254 and production build pass.
- Remaining (decision): all remaining high/critical findings are dev/test tooling requiring majors — root `vitest` 5, `tailwindcss` 4, `eslint-config-next`, `shx`; backend `jest` 30 / `@types/jest` 30. Each is a migration (config/API changes), not a lockfile bump, and none ships in the runtime bundle.


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

- Evidence: unconfigured baseline root build and first PR frontend CI job fail the same Supabase config collection (authenticated logs confirmed). Build-only placeholder URL/anon key permits successful compile/220 pages but does not exercise Auth/RLS. Python deps absent; e2e source uses live dev DB/FX and removed client API.
- Root cause/impact: incomplete reproducible runtime and isolated fixture prevent production/security verification.
- Partial fix/verification: `.github/workflows/ci.yml` supplies placeholders only for absent public frontend Supabase build settings; existing secrets take precedence and no artifact is deployed. YAML assertions and full build with all other CI secret inputs empty PASS locally (Node 22); updated Node 20 CI pending. Runtime/CAD/two-org integration remains BLOCKED; never use production writes/migrations to make checks pass.

## EA-011 — lint and CI coverage

**Current CI omits unit suites; lint has a large pre-existing failure baseline.**

- Location/reproduction: `.github/workflows/ci.yml`, root `npm run lint` (44,225 diagnostics); backend lint scripts only echo skip messages.
- Root cause/impact: build-only coverage misses real-data regressions; lint debt is not proof every diagnostic is a runtime bug.
- Fix/verification/risk: restore suites then add real CI test runs; bounded substantive lint remediation, no broad reformat or disabled rules. Validate on CI's Node/conda versions.

## EA-012 — VAVE drawing proxy URL fetch

**An anonymous caller could make the Next server fetch an arbitrary URL.**

- Evidence: `BOMExplorer.tsx` imports `drawingUrl = file2dPath ?? drawing_url`; `file2dPath` is `FileStorageService.generateStoragePath` output (`{user}/{project}/bom-items/{bomItemId}/{2d|3d}/{ts}_{name}`), a storage path, not a URL. `fetch()` of that relative path throws, so the imported-item path was also functionally broken; `CreateVaveItemDto.drawingUrl` accepts any string.
- Fix: `isTrustedUrl` and file-proxy Mode B extracted to `lib/utils/storage-file-url.ts` (`isTrustedStorageUrl`, `parseBomItemStoragePath`, `resolveBomItemFileUrl`), used by both routes. VAVE route (now authenticated) accepts a BOM-item storage path — resolved through backend `GET /bom-items/:id/file-url/2d` as the caller, which loads the item under RLS and signs its own stored path — or a trusted HTTPS storage URL; everything else is 400. Redirects are never followed.
- Verification: loopback/metadata/untrusted/credentialed/`file:` URLs rejected without fetching; path resolution uses the session bearer; backend denial propagated; untrusted backend URL rejected; storage redirect refused; base64 path unchanged; file-proxy's 15 EA-004 tests unchanged and passing.
- Behaviour note: a path resolves to the BOM item's current 2D file, which differs from the imported path only if the drawing was replaced after import.
- Related, resolved: copilot `backendUrl` is set from server config in the Next proxy (overriding the client body) and the CAD route is key-gated, so a browser cannot choose it.


## EA-013 — CAD image environment variable

**`cad-engine/Dockerfile` wrote `ENVIRONMENT=production`, but `shared/config.py` reads `NODE_ENV`.**

- Fix: the baked `.env` also sets `NODE_ENV=production` (`ENVIRONMENT` kept; `copilot/router.py` reads it). `load_dotenv()` never overrides an existing variable, so Railway/root compose (explicit `NODE_ENV`) are unchanged, and dev compose mounts `.:/app`, hiding the baked file.
- Verification with the exact baked `.env`: no process `NODE_ENV` → production, keyless request 503 (was development / open); explicit `NODE_ENV=development` still wins.

## EA-014 — copilot memory tenancy

**Every copilot user shared one engineering memory.**

- Root cause: `CopilotPanel` never sends `userId`, so `copilot/memory.py` keyed all memory under `anonymous__default`; the Next proxy also took identity/token from the request.
- Fix: the Next proxy sets `userId` from the verified session user and `authToken` from the verified session, overriding any body values.
- Follow-up (owner): existing shared memory files may remain in `COPILOT_MEMORY_DIR` (default `/tmp/copilot_memory`) on the CAD host until redeploy; remove `anonymous__*` there.

## EA-015 — RFQ email attachments

**`rfq-email.service.ts:prepareFileAttachments` passes `file2dPath`/`file3dPath` (storage object paths) to nodemailer as `path`, which nodemailer reads from the local filesystem or over HTTP.**

- Impact: attachments resolve against the backend container's filesystem instead of storage, so RFQ sends with files likely fail. Not changed: requires choosing signed-URL vs downloaded-buffer attachments and size limits for multi-file RFQs.
- Fix (`5b23ad00`, `05683e21`): attachments are downloaded buffers. Each path comes from the BOM item row read with the caller's own client, must pass `BomFileAccess.canRead` (the caller's own folder of a project they own; another user's path is refused without a database call) and is read from the object store; files over the size limit are skipped with a warning. The transport is created with `disableFileAccess` and `disableUrlAccess`, so a server path or URL in a path column is never attached.
- Verification: `src/test/modules/rfq/services/rfq-email.service.spec.ts` (bytes attached after the check, another tenant's object never read, server file and URL never attached, transport locked) and `src/common/storage/bom-file-access.spec.ts`; 8 tests pass. Not verified: a real RFQ send with files against a mail server.
- Next: Design 7.5 removes CAD from RFQ emails altogether (plan P1-15: link only).
