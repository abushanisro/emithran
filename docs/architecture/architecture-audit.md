# Architecture audit — baseline and safe-fix tranche

**Repository evidence establishes several defects, not complete production readiness.**

- Date: 2026-10-11; baseline `main`: `7ea13f68895b6bcb3249c431d49cb61fc8619f8c`.
- Requirements: [saved brief](https://cosmos.augmentcode.com/files/emithran-architecture-audit-brief-e67ce2d6720e4ff4897fdd84aeaab819).
- Scope: discovery, local baseline, representative BOM/costing/CAD/auth flows, and small reproducible fixes. Full security, manufacturing and deployed-configuration verification remains outstanding; this is an initial tranche of the brief.
- No live database, deployed configuration, customer data, migration execution, or deployment was accessed.

## Actual architecture and discovery

**Next.js, NestJS, and FastAPI are separate runtimes over Supabase, not proof of a deployed microservices topology.**

- Next ^16.1.1 / React ^19: `app/`, `proxy.ts`, `lib/api/`; browser manufacturing workflows, Supabase session refresh, server proxy and AI routes.
- Nest ^11: `backend/src/main.ts`, `app.module.ts`; BOM/costing, projects, suppliers/RFQ, production, quality and delivery. Global authentication/throttling; organization context is opt-in.
- Python FastAPI/OpenCascade: `cad-engine/main.py`, conda Dockerfile; conversion, features, geometry, nesting, drawing/copilot routes. Supabase provides Auth, PostgREST/PostgreSQL and storage.
- External integrations include AI, maps/routing and FX; actual provider/deployment configuration is unverified. See [dependency map](dependency-map.md).
- Baseline: 3,579 tracked files, including 1,198 reference files under `memory/`. Lowercase `sheetmetal`, `machining`, `plastic modeling` paths are real manufacturing inputs.
- SQL trees: `backend/migrations` (753), `backend/database/migrations` (96), `supabase/migrations` (1). Existing delivery/QC design records conflicting historical definitions; live schema cannot be inferred.
- Root/backend npm lockfiles; CI declares Node 20, while this VM uses Node 22.23.1/npm 10.9.8/Python 3.12.13. CAD requires conda/OCC unavailable here.
- Docker/Compose/Railway/Render configurations coexist. Compose describes PostgreSQL/Redis/RabbitMQ/MinIO, but active deployment is unknown; Compose frontend references `Dockerfile` rather than tracked `Dockerfile.frontend`.
- No file was classified obsolete merely by filename or lack of direct imports. Reference data, migrations, generated vocabulary, deployment manifests and compatibility fallbacks are preserved.

## Baseline before implementation

**These failures predate this PR.**

| Command | Baseline | Actual result / limitation |
|---|---|---|
| root/backend `npm ci --no-audit --no-fund` | PASS | both locked installs succeeded |
| root `npm test` | PASS | 26 files / 239 tests |
| root `npm run type-check` | PASS | TypeScript |
| root `npm run lint` | FAIL | 40,797 errors / 3,428 warnings; includes backend/tests |
| root `npm run build` | BLOCKED | Supabase configuration missing during delivery route page-data collection; process ended 139 |
| backend `npm test -- --runInBand` | FAIL | 14 failed / 111 passed suites; 5 failed / 1,636 passed tests; reference-path ENOENT |
| backend `npm run typecheck` | PASS | TypeScript |
| backend `npm run check:rls` | FAIL | one nonliteral privileged-access reason in raw-material editor |
| backend `npm run build` | PASS | Nest compilation, not runtime integration |
| `python -m pytest cad-engine/test` | BLOCKED | pytest absent; FastAPI/OCC/Shapely/magic also absent |
| `python -m compileall -q cad-engine` | PASS | syntax only, not CAD execution |
| backend `npm run test:e2e` | NOT RUN | live dev Supabase/FX, no isolated fixture; source references removed `getAdminClient()` |
| migrations / direct database isolation | NOT RUN | no approved isolated database or live schema evidence |
| root/backend `npm audit --json` | FAIL | root 26 (3 critical, 15 high); backend 47 (2 critical, 39 high) advisories |
| tracked credential presence scan | FAIL | nonempty CAD key assignments in two tracked env files, Redis password assignment in development; values withheld |

The reported Dependabot baseline of 89 (3 critical / 39 high) is not independently verified as a GitHub alert count. npm counts are independent lockfile reports, not a unique union or regressions. No dependency upgrade is authorized.

## Security assessment

**Authentication exists, but privileged and direct database paths still defeat tenant isolation.**

- `SupabaseService.getClient/getUserClient` reject missing user context and apply user JWT/RLS; named privileged access deliberately bypasses RLS. No second backend DB-driver path is reported by the existing boundary scanner.
- Delivery/QC use 44 unscoped privileged sites; repo-defined delivery policies, views and RPCs expose direct-API paths too. Existing [inventory](../../backend/docs/rls-bypass-inventory.md) and [migration design](../../backend/docs/delivery-quality-tenant-isolation-design.md) are evidence, not proof of live enforcement.
- Next `proxy.ts` refreshes sessions, not route authorization; `app/api/cad/route.ts` forwards server authority without caller verification. Python memory-report/optimization endpoints lack the key dependency used by conversion/geometry/nesting.
- File proxy validates only initial hostname, trusts backend URLs, follows redirects, and double-decodes query data. Organization guard ignores explicit selection for single-org accounts.
- Historical Supabase credential rotation and tracked CAD/Redis credential remediation require owner action; a clean JWT-only scanner does not establish absence of other secrets.

## Manufacturing and coupling assessment

**Restore real regression evidence without changing physical or business assumptions.**

- BOM orchestration and shared costing/process engines live under `backend/src/modules/bom-items/`; Sheet Metal is the priority but machining/molding also use shared contracts, per `CLAUDE.md`.
- CAD vocabulary is generated from reference operation catalogs. Generated JSON/TypeScript must not be hand-edited; missing capability/material data must not be fabricated.
- Passing baseline tests cover shared kernel, currency persistence, routing, machine capability and DFM. Case-broken real-data suites cannot establish manufacturing correctness until restored.
- Large BOM orchestration, legacy feature representations and duplicate migration trees are architectural coupling risks, not justification for an untested rewrite.
- No new independently verified physical manufacturing example or isolated two-tenant integration fixture was supplied. Unit tests do not certify all formulas/rates/customer scenarios.

## Fixes and post-change validation

**Only bounded, locally reproduced fixes are implemented in this tranche.**

| Fix | Files / rationale | Evidence |
|---|---|---|
| EA-004 | `app/api/file-proxy/route.ts`: HTTPS/no userinfo, validate both modes, manual redirects rejected, no double decode | 15 route tests; 13 failed against original implementation, all pass after fix |
| EA-007 | `backend/src/common/guards/organization-context.guard.ts`: validate explicit selection before singleton fallback | new negative foreign/malformed-header cases failed before fix; valid/no-header/lookup-failure cases pass |
| EA-008 | reference-reading specs/helpers and `modules/processes/memory-reference-domains.json`: exact tracked casing | all 125 backend suites now execute/pass using real tracked data; manifest only changes two folder names, not domain labels/versions |
| EA-009 | `raw-material-editor.service.ts`: literal audit reason; source-scanning regression test | boundary check now 0 errors / 0 warnings; no relaxed rule or RPC behavior change |

| Post-change command | Result | Evidence / limitation |
|---|---|---|
| root `npm test` | PASS | 27 files / 254 tests |
| root `npm run type-check` | PASS | includes changed runtime code |
| root `npm run build` with build-only placeholder Supabase URL/anon key | PASS | compilation and 220 static pages; no real credentials, not runtime/Auth/RLS verification |
| backend `npm test -- --runInBand` | PASS | 125 suites / 1,783 tests; assertions/formulas/reference data unchanged |
| backend `npm run typecheck` | PASS | after all backend changes |
| backend `npm run check:rls` | PASS | 0 errors / 0 warnings; JWT scan only, tracked CAD secrets still unresolved |
| backend `npm run build` | PASS | Nest compilation |
| `git diff --check` | PASS | no whitespace errors |

`npx eslint test/api/file-proxy.test.ts`: PASS after correcting import order. Final full `npm run lint`: FAIL (41,763 errors / 3,428 warnings); all 966 extra errors are generated `backend/dist` files created by the build, with no error-count increase in changed source files. The RLS rule suite was rerun after its import cleanup: 29 tests PASS.

Dependency advisories, credential rotation, CAD execution, live tenant/migration checks and live e2e remain unresolved as recorded above. The saved brief's High-risk exception/production-verification gates are not approved or complete. No files/dependencies/migrations/formulas/currency or rounding assumptions/customer data were removed or rewritten.

## Remaining blockers and next steps

**The saved brief's full definition of done is not met.**

1. Owner rotates historical Supabase and tracked CAD/Redis credentials, updates deployment secrets, and approves startup-compatible tracked-env remediation.
2. Obtain approved schema/policy/grant introspection plus isolated two-org fixture; approve delivery/QC ownership/backfill/migration design before changes.
3. Verify auth transport/callers across Next proxies and CAD/AI routes, then implement end-to-end negative tests in the actual conda runtime.
4. Approve reachable dependency upgrades; reproduce builds and suites on Node 20/CAD image. No deployment or data writes from this PR.
5. Restore broad CI tests and address substantive lint debt in separate reviewable work; expand transaction and independently verified manufacturing scenario coverage.
