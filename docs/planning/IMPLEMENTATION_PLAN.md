# eMithran implementation plan (v2): cutover blockers → tenancy → dedicated data plane on trigger → PostgREST exit

## Changes from v1

1. §3: PRs are grouped by tier instead of by phase: Tier 1 (cutover blockers), a parallel track, Tier 2 (after PNR), Tier 3 (on trigger), and phase 4.
2. §3: P0-04 and P0-05 (logger and its lint check) were not assigned to any tier in the revision prompt. They are put on the parallel track, and "logger check" moves from G1 to G2 (Q13).
3. §3 P0-01 and P0-02: marked done (`c39745e8`, `c23dda93`). P0-01 is `scripts/check-frontend-boundary.ts` (Node 24 runs TypeScript directly), not `.mjs`. P0-02's baseline is 156: Finding D2's 158 includes 2 calls inside `supabase.service.ts`, which is exempt. Findings are kept unchanged.
4. §3, §5 P0-03: CSRF protection is an `Origin` check on unsafe methods plus `SameSite=Lax` cookies. The double-submit token is removed.
5. §3 P0-08: the session store is in a top-level `bff/` folder with its own `pg` pool against a separate `emithran_control` database (`migrate.ts --target control`). The P0-01 check scans `bff/` and allows `pg` only there.
6. §3, §4: P0-10 and P0-11 move to Tier 2 and are blocked on `prod_schema.sql`, which the owner provides after G1. "Baseline squash verified" moves from G1 to G2.
7. §3 P0-12: adds checksums for every file in `backend/data`, a search for dynamically built paths, and verification against the P0-21 golden snapshot.
8. §3 P1-01: the frontend sends `X-Organization-Id`, and NestJS checks for an active membership on every request.
9. §3 P2-03: the dual-write is replaced by a one-time backfill. From then on the control plane is the only writer, with a nightly parity check, and the tenant `organization_members` table becomes read-only legacy data.
10. §3 P2-10: backfills on tables with forced RLS must run as `migrator` or with tenant settings set, plus a `test:sql` case that proves it.
11. §3 P3-05, P3-06: the runner uses option (a). It talks to an internal API only and holds no database credentials, S3 keys or `DB_JWT_SECRET`. STS is removed from the Rust work only; P3-03 keeps STS for the API.
12. §3 P3-01: the secret store is AWS Secrets Manager with KMS. The review adds an in-memory cache that serves the last value for up to 24 h if the store errors, health checks that never call the store, A/B rotation, replication to the DR region, and alerts.
13. §3 phase 4: a 30-day route-usage check comes before contract tests for `supplier-nominations`, `projects` and `production-planning`. `lhr`, `mhr` and `calculators` are never frozen.
14. §3: new PRs P0-20 (docs correction), P0-21 (golden snapshot), P1-00 (stage and Auth0 checklist), P1-14 (EA-015), P2-20…P2-25 (rate limits, export and deletion, audit writer, k6, backup tables, quarantine).
15. §3, from the 30 Oct design review: new PRs P1-15 (no CAD email attachments; dead portal link), P1-16 (HA Postgres), P2-26 (guest supplier access), P2-27 (tenant function ratchet), P3-13…P3-15 (move proprietary SQL out, SQL-bundle delivery, Frankfurt cell).
16. §3, from the review: P2-01 and P3-02 pool settings change to min 1, idle 5 min and lifetime 30 min with jitter. P2-04 does BEGIN and the settings in one round trip. P3-08's revocation targets are restated. P2-23 measures server time in region.
17. §3: dependency moves. P2-14 now depends on P2-25 (quarantine before backfill). P2-10 depends on P2-24 (backup tables gone before FORCE RLS).
18. §4: gates match tiers. G1 = Tier 1 security; PNR = end of Tier 1, adding an HA failover test and a restore under 2 h; G2 = Tier 2; G3/G4 = Tier 3, with G4 adding a failover test and the error-budget policy.
19. §6: decisions 1–15 are recorded; new questions Q13–Q18.

## Context

eMithran is moving from one Supabase project (login, data, files, realtime) to:
- Auth0 for identity;
- a control plane run by eMithran;
- pooled or client-owned data planes.

The Design Doc v2 (sections 6–19, revised 30 Oct 2026) and PRD v2 define the target. `docs/CUTOVER_AUTH0_POSTGRES.md` covers the flag-driven bridge that is already built.

This plan sequences the remaining work into small PRs, each behind a flag or backward compatible, grouped in tiers. Findings are based on the code at `6e6f044f`.

---

## 1. Findings

### 1.1 Safety net today (all run on 30 Oct 2026, all green)

| Command | Result |
|---|---|
| root `npm test` (vitest) | **653 passed / 81 files** |
| root `npm run type-check` | 0 errors |
| backend `npm test` (jest) | **2,841 passed / 226 suites** |
| backend `npm run typecheck` | 0 errors |
| `npm run check:rls` | 0 errors, 0 warnings |
| `npm run test:sql` | 10 SQL tests ok (Docker PG17) |
| `npm run test:postgrest` | 13 checks ok plus 2 Rust runner tests |
| `npm run test:s3` | ok (SeaweedFS) plus 3 Rust SigV4 tests |
| `npm run test:baseline` | 15 checks ok |
| `npm run test:boot` | 4 checks ok (against the existing `dist/`, built 30 Oct 03:35) |

Gaps in CI:
- CI does not run `test:baseline` or root lint (`.github/workflows/ci.yml`).
- No CI job uses Testcontainers; the Docker tests use bash `docker run`.

### 1.2 Frontend Supabase surface

**17 files import Supabase.** 13 run in the browser and 4 on the server. Command: `grep -rnE "(from|import\(|require\()\s*['\"][^'\"]*supabase" app lib components hooks types proxy.ts`.

| Side | Files |
|---|---|
| Browser | `app/(dashboard)/projects/[id]/quality-control/[inspectionId]/page.tsx:49`, `app/(dashboard)/settings/page.tsx:36`, `app/auth/callback/page.tsx:5`, `components/features/delivery/DeliveryTracking.tsx:35`, `lib/api/hooks/useExchangeRates.ts:2`, `lib/api/hooks/useProcessPlanGenerate.ts:19` (relative import), `lib/api/organization.ts:1`, `lib/auth/session-source.ts:5`, `lib/providers/query-provider.tsx:7`, `lib/providers/supabase-auth-provider.tsx:5`, `lib/supabase/client.ts:7`, `lib/config/env-validator.ts:1` |
| Server or edge | `proxy.ts:1`, `lib/supabase/server.ts:7`, `lib/server/auth.ts:7`, `lib/server/verified-session.ts:5`, `lib/api/delivery-tracking.ts:7` |

**Direct data calls: 26, matching the design doc's figure.** By kind:

| Kind | Count | Where |
|---|---|---|
| `.from` (browser) | 15 | `organizations` ×4, `organization_members` ×4, `workspaces` ×5 (all in `lib/api/organization.ts`); `exchange_rates` (`useExchangeRates.ts:11`); `authorized_users` (`app/auth/callback/page.tsx:48`) |
| `.from` (server, `supabaseAdmin`) | 8 | `delivery_orders` ×6, `delivery_tracking` ×1, `projects` ×1, in `lib/api/delivery-tracking.ts`, used by `app/api/delivery/*` |
| `.rpc` | 1 | `is_user_authorized` (`app/auth/callback/page.tsx:43`) |
| `storage.from` | 2 | `avatars` upload and URL (`app/(dashboard)/settings/page.tsx:308-311`) |

The 26 does not count:
- 1 realtime subscription (`DeliveryTracking.tsx:175-181`, `postgres_changes` on `delivery_tracking`);
- 22 `supabase.auth.*` calls (19 browser, 3 server).

**Client-side token use:**
- `lib/api/client.ts:180,512,1139`: `getAuthToken()` → `sessionSource.getAccessToken()` → Bearer header.
- `lib/auth/session-source.ts:57-60`: Auth0 `getAccessToken()` goes through the SDK `/auth/access-token` endpoint, so the token reaches the browser.
- Also: `lib/auth/session-idle/browser.ts:23`, `BOMItemDetailPanel.tsx:86`, `auth0-auth-provider.tsx:15`, `quality-control/[inspectionId]/page.tsx:67-74`.
- `useProcessPlanGenerate.ts:325-330` puts the token in an EventSource URL `?token=`.

Bugs found on the way:
- `lib/api/bom.ts:206` and `lib/utils/download-bom-item-excel.ts:21` send `Bearer null`, because `apiClient.getAccessToken()` always returns `null` (`client.ts:171-174`).
- `rfq/page.tsx:104` reads `localStorage.token`.
- `client.ts:186-193` hard-codes a Supabase project ref.

**Routing, Auth0 and CI:**
- `proxy.ts` sets headers and refreshes the session. It protects no route. There are 17 `app/api/*` route files.
- Four routes have **no auth**: `balloon-annotations` (an in-memory Map shared across users), `extract-inspection-table`, and the two `route-calculation*` routes.
- `@auth0/nextjs-auth0@4.33.0` runs with SDK session defaults: rolling, **1-day idle, 3-day absolute** (`lib/auth0.ts` passes no `session` options). The SDK supports `sessionStore: SessionDataStore` (with `deleteByLogoutToken` for back-channel logout) and `enableAccessTokenEndpoint: false` (`node_modules/@auth0/nextjs-auth0/dist/types/index.d.ts:40-68`, `server/client.d.ts:149,183`).
- No frontend CI rule blocks Supabase or database imports. ESLint (`eslint.config.mjs`) ignores `dist/**` at the root only, so `backend/dist` is scanned. CI does not run lint.

### 1.3 Backend Supabase surface

**General counts:**

| Metric | Count | Note |
|---|---|---|
| Files mentioning Supabase | 208 (259 with specs) | Design doc says 261 |
| `.from()` call sites | 1,068 | |
| Distinct tables | 204 | Design doc says 205 |
| `.rpc()` call sites | 64 | |
| Distinct RPCs | 56 | Design doc says 55 |
| Storage calls | 1 | `common/storage/supabase-object-store.ts:12`; everything else goes through `ObjectStore` |
| Realtime | none | `common/db/postgrest-client.ts:11` |

**`getPrivilegedClient` calls: 158.** The design doc says 177 and `backend/docs/rls-bypass-inventory.md:23` says 128. 144 are in `src/modules` and 14 in `src/common`.

| Module | Calls | Main files |
|---|---|---|
| bom-items | 65 | `sheet-metal-lookup.service.ts` 37, `machining-lookup.service.ts` 9, `bom-items.service.ts` 6, … (mostly **reference-data lookups**) |
| delivery | 23 | `delivery.service.ts` 22, `invoice.service.ts` 1 |
| quality-control | 22 | `quality-inspection.service.ts` 16, `quality-control.service.ts` 6 |
| processes | 8 | |
| electronics-costing | 6 | |
| manufacturing-rules | 4 | |
| lhr | 3 | |
| cad-uploads, costing, health | 2 each | |
| auth, calculators, mhr, process-plan-generator, raw-materials, rfq, should-cost | 1 each | |
| common | 14 | fx ×2, user-directory ×3, audit ×2, session ×2, supabase.service ×2, supabase-object-store ×1, exchange-rate ×1, organization-context.guard ×1 |

`check:rls` (`backend/scripts/rls-bypass-rules.js`):
- requires a literal reason string for each call;
- has **no numeric baseline**, so drift from 128 to 158 failed nothing;
- **bans `pg` and Kysely imports anywhere in `src/`** (rule `second-db-path`).

**Common infrastructure and auth:**
- `common/db/postgrest-client.ts:28` contains `as unknown as SupabaseClient`.
- The PostgREST token (`common/db/db-token.ts:40-48`) carries `role`, `sub`, `email` and `session_id`, but **no org claim**. The service token is `{role: service_role}`.
- The Auth0 verifier (`modules/auth/auth0-token-verifier.ts:53-70`) checks iss, aud and RS256, and requires `sid` (`identity.service.ts:44`).
- The idle timeout is DB-backed in `user_session_activity` (migration 901), written through the privileged client (`common/session/session-activity.service.ts:94-99`). It has **no 12-hour absolute limit**.
- Identity linking happens in `link_identity(p_provider='auth0', p_sub, p_email, p_verified)` (`migrations/931_identity_functions.sql`). It is keyed on **(provider, sub)** in `auth.external_identities`; **iss is not stored**. The email fallback uses `lower()`, not NFKC, and produces no ambiguity report.

### 1.4 Organization context and `auth.uid()`

- `common/guards/organization-context.guard.ts`:
  - reads active `organization_members` rows with the **privileged** client (`:42`);
  - reads header **`X-Organization-Id`** (`:61`);
  - is applied per route: 29 `@UseGuards` sites in 18 controllers;
  - its result flows into `RequestAuth` through `request-auth.interceptor.ts:29`, then to 35 `@CurrentOrganization` uses and the optional filter in `base.repository.ts:136,149`.
- The frontend **never sends** an org header (0 hits).
- `current_user_org_ids()`:
  - is never used in TypeScript;
  - is defined once in SQL, `migrations/541:20` (SECURITY DEFINER, **no search_path**), and returns *all* active memberships;
  - is referenced by 175 policy statements.
- `auth.uid()`:
  - appears in TypeScript only in comments;
  - is relied on structurally by about 236 `getUserClient(` and about 394 `.getClient(` sites;
  - is referenced by 407 policy statements;
  - is defined in `930_postgres_compat.sql:63-67` **only if missing**, reading `request.jwt.claims`.

### 1.5 Schema (`backend/migrations` and the other trees)

**Trees:**

| Tree | Files |
|---|---|
| `backend/migrations` | 789 top-level `.sql`, plus 58 in `calculators/` that the runner never applies |
| `backend/database/migrations` | 96 |
| `backend/src/database/migrations` | 46 |

- 43 numeric prefixes are duplicated.
- The runner (`scripts/migrate.ts`, `src/common/migrations/migration-plan.ts`) tracks `schema_migrations`. It treats everything up to 917, plus `999_*`, as baseline (`migrations/BASELINE.json`).
- The runner refuses a pending file that sorts before the last applied one (`migration-plan.ts:69`).

**RLS:**
- 180 live tables; **26 have no RLS**:
  - delivery: `carriers`, `delivery_tracking`, `delivery_invoice_items`, `delivery_documents` (`200_*:41,174,236,256`);
  - QC: `detailed_inspection_reports` (unnumbered file, never applied);
  - `user_sessions` (029);
  - CAD cache ×2 (076);
  - materials ×5 (080);
  - reference ×4 (361, 363, 364, 604);
  - 8 `*_backup_*` tables.
- `FORCE ROW LEVEL SECURITY`: **0**.
- `CREATE POLICY`: 640 statements (the design doc says 648).

**SECURITY DEFINER functions: 49 live.**
- 21 pin `search_path`.
- **28 do not.** All 28 are still executable by `authenticated`, because `921_security_hardening.sql:73-75` re-grants `authenticated` before revoking PUBLIC.
- The 28 include `current_user_org_ids` and the four **delivery** functions: `create_delivery_order_transaction` (202), `update_delivery_order_status_bulk`, `calculate_delivery_metrics` and `generate_delivery_report` (203).
- QC-adjacent: `review_pmi_record` (908).

**Views: 30 live.**
- Only 2 use `security_invoker`: `vendor_rating_aggregates` and `vendor_summary` (620).
- The delivery views have no `security_invoker`: `delivery_ready_items` (201:180) and the materialized views `delivery_performance_metrics` (200:271) and `delivery_quality_metrics` (201:201).
- The `kpi.*` views (933) run with owner rights by design.

**QC core tables are missing from the applied tree.** `quality_inspections`, `quality_inspection_results` and `quality_non_conformances` exist only in `backend/database/migrations/141`. The live schema is known only from production.

`backend/docs/delivery-quality-tenant-isolation-design.md` exists (M1–M5 rollout, open decisions D1–D4). Parts of it are stale: it says the repo ends at 843, and it lists a `supabase/migrations` folder that no longer exists.

### 1.6 Jobs, cad-runner and CAD engine

**Two queues today:**
- `cad_uploads`, claimed by `claim_next_cad_upload` (917, SKIP LOCKED);
- `job_queue` (920), used by electronics `TableJobQueue` (`electronics-costing/infrastructure/queue/table-job-queue.adapter.ts:29`).

**Runner (`core/crates/runner`):**
- It is **tenant-blind**: it claims across all organizations (`backend.rs:163-182`).
- It signs its own `service_role` token from `DB_JWT_SECRET` (`token.rs:15-34`) and uses static `S3_*` keys (`main.rs:71-93`).
- Its work directory is `tempdir()` under `/tmp`, which is tmpfs in prod (`docker-compose.prod.yml:243`). The directory is dropped at the end of `process()`.

**CAD engine:**
- It writes uploads to `TEMP_DIR=/tmp/cad-files`, which is the **named volume `cad-temp`**, i.e. persistent disk (`docker-compose.prod.yml:167-168,188-192`).
- It logs client file names at INFO (`cad-engine/main.py:343,362,384,…`).
- It keeps `logs/error.log` for 15 days (`main.py:66-81`).
- It sets no `ulimit -c`.

**AI calls bypass any gateway:** `app/api/vave/*` (4 routes) call Anthropic directly from Next, and the cad-engine copilot and drawing routers call model providers too.

### 1.7 Disagreements between code and docs (reported, not resolved)

| # | Docs say | Code says |
|---|---|---|
| D1 | 1,783 backend tests (Design 18.3, prompt §3) | 2,841 tests / 226 suites; root 653 (issue register says 254) |
| D2 | 177 privileged calls (Design 2.2) | 158 (inventory doc: 128) |
| D3 | Header `X-Org-Id` (Design 6.4, prompt) | `X-Organization-Id`, and the frontend never sends it |
| D4 | Identity unique on `(iss, sub)` (Design 6.1, PRD 11.3) | `(provider='auth0', sub)`; no iss column (931) |
| D5 | "Redefine helpers; the 648 policies keep working unchanged" (Design 8.2) | `current_user_org_ids()` returns *all* memberships. Redefining it to `app.org_id` narrows it to one org and **returns nothing on the PostgREST bridge path**, which never sets `app.org_id`. A fallback is needed (see P2-07). `auth.uid()` in 930 is create-if-missing only |
| D6 | Browser queries move in phase 2 (Design 17) | Under `AUTH_BACKEND=auth0` the browser has no Supabase session. `lib/api/organization.ts:126-127` returns `null`, and exchange rates, avatar, the QC page token and the process-plan SSE token all fail. **These are cutover blockers.** `CUTOVER_AUTH0_POSTGRES.md` "Still open" lists only avatar and DeliveryTracking |
| D7 | "Browser never talks to storage" (CUTOVER §0) | Avatar upload is a direct browser upload (`settings/page.tsx:308`) |
| D8 | Electronics uses a pg-boss adapter (ENGINEERING.md:19) | `TableJobQueue` on `job_queue` (920); pg-boss appears only in a boundary spec |
| D9 | `.github/workflows/security.yml:40`: historical findings "were rotated" | Issue register EA-001/EA-003: rotation **BLOCKED / unverified** |
| D10 | Migration counts: 792 files, 648 policies, "96 in a second tree" | 789 top-level `.sql` plus 58 never applied; 640 policies; the third tree (46) is missing from Design 2.2 |
| D11 | Design 18.1: "ESLint no-restricted-imports" | CI does not run lint (44k diagnostics, EA-011). This plan uses scripts in the style of `check:rls` |
| D12 | Squash to `0000_baseline.sql` | A partial baseline concept already exists (`BASELINE.json`, up to 917). The `migration-plan.ts:69` ordering rule needs a baseline marker, not a pending file |
| D13 | Auth0 sessions 30 min idle / 12 h absolute | SDK defaults are 1 day / 3 days. Idle is enforced only by the backend, and nothing enforces the absolute limit |

## 2. Risks found in the code that the docs do not cover (ranked)

1. **Cutover breaks browser data paths** (D6). Organization admin, workspaces, exchange rates, avatar, QC detail and process-plan streaming all fail under Auth0. → Phase-1 blockers P1-01…P1-04.
2. **The Next server holds the Supabase service key.** `lib/api/delivery-tracking.ts` uses `supabaseAdmin` for `app/api/delivery/*`. This privileged path is outside NestJS and outside `check:rls`. → P1-04.
3. **28 SECURITY DEFINER functions** have no pinned `search_path` and are callable by every signed-in user. They include `current_user_org_ids` and four delivery functions (`921:73-75`). → P2-11.
4. **Data-promise violations on CAD workers.** The cad-engine temp dir is on a persistent volume, file names are logged at INFO, error logs are kept 15 days, and core dumps are not disabled. → P3-04.
5. **Access token in a URL** (`useProcessPlanGenerate.ts:325-330`, `?token=`). It ends up in proxy, access and trace logs. → P0-06.
6. **QC core tables are absent from the applied migration tree.** Fresh databases (test:sql, local-data, future dedicated tenants) cannot build them. The baseline must come from a production dump. → P0-10.
7. **Multi-step writes with compensating deletes** in delivery and QC (`delivery.service.ts:169→247`, `invoice.service.ts:59→89`, `quality-inspection.service.ts:377-387`) leave partial rows when they fail. → P2-15/16, using transactions.
8. **Unauthenticated Next routes**, including `balloon-annotations`, whose in-memory Map is shared across users and tenants. → P0-07.
9. **The cad-runner is tenant-blind** and holds service_role-equivalent and static S3 credentials. → P3-02/P3-05.
10. **The `pg`/Kysely ban in `check:rls`** would block the platform layer. → P0-02 adds a `src/platform/db/**` exemption.
11. **production-planning has no tests.** It has 192 call sites, 55 writes and 0 specs, making it the riskiest port. → Contract tests first (phase 4, late).
12. **AI ai_mode cannot be enforced** while Next VAVE routes and cad-engine routers call providers directly. → P3-09.
13. **Bugs:** `Bearer null` (`bom.ts:206`, `download-bom-item-excel.ts:21`), the localStorage token (`rfq/page.tsx:104`) and EA-015 (RFQ attachments by storage path). → P0-06 and a separate fix.

## 3. PR breakdown

Columns:
- **Flag / compat:** how the PR stays safe when merged.
- **Rollback:** how to undo it.
- **Est:** S is under 150 changed lines, M is 150–400, L must be split during execution.

**Dependency rule:** a PR depends only on PRs in its own tier or an earlier tier. The parallel track never blocks G1.

### Tier 1: Cutover blockers (do now; gates G1, then PNR)

| ID | Title | Why | Files touched | Tests | Flag / compat | Rollback | Est | Depends |
|---|---|---|---|---|---|---|---|---|
| P0-01 | **Done** (`c39745e8`): frontend DB-import boundary check | PRD 13 CI rule; stops new browser DB paths | `scripts/check-frontend-boundary.ts`, `scripts/frontend-boundary-allowlist.json`, `package.json`, `.github/workflows/ci.yml` | `test/scripts/check-frontend-boundary.test.ts` (13) | Ratchet: 17 files allow-listed | Revert; CI only | S | – |
| P0-02 | **Done** (`c23dda93`): privileged-call ratchet and platform DB exemption | Drift 128→156 went unnoticed; Kysely allowed only in the platform layer | `backend/scripts/{rls-bypass-rules,check-rls-bypass}.js`, `backend/scripts/rls-bypass-baseline.json`, `backend/docs/rls-bypass-inventory.md` | `src/test/scripts/rls-bypass-rules.spec.ts` (+11 cases) | Baseline 156; increases and stale entries both fail | Revert; CI only | S | – |
| P0-03 | BFF route handler `/api/v1/*` | Design 6, ADR-003: the browser calls same-origin and the server attaches the token | `app/api/v1/[...path]/route.ts`, `lib/server/bff/{forward,origin,access-token}.ts`, `lib/config.ts`, `lib/api/client.ts` | `test/app/api/bff-route.test.ts`, `test/lib/server/bff/*.test.ts`, `test/lib/api/client-bff.test.ts` | `NEXT_PUBLIC_BFF=on` (build time), default off; works with both auth backends | Rebuild with the flag off | M | – |
| P0-06 | Remove browser token handling | ADR-003: no tokens in JS | as v1: `session-source.ts`, `client.ts`, `BOMItemDetailPanel.tsx`, `session-idle/browser.ts`, `auth0-auth-provider.tsx`, `bom.ts:206`, `download-bom-item-excel.ts`, `rfq/page.tsx:104`, `useProcessPlanGenerate.ts`, `lib/auth0.ts` (`enableAccessTokenEndpoint:false`) | "No token reachable from JS" test; `Bearer null` regression tests | Code paths gated by `NEXT_PUBLIC_BFF` | Flag off | M (split a/b if over 400 lines) | P0-03 |
| P0-07 | Authenticate the unauthenticated Next routes | Risk 8 | `app/api/balloon-annotations`, `extract-inspection-table`, `route-calculation*` | 401 without a session; annotations keyed per user | none (security fix) | Revert | S | – |
| P0-08 | Server-side session store | Design 6.3, PRD 11.3 | `bff/session-store/{postgres-session-store,crypto,pool}.ts`; `backend/migrations/control/0001_sessions.sql`; `scripts/migrate.ts --target control`; `lib/auth0.ts` (`sessionStore`, rolling, `inactivityDuration:1800`, `absoluteDuration:43200`); P0-01 check scans `bff/` and allows `pg` only there | Testcontainers: idle expiry, absolute expiry, last_activity throttled to 60 s, refresh token never plaintext, refresh reuse → revoked, `deleteByLogoutToken`; boundary test: `pg` in `bff/` ok, in `lib/` fails | `AUTH_SESSION_STORE=db`, only with `AUTH_BACKEND=auth0` | Unset the flag (SDK cookie session) | M | P0-03 |
| P0-09 | Sign-out everywhere and back-channel logout | PRD 11.3 | `app/auth/logout-everywhere/route.ts`, back-channel endpoint, Auth0 config doc | Route tests | `AUTH_SESSION_STORE=db` | Flag off | S | P0-08 |
| P0-19 | Owner checklist: rotate secrets | G1 | `docs/ops/secret-rotation-checklist.md`; fix the comment at `security.yml:40` | none | Doc only | Revert | S | – |
| P0-20 | Docs correction | D1, D2, D3, D10, D13; identity key | PRD and Design Doc (Word files and Markdown copies): test counts, privileged-call count, `X-Organization-Id`, migration counts, session lifetimes, `(provider, sub)` → `(iss, sub)` migration note, Design 15 CSRF row (Origin check, not a token). The round-trip budget, pool settings, revocation and availability are already corrected by the 30 Oct review | none | Docs only | Revert | S | – |
| P0-21 | **Started** (31 Oct, PR #45): harness + 6 sheet-metal cost-summary cases; other families to add. Costing golden-snapshot harness | Costing outputs must stay byte-identical (hard constraint); there is no golden test today | `backend/src/test/golden/{golden.spec.ts,cases/*.json,__snapshots__}`; runs the costing services for fixed inputs and compares serialised output byte for byte | itself; a deliberate one-cent change fails it | Test only | Revert | M | Q14 (fixture source) |
| P1-00 | Stage and Auth0 tenant checklist | CUTOVER §0 | `docs/ops/stage-auth0-checklist.md`: every §0 item with an owner and evidence | none | Doc | – | S | – |
| P1-01 | Organizations, members and workspaces behind NestJS | D6 blocker | `backend/src/modules/organizations/*` (zod at the edge), `lib/api/organization.ts` → `apiClient`, which sends `X-Organization-Id`; NestJS checks for an active membership on every request | Contract tests with two orgs; tampered `X-Organization-Id` → 403; hook tests | Works under both auth backends | Revert the frontend file | M | P0-03 |
| P1-02 | Exchange rates and QC page through the API | D6 | `useExchangeRates.ts`, QC page → `apiClient` | Hook tests | as above | Revert | S | P0-06 |
| P1-03 | Avatar upload through `ObjectStore` | D7 | `backend/src/modules/profile/avatar.*`, `settings/page.tsx` | Size and type tests; S3 smoke test | none | Revert | S | – |
| P1-04 | Delivery Next routes → NestJS; DeliveryTracking polling | Risks 1–2 | `app/api/delivery/*` → BFF; delete `lib/api/delivery-tracking.ts`; `DeliveryTracking.tsx` polls every 10 s | Route tests; `SUPABASE_SERVICE_KEY` absent from the Next env schema | none | Revert | M | P0-03 |
| P1-05 | Identity key `(iss, sub)` | D4, PRD 11.3 | as v1 (`934_identity_iss.sql`, `link_identity_v2`, verifier exposes `iss`) | `test:sql` identity tests | Old function kept one release | Redeploy previous | M | – |
| P1-06 | Legacy link by normalised email, with ambiguity report | PRD 11.3 | as v1 (`935_*`, `identity-link-report.ts`) | as v1 | Additive | Revert function | M | P1-05 |
| P1-07 | Invitations: schema and accept function | Design 6.2 | as v1 (`936_invitations.sql`) | as v1 | Additive | Revert | M | P1-05 |
| P1-08 | Invitations: API and UI | Design 6.2 | `modules/invitations/*`, email template (link only), accept page | Contract tests; "different email" message | `INVITATIONS=on` | Flag off | M | P1-07 |
| P1-09 | Write-freeze flag | PRD 12.1 | as v1 | as v1 | `WRITE_FREEZE=on` | Flag off | S | – |
| P1-10 | Cutover verification script and runbook | PRD 12.2 | as v1; the runbook's rollback branch says "roll back only if no customer writes; otherwise forward-fix" (no replay script) | Run on stage; drill report | Doc and script | n/a | M | P1-05…P1-09, P1-16 |
| P1-11 | Stage cutover and rollback drill | PNR evidence | drill report | Drill report | Flags | Flip flags back | S | P1-10 |
| P1-12 | PNR checklist | PRD 12.1 | `docs/ops/pnr-checklist.md` | – | Doc | – | S | P1-11 |
| P1-14 | **Done** (`5b23ad00`, `05683e21`; register updated 31 Oct): EA-015: RFQ attachments by storage path | Bug | RFQ attachment resolution through the owning record, not a client-supplied path | Test: another org's path → 403 | none | Revert | S | – |
| P1-15 | **Partly done** (31 Oct): dead portal link removed; CAD attachments kept until P2-26 by owner decision. No CAD as email attachments; fix the dead portal link | Design 7.5; RFQ emails attach drawings and CAD (`rfq-email.service.ts:105,473`) and link to `/vendor-portal/rfq/:id`, which no route serves | `rfq-email.service.ts` (link only), an interim page saying the OEM will share the files | No attachment in any RFQ email; every emailed link resolves to an existing route | none | Revert | S | – |
| P1-16 | HA Postgres for the pooled and control-plane databases | Design 16.1, 16.4 | `infra/terraform/platform-db/` (multi-AZ, PITR, cross-region backup copies), `docs/ops/failover-test.md` | Failover test with its measured time (under 5 min) | Infrastructure | Previous instance kept until verified | S | – |

### Parallel track (never blocks G1)

| ID | Title | Why | Files touched | Tests | Flag / compat | Rollback | Est | Depends |
|---|---|---|---|---|---|---|---|---|
| P0-04 | Allow-listed logger and log canary | Design 10.2/14; PRD 13 | as v1 | `log-canary.spec.ts` | Additive | Revert wiring | M | – |
| P0-05 | Logger lint ratchet | No new non-allow-listed fields | as v1 | spec cases | Baseline ratchet | Revert | S | P0-04 |
| P0-12 | **Dropped** (30 Oct): the 5 "duplicate" `backend/data` files are not duplicates | Checksums show 4 of the 5 are the only copy of their data (`00_MASTER_Plastic_FULL (1).xlsx`, `VENDOR_DATABASE_ENTERPRISE_ENRICHED (1).xlsx`, `Combined_All_Countries_Database_fixed - Copy.xlsx`, `MHR_LHR_India_2026_Abushan.xlsx`); the fifth matches a file in `memory/` only. Deleting them would change reference data (hard constraint) | – | – | – | – | – | – |
| P0-13 | **Done** (`f3c4802e`): stop tracking `backend/eng.traineddata` | It is tesseract.js's runtime download cache, not an input; the runtime image never contained it | `backend/eng.traineddata` (deleted), `.gitignore` (`*.traineddata`) | Backend suite | none | Revert | S | – |
| P0-13b | Pin OCR language data at image build with a checksum | No runtime download from a CDN | `backend/Dockerfile`, checksum file, `langPath` in `pdf-processor.service.ts` | OCR spec; image build in CI | none | Revert | S | P0-13 |
| P0-14 | **Done** (`adafed07`): remove `@nestjs/typeorm` | Unused | `backend/package.json`, lockfile | clean `npm ci`, build, suite, `check:rls`, `test:boot` | none | Revert | S | – |
| P0-15 | One observability stack | Design 19 | as v1 | as v1 | none | Revert | S | – |
| P0-16 | One compose file with profiles | Dev file points at a missing Dockerfile | as v1 | `docker compose config` per profile | Profiles keep the old names | Revert | M | P0-15 |
| P0-17 | One env template plus overrides | Drift across 3 templates | as v1 | Env-validator test | none | Revert | S | – |
| P0-18 | Root ESLint ignores build output; no-new-errors ratchet | Design 19 | as v1 | Ratchet test | Baseline count | Revert | S | – |

### Tier 2: After PNR (gate G2)

Order: P0-10 and P0-11 first, then P1-13, then the P2 PRs in dependency order.

| ID | Title | Why | Files touched | Tests | Flag / compat | Rollback | Est | Depends |
|---|---|---|---|---|---|---|---|---|
| P0-10 | Baseline generation and schema-diff tool | Design 17.1 | as v1; input is the owner's `prod_schema.sql` | as v1 | Existing DBs: marker only | Revert | M | PNR, `prod_schema.sql` |
| P0-11 | Delete old migration trees (tag `pre-squash`) | Design 17.1, 19 | as v1 | `test:sql`, `test:baseline`; empty diff attached | Only after an empty P0-10 report | `git revert` / tag | S | P0-10 |
| P1-13 | Delete frontend Supabase code | Design 19 | as v1 | Root suite; P0-01 allow-list empty | After PNR | Revert | M | PNR |
| P2-01 | Kysely platform layer, pools and codegen | ADR-005 | `backend/src/platform/db/{pools,kysely,types.generated}.ts`; pool settings: min 1 per active tenant, idle 5 min, max lifetime 30 min ± 10% jitter | Codegen drift test; Testcontainers smoke; jitter spread test | Unused until P2-04 | Revert | M | P0-02 |
| P2-02 | Control-plane tables | Design 7.1 | `migrations/control/0002_*.sql` (adds to P0-08's `emithran_control`) | `test:sql` control target | Additive | Revert | M | P0-08 |
| P2-03 | Control-plane memberships: backfill, single writer, parity | One source of truth | `backend/scripts/control-backfill.ts` (idempotent, one-time); organizations module writes only the control plane; nightly `membership-parity` job reports ids only; tenant `organization_members` becomes read-only legacy data, used only while `app.legacy_org_fallback = on` | Backfill run twice gives the same result; parity mismatch reported; tenant writes rejected | `CONTROL_PLANE_MEMBERSHIPS=on` | Flag off (tenant table still holds the pre-switch state) | M | P2-02, P1-01 |
| P2-04 | `withTenant`, `withSystem`, system-caller allow-list | Design 9, 18.1 | `platform/db/{with-tenant,with-system,system-callers}.ts`; BEGIN and both `set_config` calls as one simple-protocol statement after UUID validation; `check:rls` rule for `withSystem` | Testcontainers: settings never leak to the next checkout, rollback on throw, missing context → throws, non-UUID → throws before any SQL, **one round trip** for begin plus settings | Additive | Revert | M | P2-01 |
| P2-05 | TenantRegistry (15 s cache plus NOTIFY eviction) | Design 7.3 | as v1 | as v1 | Additive | Revert | M | P2-02 |
| P2-06 | Auth0 Organizations and org switch | Design 6.4 | as v1 | as v1 | `AUTH0_ORGS=on` | Flag off | M | P0-08, P2-02 |
| P2-07 | TenantGuard, shadow then enforce | Design 7.2 | as v1 | as v1 | `TENANT_GUARD=off\|shadow\|enforce` | Back to shadow/off | M | P2-05, P2-06 |
| P2-08 | Redefine `auth.uid()` and `current_user_org_ids()` | Design 8.2, D5 | as v1 | as v1 | `app.legacy_org_fallback` | Set back to `on` | S | P2-07 |
| P2-09 | Roles | Design 8.1 | as v1 | Catalog check 2 | PostgREST roles untouched | Revert grants | M | P0-11 |
| P2-10 | FORCE RLS everywhere; RLS on the 26 tables; global allow-list | Design 8.2 | migration; `ci.global_tables`. Documented rule: once forced, a backfill run as the table owner is filtered, so backfills run as `migrator` (BYPASSRLS) or with tenant settings set | Catalog check 1; `test:sql`: a backfill on a forced table updates 0 rows as owner and all rows as `migrator` | 3 PRs by table group if over 400 lines | `NO FORCE` | M×3 | P2-09, P2-24 |
| P2-11 | SECURITY DEFINER audit | Risk 3 | as v1 | Catalog checks 3, 4 | Listed callers unchanged | Revert | M | P2-09 |
| P2-12 | Views `security_invoker`; drop delivery materialised views | Design 8.2 | as v1 | as v1 | – | Revert | M | P2-10 |
| P2-13 | Catalog checks in CI | G2 | as v1 | itself | – | – | S | P2-10…P2-12 |
| P2-14 | Delivery/QC M1–M3: `organization_id`, backfill, constraints | EA-002 | migrations per `delivery-quality-tenant-isolation-design.md`; unattributable rows go to P2-25's quarantine | Backfill tests including unattributable rows | Additive columns | Revert | M | P2-25 |
| P2-15 | Port delivery to Kysely (contract tests first) | EA-002, risk 7 | as v1 | as v1 | `DELIVERY_DATA=postgrest\|kysely` | Flag | L → 2 PRs | P2-04, P2-14, P0-21 |
| P2-16 | Port quality-control (contract tests first) | EA-002 | as v1 | as v1 | `QC_DATA=…` | Flag | L → 2 PRs | P2-15 |
| P2-17 | SSE over LISTEN/NOTIFY | ADR-010 | as v1 | as v1 | `LIVE_EVENTS=sse\|poll` | Back to polling | M | P2-07 |
| P2-18 | Isolation test matrix | G2 | as v1, plus the guest rows of Design 8.4 | the matrix | – | – | M | P2-10…P2-13 |
| P2-19 | Retire `user_session_activity` idle path | Single session authority | as v1 | session suites | After `AUTH_SESSION_STORE=db` in prod | Revert | S | P0-08 |
| P2-20 | Rate limits | Design 12 | global NestJS guard: 600 requests/min/user, 30 uploads/hour/user; 429 with `Retry-After`; counters in the control DB (no Redis) | 601st request → 429 with `Retry-After`; window resets | `RATE_LIMITS=on` | Flag off | S | P2-02 |
| P2-21 | Organization export and deletion | PRD F9, 11.5 | `modules/org-lifecycle/*`: export (SQL + CSV + files under the org prefix) through `withTenant`; deletion with audit event and certificate | Pooled export contains only the requested org (two-org fixture); deletion audited | `ORG_LIFECYCLE=on` | Flag off | M | P2-04, P2-22 |
| P2-22 | Audit event writer | PRD 11.4 | `platform/audit/audit-writer.ts` → control `audit_events`, ids only; events: sign-in, role change, org switch, export, deletion, privileged job, registry change, support access, guest grant | Each event emitted once; canary payload absent | Additive | Revert | S | P2-02 |
| P2-23 | k6 load-test harness | PRD 8.3; G4 evidence | `load/k6/*`: 50 users, 20,000 BOM items, 30 min steady state, CRUD only; reports p50/p95/p99 as server time at the BFF in region; user-perceived latency per user region reported separately; cross-region run (800 ms) only when a contract needs it | The run itself | Test only | – | M | P2-04 |
| P2-24 | Backup tables: export, verify, drop | Q9 decision | `backend/scripts/export-backup-tables.ts` (to cold storage, row counts verified), then a drop migration | Row-count report attached; drop migration in `test:sql` | Export before drop | Restore from the export | S | – |
| P2-25 | Delivery/QC quarantine | Decision 6 | quarantine table **in the tenant database**; control plane stores ids and approval status only; release endpoint requires owner approval; no automatic assignment, no deletion | Unattributable row → quarantined; release without approval refused; audited | Additive | Revert | M | P2-02 |
| P2-26 | Guest supplier access (Design 7.5, PRD F11) | Supplier collaboration for pilots | 3 PRs: (a) control `guest_grants` and resolver branch; (b) RFQ-scoped API, signed URLs, quote submit; (c) invite and quote UI, Auth0 passwordless | Guest rows of Design 8.4; grant expiry and revoke; audit events | `GUEST_SUPPLIERS=on` | Flag off | L → 3 PRs | P2-07, P2-22, P1-15 |
| P2-27 | Tenant function ratchet | Design 3.2: keep IP out of tenant databases | `backend/scripts/check-tenant-functions.js`, `ci/tenant-functions.json` seeded with today's functions; a new function not on the list fails; stale entries fail | spec cases | Ratchet | Revert; CI only | S | P0-10 |

### Tier 3: Only on trigger (gates G3 and G4 for that tenant)

**Trigger:** a signed pilot or LOI that requires a client-owned data plane, or a tenant using a non-default `ai_mode`. P3-09 alone is triggered by the second condition; P3-15 only by the first EU client.

| ID | Title | Why | Files touched | Tests | Flag / compat | Rollback | Est | Depends |
|---|---|---|---|---|---|---|---|---|
| P3-01 | Secret-store port (AWS Secrets Manager + KMS) | Credentials never in env or DB; Design 16.5 | `platform/secrets/{secret-store,aws-secrets-manager}.ts`; in-memory cache with stale-if-error up to 24 h; health checks never call the store; A/B credential rotation; replication to the DR region; alert on any error | Adapter contract test; store outage → cached value served; rotation failure leaves the old user working | – | – | M | – |
| P3-02 | DataPlaneRouter for dedicated tenants | Design 12 | `platform/db/data-plane-router.ts`: max 4 per replica, min 1 while active, idle 5 min, max lifetime 30 min ± 10% jitter, LRU 50; metrics | Testcontainers: budget, LRU close, suspension ends the pool | `tenants.kind='dedicated'` | Suspend tenant | M | P2-05, P3-01 |
| P3-03 | Per-tenant ObjectStore with STS (API only) | Design 7.4 | as v1 | as v1 | per tenant | – | M | P3-01 |
| P3-04 | Worker data handling | Risk 4 | as v1 | as v1 | stricter | Revert compose | M | P0-04 |
| P3-05 | Control-plane `jobs` and the runner's internal API | Design 11; option (a) | `platform/jobs/*`; claim SQL with per-tenant cap 2 and key `tenant:upload:kind`; internal endpoints: claim, presigned URLs, results; API re-verifies on every call | Replay with a changed tenant id rejected; duplicate submit collapses | `JOBS_BACKEND=control` | Flag | L → 3 PRs (schema, API, enqueue) | P2-02 |
| P3-06 | Runner on the internal API | Risk 9; option (a) | `core/crates/runner/src/*`: remove DB client, `token.rs` and static `S3_*` keys; call internal API only | Rust tests; e2e; runner env holds no DB, S3 or JWT secret | `JOBS_BACKEND` | Flag | M | P3-05 |
| P3-07 | Two file modes | Design 10.1 | as v1 | as v1 | `tenants.file_mode` | per tenant | M | P3-03 |
| P3-08 | Revocation script, paths and drill | Design 7.4, PRD 8.3 | `docs/ops/revocation-drill.md`, client revocation script (privilege revoke + `pg_terminate_backend` of eMithran sessions), audited suspend endpoint | Drill: suspension → no new operation within 60 s; script or privilege revoke → immediate; password change alone → within 30 min; links expire within 5 min | – | – | S | P3-02, P3-03 |
| P3-09 | AI gateway (`tenants.ai_mode`) | Design 13 | as v1 | as v1 | default `off` | Mode change | L → per caller | P2-07 |
| P3-10 | Fleet migrator | Design 17.2 | as v1 | as v1 | – | – | M | P2-02, P0-10 |
| P3-11 | Reference data from the control plane | Design 3.2 | as v1 | Golden snapshot (P0-21) byte-identical | `REFERENCE_SOURCE=tenant\|control` | Flag | L → per lookup service | P2-04, P0-21 |
| P3-12 | Onboarding runbook and Terraform outline | Design 16.2 | as v1 | `terraform validate` | – | – | S | – |
| P3-13 | Move proprietary SQL out of tenant migrations | Design 3.2 | per function group: cost aggregation, nomination scoring, vendor rating, calculator seed rows → TypeScript or control-plane reference data; first check whether production holds the rows of the 58 never-applied `calculators/` files | Golden snapshot byte-identical; P2-27 list shrinks | per-group flag | Flag | L → per group | P0-21, P2-27, P3-11 |
| P3-14 | Migration delivery as a reviewed SQL bundle | Design 16.2 | `backend/scripts/fleet-migrate.ts --bundle` writes an ordered SQL file plus its expected `schema_version`; the catalog checks verify the result | Bundle applied to an empty DB equals the migrator's result | – | – | S | P3-10, P2-27 |
| P3-15 | Frankfurt compute cell (on trigger: first EU client) | Design 16.1 | Terraform outline only until the trigger | `terraform validate` | – | – | S | P3-12 |

### Phase 4: Finish the port

Before writing contract tests:
- Check 30 days of route usage for `supplier-nominations`, `projects` and `production-planning`. Put unused modules behind a flag and port them last, or propose removing them.
- `lhr`, `mhr` and `calculators` feed costing. Check their usage too, but never freeze them; port them behind the golden snapshot (P0-21).

Each module is a PR pair: contract tests first, then the port behind `<MODULE>_DATA=postgrest|kysely`. The PostgREST path is removed one release later. All pairs depend on P2-04 and P0-21.

| Order | Modules | Reason |
|---|---|---|
| A | boms, cad-uploads, profile, projects | Small, mostly single-table |
| B | delivery, quality-control (P2-15, P2-16) | EA-002 |
| C | tooling-costs, packaging-logistics, procured-parts, child-parts, process-planning, benchmark-sessions, project-reports, supplier-evaluation, supplier-evaluation-groups, mhr, lhr, raw-materials, calculators, rfq, copilot, manufacturing-intelligence, manufacturing-knowledge, manufacturing-rules, costing, cost-engineering, developer, health | Fewer than 35 calls each |
| D | vendors, vave, process-routes, should-cost, electronics-costing, processes, process-plan-generator, supplier-nominations, production-planning | Large and write-heavy; transactions; heavy contract coverage |
| E | bom-items | Costing-critical; its reference lookups move in P3-11 first |

Deletions follow, one PR each: P4-D1 (PostgREST client and compose service), P4-D2 (`common/supabase/*` and `getPrivilegedClient`), P4-D3 (Supabase object store and runner backend), P4-D4 (the three backend flags), P4-D5 (`@supabase/*` packages; both allow-lists empty).

## 4. Gate checklists

**G1 Security (Tier 1)**
- [ ] Every secret in the rotation checklist is rotated, and the old value is proven rejected. Evidence: the signed checklist (P0-19).
- [ ] gitleaks is clean on new commits. Evidence: `security.yml` run id.
- [ ] No critical dependency issue is reachable at runtime. Evidence: `npm audit --omit=dev` in both packages and a Trivy run id.
- [ ] Boundary checks are active. Evidence: CI shows `check:boundary` and `check:rls` with the ratchet.
- [ ] No token is reachable from JS. Evidence: the P0-06 test, and `/auth/access-token` returns 404 on stage.
- [ ] Sessions meet 30 min idle and 12 h absolute. Evidence: P0-08 Testcontainers run on stage.

**PNR (end of Tier 1)**
- [ ] Row parity, file parity, every active user linked, 14-day soak with no Sev-1 or Sev-2, cutover and rollback drill done, written sign-off. Same as v1.
- [ ] Restore drill on the new database meets RTO under 2 h for a database under 100 GB. Evidence: `restore-check.sh` report.
- [ ] HA failover test on the pooled and control-plane databases completes in under 5 min. Evidence: P1-16 report.
- [ ] No CAD file leaves by email. Evidence: P1-15 test.

**G2 Isolation (Tier 2)**
- [ ] Baseline squash verified. Evidence: an empty `schema-diff.sh` report and the `pre-squash` tag.
- [ ] The 5 catalog checks return 0 rows.
- [ ] Isolation matrix green, including the guest rows.
- [ ] `TENANT_GUARD=enforce` in prod after a 7-day shadow log with 0 mismatches.
- [ ] `app.legacy_org_fallback = off` in prod.
- [ ] Delivery/QC privileged calls = 0. Evidence: `check:rls` baseline.
- [ ] Logger and log canary active. Evidence: P0-04 and P0-05 in CI.
- [ ] Tenant function ratchet active. Evidence: P2-27 in CI.
- [ ] Rate limits, the audit writer and org export are live. Evidence: P2-20, P2-22 and P2-21 tests.

**G3 Migration (Tier 3, per dedicated tenant)**: same as v1. The client chooses the migrator or the SQL bundle (P3-14).

**G4 Operations (Tier 3, per dedicated tenant)**: v1 items, with these changes:
- [ ] Revocation drill (P3-08): suspension within 60 s; script or privilege revoke immediate; password change alone within 30 min; links within 5 min.
- [ ] Pool and job budgets load-tested. Evidence: P2-23 k6 report, server time in region.
- [ ] Failover test under 5 min for the control plane, with the dedicated tenant attached.
- [ ] Error-budget policy published in `docs/ops/error-budget.md`.
- [ ] Secret-store outage drill: traffic continues on cached credentials. Evidence: P3-01 test.

**Phase-4 exit**: same as v1.

## 5. First three PRs

### P0-01: done (`c39745e8`, branch `feat/p0-01-frontend-boundary`)

How it differs from v1:
- The script is TypeScript, using TypeScript's `preProcessFile` instead of regexes, so comments and strings are ignored and every import form is caught.
- Stale allow-list entries fail.
- 13 tests.

### P0-02: done (`c23dda93`, branch `feat/p0-02-privileged-ratchet`)

How it differs from v1:
- The baseline is 156.
- A decrease **fails** until `--update-baseline` is run (v1 said warn). This matches P0-01's rule that lists can only shrink.

### P0-03: BFF route handler (next)

Branch `feat/p0-03-bff-route`. Flag `NEXT_PUBLIC_BFF`, set at build time, default off.

**Files:**
- `app/api/v1/[...path]/route.ts`: exports `GET POST PUT PATCH DELETE`, with the Node.js runtime.
- `lib/server/bff/access-token.ts`:
  ```ts
  export async function serverAccessToken(): Promise<string | null>
  ```
- `lib/server/bff/origin.ts`:
  ```ts
  /** Unsafe methods must come from the app's own origin; SameSite=Lax cookies cover the rest. */
  export function isAllowedOrigin(req: Request, appOrigin: string): boolean
  ```
  - Safe methods (GET, HEAD, OPTIONS) → true.
  - Unsafe methods: `Origin` must equal `appOrigin`. A missing `Origin` → false.
- `lib/server/bff/forward.ts`: `upstreamUrl(...)` and `forwardToApi(...)`, as in v1. It keeps `x-organization-id`.
- `lib/config.ts`: the browser API base is `/api/v1` when the flag is on.
- `lib/api/client.ts`: with the flag on, it sends no `Authorization` header and does not refresh tokens on 401.

**Tests:**
1. No session → 401, and no upstream call.
2. The upstream request carries the server token, not the client's `Authorization` or `Cookie`.
3. A POST from a foreign `Origin` → 403.
4. A POST without `Origin` → 403.
5. A POST from the app origin → forwarded.
6. A GET with no `Origin` → forwarded.
7. `..` or an encoded slash in the path → 400.
8. An upstream 302 is returned as-is.
9. An upstream `text/event-stream` streams through.
10. An upstream 401 with the idle code passes through.
11. Flag off → the old base URL and Bearer header.

**Rollback:** rebuild with the flag unset.

## 6. Decisions and questions

### Decisions (recorded 30 Oct 2026)
1. The browser-query moves (P1-01…P1-04) are cutover blockers, in Tier 1.
2. The session store lives in `bff/`, with a separate `emithran_control` database migrated by `migrate.ts --target control`.
3. Squash source: `prod_schema.sql` from the owner, after G1.
4. Rollback before PNR: no replay script. Roll back only if there were no customer writes; otherwise forward-fix.
5. Runner: option (a), internal API only.
6. Delivery/QC rows with no inferable organization go to quarantine in the tenant database, released only with owner approval (P2-25).
7. Secrets: AWS Secrets Manager and KMS in the control-plane region.
8. Backup tables: export, then drop (P2-24).
9. AI routes move behind the gateway in Tier 3, only on trigger.
10. Testcontainers is approved as a backend dev dependency; the bash Docker tests stay.
11. Phase 1 login without the Auth0 organization parameter is acceptable, with `X-Organization-Id` validated per request; org-scoped tokens arrive in P2-06.
12. Supplier collaboration: guest access per RFQ for pilots; organization-to-organization exchange later.
13. Availability: 99.0% contractual and 99.5% internal; failover is separate from disaster recovery.
14. Dedicated data planes only in regions with eMithran compute: Mumbai first, Frankfurt on trigger.
15. Tenant migrations carry schema and data mechanics only, applied by the migrator or as a reviewed SQL bundle.
16. **(30 Oct, owner) Auth0 only, no Supabase at runtime, now.** There are no real users yet, so there is no staged cutover and no PNR soak for sign-in: the Supabase sign-in code (P1-13) is deleted as soon as the browser data paths (P1-01…P1-04) are behind the API. Runtime uses AUTH_BACKEND=auth0, DB_BACKEND=postgrest (own Postgres) and STORAGE_BACKEND=s3. The backend keeps the supabase-js library as its PostgREST client until each module is ported in phase 4. One export of the Supabase database (baseline dump) is still needed for reference data.

### Open questions
13. **P0-04 and P0-05 (logger)** were not in the tier list. I put them on the parallel track and moved "logger check" from G1 to G2. Should they instead be Tier 1, so the log canary holds from cutover day?
14. **P0-21 fixtures.** The repo has no golden costing cases. The only fixture files are `src/test/fixtures/rmp15-pmi-records.json` and `test/fixtures/cad`. Which parts and BOMs should the snapshot use: anonymised real parts you provide, or input cases taken from the existing sheet-metal, machining and moulding specs? I will not invent data.
15. **Region.** Confirm Mumbai, `ap-south-1`, for the control plane, the pooled plane and the secret store.
16. **Guest grants.** Store them in the control plane next to memberships (my recommendation, since the resolver reads them before choosing a tenant), or in the OEM's tenant database?
17. **P1-15 interim page.** Until P2-26 lands, should the emailed link go to an "ask your OEM contact for the files" page, or should the email carry no link at all?
18. **P2-20 counters.** Rate-limit counters in the control database avoid adding Redis (a hard constraint). At 600 requests/min/user this is one small upsert per request. Is that acceptable, or should limits be per replica in memory, which is less exact?

## Verification for every PR

- Root: `npm test`, `npm run type-check` and `npm run check:boundary`.
- `backend/`: `npm test`, `npm run typecheck` and `npm run check:rls`.
- `npm run test:sql` when SQL changes; `test:postgrest`, `test:s3`, `test:boot` or `test:baseline` when the PR touches those paths.
- From P0-21 on, the golden snapshot is part of `npm test` and must stay byte-identical.
