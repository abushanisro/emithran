# Delivery and quality-control tenant isolation: design

Status: design only. No migration written or run. Audited 2026-10-01 from repo migrations and application code. The live database was not inspected (see section 1), so every claim about live state below is marked "repo-defined" or "unverified".

Scope: the 44 service-role call sites (`delivery.service.ts` 22, `quality-control.service.ts` 6, `quality-inspection.service.ts` 16) and every database object they depend on.

## 1. What is and is not known

### 1.1 Schema drift: the repo defines these tables more than once

| Tree | Role |
|---|---|
| `backend/migrations` (200-209, `detailed-inspection-reports.sql`) | delivery module, `quality_approved_items`, DB functions, views |
| `backend/database/migrations` (141-147) | `quality_inspections` family, a second `delivery_*` definition (144) |
| `supabase/migrations` | one unrelated file |

Conflicts that make live state unknowable from the repo:
- `quality_approved_items.created_by` is `VARCHAR(100)` in 201/208 but `UUID REFERENCES auth.users` in 141/142.
- `delivery_orders` is created by both 200 and 144 (with `IF NOT EXISTS` semantics, whichever ran first wins).
- `delivery_quality_metrics` is a materialized view in 201 and is queried by the app, but 144/141 never mention it.

**Required before writing any migration: run the introspection script in section 9 against the live database and attach the output.** The backfill rules and constraints below assume the repo-defined shapes and must be re-checked against that output.

### 1.2 `lhr_records` live RLS state: manual verification required

Live read access was not available: the anon-key probe was denied by the session permission classifier and was not retried by other means. Repo evidence only: no `CREATE POLICY` or `ENABLE ROW LEVEL SECURITY` for `lhr_records` exists in any migration tree. Run query Q6 in section 9. Until then `lhr.service.ts` `removeAll` stays on `getPrivilegedClient`, scoped by `user_id`.

## 2. Current exposure model (repo-defined)

There are two enforcement layers and both are currently ineffective for tenancy.

**Layer A, database policies (reachable directly via PostgREST with the public anon key and any logged-in user's JWT, bypassing the backend entirely):**

| Table(s) | Repo-defined policy | Effect |
|---|---|---|
| `delivery_orders`, `delivery_items`, `delivery_addresses`, `carriers` (tree 144) | `FOR ALL TO authenticated USING (true) WITH CHECK (true)` | any authenticated user, any organization, reads and writes everything |
| `delivery_tracking`, `delivery_invoices`, `delivery_invoice_items`, `delivery_documents` | RLS enabled (200) for some, no policy found in either tree | unknown; deny-all if RLS is on, open if off |
| `quality_inspections`, `quality_approved_items` | `FOR ALL USING (auth.uid() = created_by)` | per-user, not per-organization |
| `quality_non_conformances`, `quality_inspection_results`, `detailed_inspection_reports` | `inspection_id IN (SELECT id FROM quality_inspections WHERE created_by = auth.uid())` | per-user via parent |
| `delivery_ready_items` (view) | owner-privileged view, `GRANT SELECT TO authenticated` | any authenticated user reads every tenant's approved items |
| `delivery_quality_metrics` (materialized view) | RLS cannot apply to a materialized view | aggregates across all tenants, readable if granted |
| `create_delivery_order_transaction`, `update_delivery_order_status_bulk`, `calculate_delivery_metrics`, `generate_delivery_report` | `SECURITY DEFINER`, `GRANT EXECUTE TO authenticated`, no caller or organization check | cross-tenant read and write via `POST /rest/v1/rpc/...`. The backend never calls them (no `.rpc` in either service). |

**Layer B, the backend:** all 44 sites use the service role, so Layer A is skipped. No query filters on `created_by`, `organization_id` or `user_id`. Every method receives `userId` but only writes `created_by = userId` on insert; reads are unscoped. Neither controller applies `OrganizationContextGuard`.

Net: any authenticated user of any organization can read and modify every delivery order, address, tracking event, inspection and approved item, through the backend and, for the delivery tables, directly through the database API.

## 3. Ownership model

The organization is already established on the parents: `projects.organization_id`, `boms.organization_id`, `bom_items.organization_id`, all with org RLS (migrations 542-544, 555) built on `current_user_org_ids()` (541) and `is_user_authorized()`. Every table below gets its own `organization_id` (denormalized, so policies are single-table and index-friendly, and so a child can never silently diverge from its parent).

```
organizations
   |
projects --- boms --- bom_items            (already org-scoped)
   |  \                   |
   |   \                  +--- quality_approved_items (bom_item_id)
   |    +--- quality_inspections (project_id, bom_id, lot_id)
   |             +--- quality_non_conformances
   |             +--- quality_inspection_results
   |             +--- detailed_inspection_reports
   +--- delivery_addresses (project_id, nullable)
   +--- delivery_orders (project_id, delivery_address_id, billing_address_id, carrier_id)
            +--- delivery_items (also bom_item_id, quality_approved_item_id)
            +--- delivery_tracking
carriers  (platform-global or org-owned, see 6.4)
```

### 3.1 Target columns and invariants

| Table | New column | Derived from (backfill precedence) | Invariant enforced by the database |
|---|---|---|---|
| `delivery_orders` | `organization_id UUID NOT NULL` | 1) `projects.organization_id` via `project_id`; 2) the single organization of its `delivery_items.bom_item_id` set; 3) unresolved | FK to `organizations`; composite FK `(project_id, organization_id)` to `projects(id, organization_id)` |
| `delivery_items` | same | its `delivery_orders.organization_id` | composite FK `(delivery_order_id, organization_id)` to `delivery_orders(id, organization_id)`; composite FK `(bom_item_id, organization_id)` to `bom_items(id, organization_id)` |
| `delivery_tracking` | same | its order | composite FK to `delivery_orders` |
| `delivery_addresses` | same | 1) `projects.organization_id`; 2) the single organization of the orders referencing it; 3) unresolved | composite FK to `projects` when `project_id` is set |
| `delivery_orders` -> addresses | | | composite FKs `(delivery_address_id, organization_id)` and `(billing_address_id, organization_id)` to `delivery_addresses(id, organization_id)` |
| `carriers` | `organization_id UUID NULL` (NULL = platform-global) | see 6.4 | |
| `quality_inspections` | `organization_id UUID NOT NULL` | 1) `projects.organization_id` via `project_id`; 2) `boms.organization_id` via `bom_id`; 3) creator's organization only if the creator has exactly one active `organization_members` row; 4) unresolved | composite FKs to `projects`, `boms` when set |
| `quality_non_conformances`, `quality_inspection_results`, `detailed_inspection_reports` | same | parent inspection | composite FK `(inspection_id, organization_id)` to `quality_inspections(id, organization_id)` |
| `quality_approved_items` | same | `bom_items.organization_id` via `bom_item_id` | composite FK `(bom_item_id, organization_id)` to `bom_items(id, organization_id)` |

Composite foreign keys need `UNIQUE (id, organization_id)` on `projects`, `boms`, `bom_items`, `delivery_orders`, `delivery_addresses`, `quality_inspections`. `id` is already unique, so these add no new restriction; each is an extra index and a short lock. Rejected alternative: triggers that compare parent and child organizations. A declarative composite FK cannot be disabled by a code path or a bulk load.

Rows that a human must resolve: any row where the precedence list ends at "unresolved", and any row whose derivation yields more than one organization (for example a delivery order whose items belong to two organizations). The migration must not guess.

### 3.2 Constraints that change

| Existing | Problem under per-org RLS | Change |
|---|---|---|
| `delivery_orders.order_number UNIQUE` (global) with trigger `generate_delivery_order_number` computing `MAX(...)+1` over `delivery_orders` | As the inserting user, the trigger sees only their organization's rows, so two organizations both generate `DO-2026-0001` and the global unique fails. It is also race-prone (two concurrent inserts compute the same max). Same class of bug as `rfq_number`. | Drop the global unique; add `UNIQUE (organization_id, order_number)`; generate the number from a per-organization counter row locked with `FOR UPDATE` (or `pg_advisory_xact_lock(hashtext(organization_id::text))`) inside the trigger. |
| `quality_approved_items.qc_certificate_number UNIQUE` (global) with trigger `generate_qc_certificate_number` (prefix = first 8 characters of project name) | Same collision, and project-name prefixes are not unique across organizations. | `UNIQUE (organization_id, qc_certificate_number)`, per-organization counter as above. |
| `delivery_invoices.invoice_number` (global unique, `generate_invoice_number`) | Same | Same treatment if the table is kept (see section 8). |

## 4. RLS design

All policies per command, none permissive, none transitional. Pattern copied from migration 544 (`is_user_authorized()` AND organization membership), with no `organization_id IS NULL` clause for these tables: unresolved rows are resolved before the policies exist, not tolerated by them.

For each of `delivery_orders`, `delivery_items`, `delivery_tracking`, `delivery_addresses`, `quality_inspections`, `quality_non_conformances`, `quality_inspection_results`, `detailed_inspection_reports`, `quality_approved_items`:

- `SELECT`: `is_user_authorized() AND organization_id IN (SELECT current_user_org_ids())`
- `INSERT`: `WITH CHECK` the same predicate
- `UPDATE`: `USING` and `WITH CHECK` the same predicate (a row can never be moved to another organization)
- `DELETE`: `USING` the same predicate

Drop every existing policy on these tables first (`delivery_*_auth` USING(true), `Users manage own ...`). Authorship stays in `created_by` and is not an access rule.

Decision needed (D2): quality tables are currently visible per creator. Moving to organization-wide visibility is a product change (an inspector's colleagues see their inspections). Recommended, because the rest of the platform is organization-scoped and the backend never enforced per-user visibility anyway. If per-creator edit rights are wanted, add a role-based `UPDATE`/`DELETE` predicate later; do not encode it as `created_by` visibility.

### 4.1 Views, materialized view, functions

| Object | Action |
|---|---|
| `delivery_ready_items` (view) | Recreate with `WITH (security_invoker = true)` so it runs with the caller's RLS over the now-scoped base tables (needs PostgreSQL 15 or later; verify with Q1, otherwise replace by a backend query). Keep `GRANT SELECT TO authenticated`. |
| `delivery_quality_metrics` (materialized view) | Drop it (RLS cannot apply). Replace with a `security_invoker` view over the scoped tables, or compute the aggregate in `getDeliveryMetrics` from RLS-scoped queries. One call site. Drop `refresh_delivery_quality_metrics()` and the refresh function. |
| `create_delivery_order_transaction`, `update_delivery_order_status_bulk`, `calculate_delivery_metrics`, `generate_delivery_report` | The backend does not call them. `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`. Do not leave them `SECURITY DEFINER` and callable. Drop them in a later cleanup once confirmed unused by any other client (frontend search for `rpc(`). |
| Triggers `update_delivery_order_costs`, `update_updated_at_column`, `update_delivery_readiness` | Invoker functions; keep. They operate within the caller's organization once RLS applies. |

### 4.2 Indexes

`CREATE INDEX ... (organization_id)` on every table above (partial `WHERE organization_id IS NOT NULL` is unnecessary after NOT NULL). Plus the `UNIQUE (id, organization_id)` indexes from 3.1, and `(organization_id, order_number)` / `(organization_id, qc_certificate_number)`. Policies are single-column and index-served; the composite FKs make parent joins in policies unnecessary.

## 5. Mapping the 44 sites

| Methods | Sites | Target |
|---|---|---|
| delivery: `getAvailableItemsForDelivery`, `createDeliveryOrder`, `getDeliveryOrderById`, `getDeliveryOrders`, `updateDeliveryOrder`, `addTrackingEvent`, `deleteDeliveryOrder`, `getDeliveryMetrics`, `createDeliveryAddress`, `getDeliveryAddresses`, `deleteDeliveryAddress`, `updateOrderStatusFromTracking` | 21 | `getUserClient()`. Inserts additionally write `organization_id` from `@CurrentOrganization()`. |
| delivery: `getCarriers` | 1 | `getUserClient()` (select own-org plus global rows) once carriers has its model (6.4) |
| quality-control: `getQualityMetrics`, `generateQualityReport`, `getQualityDashboard` | 6 | `getUserClient()` |
| quality-inspection: all 12 methods | 16 | `getUserClient()`; `createInspection` and `approveInspection` (inserts `quality_approved_items`) write `organization_id` |

Code changes:
- Apply `@UseGuards(OrganizationContextGuard)` and `@CurrentOrganization()` to `delivery.controller.ts` and the QC controllers (the commented-out `AuthGuard('jwt')` line in `delivery.controller.ts` is dead; the global `SupabaseAuthGuard` already covers it). Pattern: `rfq.controller.ts` and `rfq.service.ts` `create(... organizationId)`.
- Remove the application-level "does this project belong to the caller" checks only where the composite FK plus RLS now enforce it; keep any that produce a friendlier 404.
- The frontend must send `X-Organization-Id` for multi-organization users (already supported by the guard).

## 6. Backfill

### 6.1 Rules
- Idempotent, set-based, deterministic precedence from 3.1; no hardcoded ids; never overwrite a non-NULL `organization_id`.
- Child tables are backfilled from their already-backfilled parent, in dependency order: projects (done) -> addresses and inspections -> orders and approved items -> items, tracking, non-conformances, results, reports.
- The migration ends with a pre-flight that counts rows with `organization_id IS NULL` per table and aborts (RAISE EXCEPTION) if any remain. `NOT NULL`, composite FKs and RLS are applied only by later migrations, which repeat the same guard.

### 6.2 Unresolved and conflicting rows
The pre-flight report lists them (table, id, why). A human assigns an organization or deletes them; the design intentionally has no "default organization" and no catch-all. Existing evidence suggests few: the platform has historically had one writing organization (see migration 544 notes), but that is not verified for these tables, so measure it (Q3 and Q4).

### 6.3 `created_by` type
Where `created_by` is `VARCHAR(100)` it holds free text and cannot be joined to `auth.users` reliably. It is not used for ownership in this design; it stays as an authorship label.

### 6.4 Carriers (decision D1)
Recommended: `carriers.organization_id` nullable, `NULL` = platform-global carrier. Policy: `SELECT` rows where `organization_id IS NULL OR organization_id IN (SELECT current_user_org_ids())`; `INSERT/UPDATE/DELETE` only rows in the caller's organization. This is the established `mhr_records` "own and global" model, not a compatibility shim. Seed carriers from migration 200 keep `NULL`. If every live row is a seeded platform carrier, tenants get read-only access to them and add their own.

## 7. Rollout order

Each step is its own migration (one DO block per migration, written by me, run by you; numbers to be assigned after the latest applied, the repo currently ends at 843 plus 999).

| Step | Change | Safe while the backend is still privileged? | Rollback |
|---|---|---|---|
| M1 | Add nullable `organization_id` + FK + index on all tables; add `UNIQUE (id, organization_id)` on parents | yes, purely additive | `DROP COLUMN` / `DROP CONSTRAINT` |
| Code A | Deploy: controllers resolve organization; every insert writes `organization_id`; still privileged | yes | redeploy previous build |
| M2 | Backfill + report + abort guard | yes | set the column back to NULL for rows this migration set (guard column `backfilled_by_migration` is not required: M2 only touches NULLs, so `UPDATE ... SET organization_id = NULL` limited to the listed ids from the report) |
| human | Resolve the unresolved list | | |
| M3 | `SET NOT NULL`, composite FKs, per-organization unique numbers + counters | yes if M2 guard passed | drop the new constraints; restore the global unique only if no cross-org duplicates exist |
| M4 | Replace policies (section 4), views, matview, function lockdown | yes: the service role is unaffected, so the app keeps working; **this step closes the direct-database exposure** | re-create previous policies from the saved DDL; note this re-opens the hole, so roll back only for an outage |
| Code B | Deploy: switch the 44 sites to `getUserClient()`; remove `OPEN RISK` reasons; guard stays green | requires M4 | redeploy Code A |
| M5 | Drop `delivery_quality_metrics` matview and unused functions (optional cleanup) | yes | recreate from saved DDL |

Why M4 before Code B: the policies must exist before the user-scoped client is used, and M4 alone removes the direct-API exposure without any application change.

Rollback considerations:
- M1 to M3 lose no data. M4 loses nothing but its rollback restores insecure policies, so it needs an explicit decision. M5 drops objects; save their DDL first.
- Back up the affected tables (or take a point-in-time marker) before M2.
- `order_number` and certificate-number counters: M3 rollback must not reintroduce a global unique while per-org duplicates exist; check first.

## 8. Objects outside the 44 sites that the same change must cover

- `delivery_invoices`, `delivery_invoice_items`, `delivery_documents` (from 200): no application use found. Either drop them or apply the same model. Decision D3; recommended: drop if empty (Q5), otherwise scope them the same way.
- Direct-API exposure of every table above is closed by M4 independent of the backend.
- The frontend: search for any direct Supabase client use against these tables (not part of this audit; do before M4 so M4 does not break a direct call).

## 9. Live introspection to run before writing migrations (read-only, run by you)

```sql
-- Q1 server version (security_invoker views need 15 or later)
select version();

-- Q2 structure, RLS flags and policies for every table in scope plus lhr_records
select c.relname, c.relkind, c.relrowsecurity as rls_on, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (
  'delivery_orders','delivery_items','delivery_addresses','delivery_tracking','delivery_invoices',
  'delivery_invoice_items','delivery_documents','carriers','quality_inspections','quality_non_conformances',
  'quality_inspection_results','quality_approved_items','detailed_inspection_reports',
  'delivery_ready_items','delivery_quality_metrics','lhr_records');

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' and tablename in (
  'delivery_orders','delivery_items','delivery_addresses','delivery_tracking','delivery_invoices',
  'delivery_invoice_items','delivery_documents','carriers','quality_inspections','quality_non_conformances',
  'quality_inspection_results','quality_approved_items','detailed_inspection_reports','lhr_records')
order by tablename, policyname;

-- Q3 actual columns (resolves the drift in 1.1)
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name in (
  'delivery_orders','delivery_items','delivery_addresses','delivery_tracking','carriers',
  'quality_inspections','quality_non_conformances','quality_inspection_results',
  'quality_approved_items','detailed_inspection_reports')
order by table_name, ordinal_position;

-- Q4 row counts and how many are resolvable (repeat per table; examples)
select count(*) as orders, count(project_id) as with_project from delivery_orders;
select count(*) as inspections, count(project_id) as with_project, count(bom_id) as with_bom from quality_inspections;
select count(*) as approved_items from quality_approved_items;
select count(*) as unresolved_orders
from delivery_orders o left join projects p on p.id = o.project_id
where p.organization_id is null;

-- Q5 unused invoice and document tables
select (select count(*) from delivery_invoices) as invoices,
       (select count(*) from delivery_invoice_items) as invoice_items,
       (select count(*) from delivery_documents) as documents;

-- Q6 lhr_records (manual verification requested)
select relrowsecurity, relforcerowsecurity from pg_class
where oid = 'public.lhr_records'::regclass;
select policyname, cmd, roles, qual, with_check from pg_policies
where schemaname = 'public' and tablename = 'lhr_records';
select count(*) as total, count(user_id) as with_user, count(distinct user_id) as users from lhr_records;
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'lhr_records';

-- Q7 who can execute the SECURITY DEFINER functions, and do views run as owner
select p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'create_delivery_order_transaction','update_delivery_order_status_bulk',
  'calculate_delivery_metrics','generate_delivery_report','refresh_delivery_quality_metrics');
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('delivery_ready_items','delivery_quality_metrics');
```

## 10. Required tests (real database, no mocks)

A real test Supabase project (or branch database) seeded by a script with two organizations A and B, each with a project, BOM, BOM items, a user, and one multi-organization user.

HTTP through the backend, with each user's real JWT:
1. A cannot list, get, update, delete or add tracking to B's delivery orders, addresses, inspections, approved items (404 or empty, never B data). Same for B on A.
2. A creating an order referencing B's `project_id`, `delivery_address_id`, `bom_item_id` or `quality_approved_item_id` is rejected (composite FK or RLS `WITH CHECK`).
3. Order numbers and QC certificate numbers: A and B each create orders in the same year and get independent, collision-free numbers; 20 concurrent creations in one organization produce 20 distinct numbers.
4. Multi-organization user: without `X-Organization-Id` the request is rejected; with a valid header it sees only that organization; with a foreign organization id it is rejected.
5. Dashboards and metrics (`getQualityMetrics`, `getDeliveryMetrics`) count only the caller's organization.

Direct database API with the same JWTs (proves the backend is not the only barrier):
6. `GET/POST/PATCH/DELETE /rest/v1/<table>` for every table in scope as user A returns zero B rows and rejects writes to B.
7. `GET /rest/v1/delivery_ready_items` returns only the caller's organization.
8. `POST /rest/v1/rpc/<each of the four functions>` as an authenticated user fails with permission denied.
9. An anon request (no user JWT) to every table, view and function returns nothing or is denied.

Migration tests:
10. M2 backfill on a copy of live-shaped data: every row resolved or reported; re-running is a no-op; a row with conflicting derivations aborts.
11. M3 guards abort when a NULL `organization_id` remains.
12. M4 on a copy: policy set matches section 4 exactly (query `pg_policies`; no `USING (true)`, no `organization_id IS NULL` clause).

## 11. Decisions needed from you

| ID | Question | Recommendation |
|---|---|---|
| D1 | Carriers: platform-global plus per-organization, or per-organization only | platform-global (`NULL`) plus per-organization |
| D2 | Quality visibility: organization-wide (recommended) or keep per-creator | organization-wide; add role-based edit rights later if needed |
| D3 | Unused invoice and document tables | drop if empty (Q5), else scope the same way |
| D4 | Unresolved rows: who assigns an organization, or are they deleted | decided by you after seeing the Q4 report; no default organization |
