# Claude Code prompt: plan the eMithran migration (plan mode)

Start Claude Code in this repository in **plan mode** (`claude --permission-mode plan`, or press Shift+Tab until the footer says "plan mode"), then paste everything below the line. Run it once for the master plan. Afterwards, use the short execution prompt at the end of this file for one PR at a time.

---

You are the principal engineer for eMithran, a should-cost and cost-engineering platform (Next.js 16 frontend, NestJS 11 API, FastAPI + OpenCascade CAD engine, Rust cad-runner, Postgres). Your job in this session is to **produce an implementation plan only**. Do not edit, create or delete any file, and do not run commands that change state. Reading files, `git log`, `grep`, and running existing read-only checks are allowed.

## 1. Sources of truth (read these first, in this order)

1. `docs/planning/eMithran_Design_Doc_v2.md` — the target architecture. Sections 6–19 are binding.
2. `docs/planning/eMithran_PRD_v2.md` — requirements, KPIs, data promise (section 10), identity rules (11.3), lifecycle (11.5), recovery policy (12.1), release gates (13).
3. `docs/CUTOVER_AUTH0_POSTGRES.md` — the flag-driven cutover that is already built (`DB_BACKEND`, `AUTH_BACKEND`, `STORAGE_BACKEND`).
4. `docs/architecture/issue-register.md`, `architecture-audit.md`, `dependency-map.md`.
5. `docs/ENGINEERING.md` — the platform layering rule and the domain-by-domain strategy.
6. The code: `backend/src/modules/auth`, `backend/src/common/{db,supabase,storage,session,guards}`, `backend/migrations` (especially 917, 920, 930–933), `lib/auth`, `lib/supabase`, `lib/api`, `proxy.ts`, `app/api/*`, `docker-compose*.yml`, `core/crates/runner`.

If the code disagrees with the docs, report the disagreement in the plan. Do not silently pick one.

## 2. Decisions already made (do not reopen them)

- **Identity:** Auth0. Every eMithran organization is one Auth0 Organization. Code depends only on a vendor-neutral OIDC claim contract (`iss`, `sub`, `email`, `email_verified`, `sid`, `org_id`, `aud`).
- **Deployment:** eMithran runs all code (control plane). Business data and files live in a pooled data plane run by eMithran, or in a client-owned Postgres 16+ and S3-compatible bucket (dedicated data plane). No eMithran code runs in client environments.
- **Browser:** backend-for-frontend (BFF). The browser holds only an HttpOnly cookie, never access or refresh tokens. Sessions live in a server-side `sessions` table: 30-minute sliding idle timeout, 12-hour absolute lifetime, rotating refresh tokens stored encrypted.
- **Multi-organization users** are allowed across data planes. Routing is keyed by organization, never by identity.
- **Data access:** NestJS talks to Postgres through Kysely + node-postgres, with generated types, inside `withTenant(ctx, tx => …)`. That function sets `app.user_id` and `app.org_id` with `set_config(…, true)`. PostgREST is a bridge only, removed in phase 4.
- **Isolation:** two walls. The application filters by organization AND Postgres RLS is enabled and **forced** on every tenant table. `app_user` owns nothing and has no BYPASSRLS. `app_system` (BYPASSRLS) is used only by allow-listed system jobs.
- **Jobs:** the control-plane `jobs` table carries ids only, plus a unique idempotency key `tenant_id:upload_id:kind` and a soft cap of 2 running jobs per tenant. Workers re-verify tenant status and the upload's organization before using credentials.
- **Live updates:** SSE over Postgres LISTEN/NOTIFY. No realtime vendor.
- **AI:** one gateway enforces `tenants.ai_mode` (`off` | `emithran_provider` | `customer_endpoint`). The default is off for dedicated tenants.
- **Recovery policy:** reversible until the point of no return (PNR), forward-fix only after it. No reverse sync.

## 3. Hard constraints

- **Do not over-engineer.** No microservices, Redis, message broker, service mesh, new ORM (other than Kysely), or Kubernetes. Anything new needs a measured reason, written in the plan.
- **Do not change costing results.** Formulas, reference data under `memory/` and `backend/data`, the generated CAD vocabulary, and the costing kernel outputs stay byte-identical. The existing backend test suite (about 1,783 tests) is the regression net and must stay green.
- Never put secrets in code, tests, fixtures or plans. Rotating historical secrets is an owner action; plan for it, do not attempt it.
- Small, reviewable PRs: one concern each, ideally under 400 changed lines excluding generated files. Each PR must be behind a flag or backward compatible, and must say how to roll it back.
- Clean code: the platform layer owns vendors; feature code never imports `@auth0/*`, `@aws-sdk/*`, `pg` or `@supabase/*`. No `any`, no `as unknown as`, no generic base repositories or DTO mappers. Validate once at the edge with zod. Pure domain functions. Comments explain why, not what.
- Tests come with the change: real Postgres (Testcontainers) for data and isolation tests, and contract tests before porting any module from PostgREST to Kysely.
- Respect `.gitignore`. Do not touch `memory/` except to read it.

## 4. Scope of the plan: phases and gates (Design Doc section 17)

**Phase 0 — Hygiene (gate G1, Security)**
- CI rules: fail on `@supabase/*` or database clients imported in `app/`, `lib/`, `components/`; fail on new privileged DB calls outside an allow-list; extend `check-rls-bypass`; allow-list logger with a log-canary test.
- BFF route handler in Next.js: the browser calls `/api/*`; the server attaches the access token; remove client-side `getAccessToken` usage. Add a server-side session store (`sessions` table) with the idle and absolute timeouts and rotating refresh tokens.
- Squash migration trees into a verified `0000_baseline.sql`. Prove an empty schema diff against a production schema dump before deleting old trees (tag `pre-squash`).
- Cleanup items from Design Doc section 19 that are marked phase 0 (duplicate data files, TypeORM, compose duplication, env templates, ESLint ignoring `dist/`). Each removal is its own PR.
- Checklist for the owner: rotate the 39 historical secrets and the Supabase service key.

**Phase 1 — Cutover to Auth0 + Postgres, pooled (gate PNR)**
- Follow `docs/CUTOVER_AUTH0_POSTGRES.md`. Add what the review requires:
  - identity linking by `(iss, sub)`;
  - invitation binding with normalised verified email;
  - legacy linking once, by exact normalised email, with an ambiguity report;
  - a write-freeze flag;
  - a cutover and rollback drill on stage;
  - the PNR checklist from PRD 12.1.

**Phase 2 — Tenancy foundation (gate G2, Isolation)**
- Control-plane tables: `users`, `user_identities`, `organizations`, `memberships`, `tenants`, `sessions`, `jobs`, `audit_events`.
- TenantRegistry with a 15-second cache and NOTIFY-based eviction; TenantGuard (resolution algorithm in Design Doc 7.2); DataPlaneRouter (pool budgets in Design Doc 12).
- `platform/db/with-tenant.ts`, plus redefining `current_user_org_ids()` and `auth.uid()` to read the transaction settings.
- Roles and catalog checks from Design Doc 8. FORCE RLS on all tenant tables, `security_invoker` views, a SECURITY DEFINER audit and allow-list.
- Move the 26 browser database queries behind NestJS endpoints. Fix delivery/QC tenancy (EA-002) using `backend/docs/delivery-quality-tenant-isolation-design.md`.
- SSE replaces Supabase Realtime in DeliveryTracking.
- The isolation test matrix from Design Doc 8.4.

**Phase 3 — First dedicated data plane (gates G3 and G4 for that tenant)**
- Per-tenant ObjectStore configuration with STS role assumption.
- Two file modes: direct signed URL, or streamed through the BFF.
- Worker data handling: per-job tmpfs, sweeper, no core dumps, no payload logs.
- Job binding and replay protection; revocation paths and drill (Design Doc 7.4).
- Fleet migrator with per-tenant state.
- Reference data served read-only from the control plane.
- AI gateway.
- An onboarding runbook and Terraform module outline. The module creates client resources only.

**Phase 4 — Finish the port**
- Port modules from PostgREST to Kysely one per PR, following Design Doc 9.1 (contract tests first).
- Then delete PostgREST, `@supabase/*`, the three backend flags, `common/supabase`, `supabase-object-store` and the runner's Supabase backend.
- Exit criteria: `@supabase` imports = 0; privileged calls in feature modules = 0.

## 5. What to investigate before writing the plan

1. Map every Supabase touch point with exact counts and file lists: frontend imports, direct browser queries, `.from()` tables, `.rpc()` functions, `getPrivilegedClient` call sites grouped by module, storage calls, realtime.
2. List every SECURITY DEFINER function, every view, and every table without RLS (from the migrations). Mark which belong to delivery/QC.
3. Find every place that reads organization context (`organization-context.guard.ts`, `X-Org-Id`, `current_user_org_ids`) and every place that reads `auth.uid()`.
4. Rank modules for the Kysely port: by number of call sites, write complexity (multi-row writes that need transactions), and test coverage. Recommend the order.
5. Check what the CAD engine and cad-runner need to change for per-tenant storage and job binding.
6. Identify the existing tests and commands that make up the safety net: root `npm test`, `npm run type-check`, `backend npm test`, `npm run test:sql`, `test:postgrest`, `test:s3`, `test:boot`, `test:baseline`, `check:rls`. Report which pass today.

## 6. Output format of your plan

Write the plan as one Markdown document with these sections:

1. **Findings:** counts and lists from section 5, plus any disagreement between code and docs.
2. **Risks found in the code** that the docs do not cover, ranked.
3. **PR breakdown**, grouped by phase, as a table with these columns: ID (e.g. P0-03) | title | why | files touched | tests added or changed | flag or compatibility | rollback | estimate (S/M/L) | depends on.
4. **Gate checklists** (G1, PNR, G2, G3, G4): each item says the evidence that proves it (command, test name, report).
5. **First three PRs in detail:** exact file paths, function signatures, migration SQL outline and test cases. No full implementations.
6. **Questions for me:** decisions you cannot make from the docs. Ask, do not assume.

Keep the plan concise and specific. Prefer tables and lists over prose. Every claim about the code cites a path and line or a grep result.

---

## Execution prompt (use after the plan is approved, one PR per session)

> Implement PR `<ID>` from the approved plan in `docs/planning/IMPLEMENTATION_PLAN.md`. Follow the Design Doc and the constraints in section 3 of `docs/planning/IMPLEMENTATION_PLAN_PROMPT.md`. Work on branch `feat/<id>-<short-name>`.
>
> 1. Restate the PR goal, files and tests in five lines.
> 2. Write the failing tests first.
> 3. Make the smallest change that passes.
> 4. Run: root `npm test` and `npm run type-check`; in `backend/`, `npm test`, `npm run typecheck`, `npm run check:rls`; plus `npm run test:sql` when SQL changes.
> 5. Show the diff summary and test results.
> 6. Stop and ask before anything outside the PR's scope, any schema change not in the plan, or any deletion.
>
> Do not commit or push until I say so.
