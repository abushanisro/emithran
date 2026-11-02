# Plan revision prompt (v2)

Paste everything below the line into the Claude Code session that produced the plan.
If you stay in plan mode, it returns the document and you save it yourself.
If you leave plan mode, it may write only docs/planning/IMPLEMENTATION_PLAN.md.

---

Revise the implementation plan you produced earlier in this session.

## Mode and output
- Do not edit, create or delete any application code, migration, config or test file.
- The only file you may write is `docs/planning/IMPLEMENTATION_PLAN.md`.
  - If it exists, read it first and revise it in place.
  - If not, create it from your earlier plan with the revisions applied.
  - If you are in plan mode and cannot write, output the full document instead and I will save it.
- Keep these unchanged: Findings (section 1), Risks (section 2), the PR table columns and the gate structure.
- Put a concise "Changes from v1" list at the top, one line per change, each with its section reference.

## Tiers (replace the phase grouping in section 3)
- **Tier 1, cutover blockers (do now):** P0-01, P0-02, P0-03, P0-06, P0-07, P0-08, P0-09, P0-19, P0-20, P0-21, P1-00 to P1-12, P1-14.
- **Parallel track (never blocks G1):** P0-12 to P0-18.
- **Tier 2, after the point of no return (PNR):** P0-10 and P0-11 first, then P1-13, then all Phase 2 PRs (P2-01 to P2-25).
- **Tier 3, only on trigger:** all Phase 3 PRs (P3-01 to P3-12).
  - State the trigger at the top of the tier: a signed pilot or LOI that requires a client-owned data plane, or a tenant using a non-default `ai_mode`.
- **Phase 4, PostgREST exit:** modules ported one per PR pair (contract tests first, then the port).

## Dependency rule
A PR may depend only on PRs in its own tier or an earlier tier, never on a later one. Re-check every "Depends" cell after the moves, and list any PR you had to move or split to satisfy this.

## Changes to existing PRs
- **P0-03 CSRF:** use an `Origin` check against the app origin on unsafe methods, plus `SameSite=Lax` cookies.
  - Remove `__Host-csrf`/`x-csrf-token` from the files, signatures and tests.
  - Keep a test that a POST from a foreign Origin returns 403.
- **P0-08 and section 5:**
  - The session store lives in a top-level `bff/` folder with a small `pg` pool. Only `bff/**` may import `pg`, as a path exemption in the P0-01 rule.
  - It uses a separate `emithran_control` database, starting with `sessions` only, migrated by `migrate.ts --target control`.
- **P0-10/P0-11:** blocked on a schema-only production dump (`prod_schema.sql`) that I provide after G1. Remove "baseline squash verified" from G1 and add it to G2.
- **P0-12:**
  - Record a checksum for every file in `backend/data`.
  - Search for dynamic paths (`path.join`, template strings near `backend/data` and `memory/`), not only literal names.
  - Verify with the full backend suite and the golden snapshot (P0-21).
- **P1-01:** the frontend sends `X-Organization-Id`; NestJS validates an active membership on every request.
- **P2-03:** replace the dual-write with:
  - a one-time idempotent backfill into control-plane `memberships`;
  - the control plane as the only writer from then on;
  - a nightly parity check that reports ids only;
  - the tenant `organization_members` table becoming read-only legacy data, used only while `app.legacy_org_fallback = on`.
- **P2-10 (FORCE RLS):**
  - Document that once RLS is forced, backfills run as the table owner are filtered. Require them to run as `migrator` (BYPASSRLS) or with tenant settings set.
  - Add a `test:sql` case: a backfill on a forced table updates 0 rows as the owner and all rows as `migrator`.
- **P3-05/P3-06 (runner):** option (a).
  - The runner calls only internal API endpoints: claim a job, get pre-signed URLs, post results.
  - It holds no database credentials, no S3 keys and no `DB_JWT_SECRET`.
  - Remove STS from the Rust work only. P3-03 keeps STS for the API's access to client buckets.
  - Note the matching update to Design Doc section 11.
- **Secrets (P3-01):** AWS Secrets Manager and KMS in the control-plane region. That means the control plane runs on AWS; use one region name consistently (confirm Mumbai, ap-south-1, in the questions).
- **Phase 4 usage check:**
  - Before writing contract tests, check 30 days of route usage for `supplier-nominations`, `projects` and `production-planning`.
  - Freeze unused modules behind a flag and port them last, or propose removal.
  - `lhr`, `mhr` and `calculators/` feed costing: check their usage too, but never freeze them; port them behind the golden snapshot.

## New PRs (add to the tables with full columns)
- **P0-20, Tier 1 — Docs correction.** Update the PRD and Design Doc for findings D1, D2, D3, D10, D13 and the identity key `(provider, sub)` → `(iss, sub)`. Docs only.
- **P0-21, Tier 1 — Costing golden-snapshot harness.**
  - A byte-exact snapshot of the cost outputs for a fixed set of parts and BOMs: sheet metal, machining, moulding, and at least one assembly.
  - It must land before any PR touching bom-items, reference data or a Kysely port.
  - Say where fixtures come from; do not invent data.
- **P1-00, Tier 1 — Stage and Auth0 tenant checklist.** Everything in `CUTOVER_AUTH0_POSTGRES.md` §0, with an owner and evidence per item.
- **P1-14, Tier 1 — EA-015 fix.** Fix RFQ attachments sent by storage path, with a test.
- **P2-20 — Rate limits.** 600 requests per minute per user and 30 uploads per hour per user; return 429 with Retry-After.
- **P2-21 — Organization export and deletion** (PRD F9 and 11.5). A pooled export contains only the requested organization; deletion is audited.
- **P2-22 — Audit event writer.** Emit the PRD 11.4 events into `audit_events`, ids only.
- **P2-23 — k6 load-test harness.** PRD 8.3 conditions: 50 users, 20,000 BOM items, 30-minute steady state, CRUD only, p50/p95/p99. This is the evidence for G4.
- **P2-24 — Backup tables.** Export the `*_backup_*` tables to cold storage, verify row counts, then drop them.
- **P2-25 — Delivery/QC quarantine.**
  - Rows whose organization cannot be inferred move to a quarantine table **in the tenant database**.
  - The control plane holds only ids and approval status. I approve each release from quarantine. No automatic assignment, no deletion.

## Decisions to record in section 6
1. Browser-query moves are cutover blockers (Tier 1).
2. Session store in `bff/`, with the `emithran_control` database, as above.
3. Squash source: `prod_schema.sql` from me, after G1.
4. Rollback before PNR: no replay script. Roll back only if there were no customer writes; otherwise forward-fix.
5. Runner: option (a).
6. Unassigned delivery/QC rows: quarantine, as in P2-25.
7. Secrets: AWS Secrets Manager and KMS.
8. Backup tables: export, then drop (P2-24).
9. AI routes move behind the gateway in Tier 3, only on trigger.
10. Testcontainers approved as a backend dev dependency; keep the bash Docker tests.
11. Phase 1 login without the Auth0 organization parameter is acceptable, with `X-Organization-Id` validated per request; org-scoped tokens arrive in P2-06.

## Addendum: design review of 30 Oct 2026
The PRD and Design Doc were updated the same day: Design 3.2, 7.2, 7.4, 7.5 (new), 8.4, 9, 12, 14.1, 16.1, 16.2, 16.4, 16.5 (new); PRD 8.3, 10.1, F11, N4, 11.5, decision log. Read those sections before revising.

**New PRs**
- **P1-15, Tier 1 — Stop CAD email attachments; fix the dead portal link.**
  - `backend/src/modules/rfq/services/rfq-email.service.ts` attaches files and links to `/vendor-portal/rfq/:id`, which no frontend route serves.
  - Emails carry a link only. Until P2-26 lands, the link goes to a page that tells the supplier the OEM will share the files.
  - Test: no attachment in any RFQ email; every link in the email resolves to an existing route.
- **P1-16, Tier 1 — HA Postgres for the pooled and control-plane databases.** Managed Postgres with a multi-AZ standby, PITR and cross-region backup copies. This is an infrastructure and runbook PR: the Terraform outline plus `docs/ops/failover-test.md`. Evidence: a failover test with its measured time.
- **P2-26, Tier 2 — Guest supplier access (Design 7.5, PRD F11).** Split into three PRs: the guest grant schema and resolver; the API scoped to one RFQ; the invite and quote UI. Add the guest rows of the isolation matrix to P2-18.
- **P2-27, Tier 2 — Tenant function ratchet.**
  - A CI rule fails on any new function in a tenant migration that is not listed in `ci/tenant-functions.json`.
  - Seed the list with today's functions, so it can only shrink, in the same style as P0-01 and P0-02.
  - This is earlier than the review's Tier 3, because a ratchet is cheap and stops growth now.
- **P3-13, Tier 3 — Move proprietary SQL out of tenant migrations.**
  - Cost aggregation, nomination scoring and vendor rating functions, and the calculator seed rows, move to TypeScript or control-plane reference data, one PR per function group.
  - Each PR lands behind the golden snapshot (P0-21).
  - The 58 files in `backend/migrations/calculators/` are not applied by the runner today. Check whether production has their rows before planning work on them.
- **P3-14, Tier 3 — Migration delivery as a reviewed SQL bundle (Design 16.2)**, the alternative to the fleet migrator for client DBAs who refuse DDL rights or BYPASSRLS.
- **P3-15, Tier 3, on trigger (first EU client) — Frankfurt compute cell.** Outline only until the trigger.

**Changes to existing PRs**
- **P2-04 `withTenant`:**
  - Send BEGIN and both `set_config` calls as one simple-protocol statement, after validating the ids as UUIDs.
  - Add a test that counts round trips per call.
- **P2-01 pools:** min 1 connection per active tenant, idle 5 min, max lifetime 30 min with jitter.
- **P3-02:** the same numbers for dedicated pools. Remove "idle 10 s, max lifetime 60 s".
- **P3-01 secret store:**
  - add the in-memory cache with stale-if-error up to 24 h;
  - health checks must not call the store;
  - A/B credential rotation;
  - replication to the DR region;
  - an alert on any store error.

  The review put the cache in Tier 2. It stays in P3-01, because the store first exists there (dependency rule).
- **P3-08 revocation drill and the G4 checkbox:**
  - suspension takes effect within 60 s;
  - the client's script or a privilege revoke takes effect immediately;
  - a password change alone takes effect within 30 min.

  Ship the client revocation script, which ends eMithran's sessions with `pg_terminate_backend`.
- **P2-23 k6:**
  - measure server time at the BFF, in region;
  - report user-perceived latency per user region separately;
  - add a cross-region run against the 800 ms target only when a contract needs it.
- **Gates:**
  - G4 adds a failover test (under 5 min) and the error-budget policy in `docs/ops/`.
  - PNR's restore drill must meet RTO under 2 h for a database under 100 GB.
- **P0-20:** drop the items already corrected by this review. The docs now state the round-trip budget, pool settings, revocation and availability.

**Decisions to add to section 6**
12. Supplier collaboration: guest access per RFQ for pilots; organization-to-organization exchange later.
13. Availability: 99.0% contractual and 99.5% internal; failover is separate from disaster recovery.
14. Dedicated data planes only in regions with eMithran compute: Mumbai (ap-south-1) first, Frankfurt on trigger.
15. Tenant migrations carry schema and data mechanics only; clients may apply them through eMithran's migrator or as a reviewed SQL bundle.

## Validation before you finish
- Every gate checklist matches its tier: G1 = Tier 1; PNR = end of Tier 1; G2 = Tier 2; G3/G4 = Tier 3.
- No PR ID is referenced without a table row.
- Then list any new questions. Ask; do not assume.
