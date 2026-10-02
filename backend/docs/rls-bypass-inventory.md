# Database trust boundary: inventory of intentional RLS bypasses

Authoritative as of 2026-10-01. `npm run check:rls` (scripts/rls-bypass-rules.js) enforces the rules below.

## The boundary

`SupabaseService` (`src/common/supabase/supabase.service.ts`) is the only code that builds a Supabase client.

| Access | API | Notes |
|---|---|---|
| Tenant / user data (RLS enforced) | `getUserClient(token?)`, `getClient(token)` | `getClient` throws on a missing or blank token. `getUserClient` uses the request's token from `RequestAuthInterceptor`, and throws when no authenticated request is in scope. Neither can return the service-role client. |
| Service role (RLS bypassed) | `getPrivilegedClient('<specific reason>')` | Reason is mandatory, a plain literal (CI-enforced), logged at debug. |
| Dev auth bypass | `mintUserAccessToken(email)` | Mints a real user JWT for `ADMIN_FALLBACK_EMAIL`, so the bypass user goes through RLS. Never runs in production. |

There is no second database path: `typeorm`, `knex`, `pg` are not imported anywhere in `src` (CI rule `second-db-path`). They remain in `package.json` as dead dependencies, as does `redis` (kept deliberately for now).

The deprecated `getAdminClient()` and `.client` accessors have been removed from `SupabaseService`; CI rule `get-admin-client` / `dot-client` rejects their reintroduction.

## Counts (production code, excluding specs)

- `getUserClient(...)`: 195 call sites (all tenant-data access)
- `getPrivilegedClient(...)`: 124 call sites, all with a named reason (table below)
- `getAdminClient()` / `.client`: **removed** (0 callers, aliases deleted)
- zero-argument `getClient()`: **0**
- `createClient(` outside `SupabaseService`: **0** (two were found and routed through the service, see below)

## Intentional privileged access, by reason

| Sites | Reason (class) | Where |
|---|---|---|
| 36 | reference-data: sheet-metal lookup tables | `sheet-metal-lookup.service.ts` |
| 8 | reference-data: machining lookup tables | `machining-lookup.service.ts` |
| 8 | reference-data: `machining_reference_data` (public-read policy) | plastic-reference, nre (2), secondary-process (2), processes.service, blank-optimizer (+ `stock_profiles`) |
| 2 | reference-data: `mhr/lhr` benchmark rates (no `user_id`) | `process-cost.service.ts` |
| 1 + 2 | reference-data: `mhr_benchmark_rates`, `lhr_benchmark_rates` | `mhr.service.ts`, `lhr.service.ts` |
| 2 | reference-data: `costing_settings` (global `sga_pct`/`profit_pct`) | `cost-aggregation.service.ts`, `location-comparison.service.ts` |
| 1 each | reference-data: `sm_lookup_stroke_rate`, `process_cycle_time_library`, `material_density_lookup`, `machining_parameters`, `machining_material_groups`, `laser_cutting_parameters`, `injection_molding_materials` | calculators, cycle-time-library, bom-items.controller, manufacturing-rules |
| 1 | rfq-number: `rfq_number` is UNIQUE across all orgs, so the count must see every org | `rfq.service.ts` |
| 1 | bom-item cascade delete: `production_lot_materials` rows RLS hides, bounded to an item already verified visible to the caller | `bom-items.service.ts` |
| 2 | system-cache: `fx_rate_snapshots`, no user context | `fx-rate-cache.service.ts` |
| 1 | system-job: should-cost calibration updates global correction rates | `calibration.service.ts` |
| 1 | system-telemetry: `lookup_coverage_gaps` upsert, fire-and-forget | `bom-items.service.ts` |
| 1 | system-write: `exchange_rates` writes are service-role-only (migration 803) | `exchange-rate.service.ts` |
| 4 | auth-admin: read/sync an auth user (profile 3, rate-editor email 1) | `profile.service.ts`, `exchange-rate.service.ts` |
| 1 | auth: resolve organization membership before an org context exists | `organization-context.guard.ts` |
| 1 | health-check: connectivity probe | `supabase.health.ts` |
| 1 | storage: CAD and drawing file bucket operations | `file-storage.service.ts` |
| 22 | **OPEN RISK** delivery: no tenancy column; repo policy is `USING (true)` for authenticated (see Open items 2) | `delivery.service.ts` |
| 22 | **OPEN RISK** quality-control: no tenancy column; repo policy is per-creator, not per-organization | `quality-control.service.ts` (6), `quality-inspection.service.ts` (16) |
| 1 | **OPEN** `lhr_records` bulk delete: no RLS policy in repo migrations, live state unverified | `lhr.service.ts` |

The sheet-metal and machining lookup reasons are deliberately per-service, not per-table. The tables they read are sourced global reference data, but each table's RLS state was not individually verified in this pass.

## Resolved by this work (were accidental bypasses)

- ~130 zero-argument `getClient()` sites (production-planning, process-planning, quality-inspection, request-logs, manufacturing-rules write) now use `getUserClient()`.
- ~65 optional-token `getClient(token?)` sites now use `getUserClient(token)` (fail closed instead of falling back to admin).
- `raw_materials` price lookups for scrap credit (`bom-items.service.ts`, 2) and the density endpoint fallback (`bom-items.controller.ts`): were service-role reads of an org-scoped table, so one org's quote could be priced from another org's row. Now the caller's RLS client.
- `location-comparison.service.ts`: read `mhr_records` for all locations as admin with no user filter. Now the caller's RLS client (own-org plus global rows).
- `mhr.service.ts` import-dedup read and `removeAll`: admin plus manual `user_id` filter on an org-RLS table with `org_delete_own`. Now the user client.
- `bom-items.controller.ts` and `file-storage.service.ts` built their own service-role clients with `createClient`; both now go through `SupabaseService`.
- Dev auth bypass handed back `accessToken = null`, which silently meant "admin client". It now carries a real minted user JWT.

## Resolved since the first version of this document (2026-10-01)

- The public `GET /supabase-test` endpoint and the two hardcoded service-role JWTs in `app.controller.ts` are removed. `docker-compose.prod.yml` no longer holds a service-role or anon key literal; both are required environment variables (`${VAR:?message}`, no default).
- CI (`.github/workflows/ci.yml`, backend job) runs `npm run check:rls` and fails closed: any service_role JWT literal in any tracked file, any rule violation above, or a failure to list tracked files fails the build.

## Open items (explicitly unresolved)

1. **Service key rotation (manual production action).** The removed service-role key remains in git history (6 commits touch it), in the stale local worktree branch `worktree-rate-resolution-extraction`, and anywhere the repository was cloned or cached. Removing it from the tree does not make it safe; rotate it in the Supabase dashboard and update the deploy environment.
2. **Delivery and quality-control have no tenant isolation** (44 sites, all on `getPrivilegedClient` with OPEN RISK reasons). Correction to the first version of this document: the repo does define policies. Delivery tables carry `FOR ALL TO authenticated USING (true)` (any authenticated user, any organization) and the quality tables carry per-creator policies (`auth.uid() = created_by`); the earlier "no policies / RLS off" statement only looked at one of the three migration trees. The service role bypasses both. There is also direct-API exposure (owner-privileged view, materialized view, SECURITY DEFINER functions granted to authenticated). Full audit and migration design: `delivery-quality-tenant-isolation-design.md`.
3. **`lhr_records` live RLS state: manual verification required.** No policy or RLS statement exists in any migration tree. Live inspection was not possible from this environment (production reads were denied by the session permission classifier). Run query Q6 in the design document. Until then the bulk delete stays on `getPrivilegedClient`, scoped by `user_id`.
4. **Other tracked secrets outside the Supabase service role:** `cad-engine/.env.development` and `cad-engine/.env.production` are tracked and contain `CAD_ENGINE_API_KEY` (and `REDIS_PASSWORD` in development). Not covered by the JWT rule; move to untracked env files and rotate.
5. **Cross-organization integration test** (real two-org fixture) not yet built; see section 10 of the design document for the matrix.
6. Background and fire-and-forget code (`recordLookupCoverageGap`, detached promises in `bom-items.service.ts` and `orchestrator.service.ts`) keep the request async context, but none were exercised with a request that has already ended. User-scoped calls from there would throw; privileged ones are unaffected.
7. Dead dependencies `typeorm`, `@nestjs/typeorm`, `knex`, `pg` remain in `package.json` (and unused `redis`), deliberately deferred.
