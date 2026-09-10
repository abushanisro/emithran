-- ============================================================================
-- Migration 730: Remove "Co2 Laser Cutting" end to end — not just deactivate
-- it (migration 728), delete the row entirely so it stops appearing on the
-- Process page at all, per explicit user request (2026-09-10): "remove end
-- to end" after seeing it still listed as an "inactive" pill among Sheet
-- Metal's 25 ops.
-- ============================================================================
-- ROOT CAUSE / WHY A FULL DELETE, NOT JUST is_active=false
--
-- Migration 728 (this same session) deactivated "Co2 Laser Cutting" because
-- it is a real, evidenced duplicate of "Laser Cut" (same real machine pool,
-- same process family, no calculator of its own, 0 real process_cost_
-- records ever) — the same reasoning migration 715 already applied once to
-- "Fiber Laser Cut". Deactivating kept the row visible-but-inert, matching
-- how every OTHER real duplicate in this catalog has been handled.
--
-- The user has now asked for the stronger cut: a fully dead catalog row with
-- nothing behind it and zero real usage should not still occupy a slot on
-- the Process page's operations list at all, even a grayed-out "inactive"
-- one. Safe to delete outright because:
--
--   - 0 real process_cost_records ever reference operation = 'Co2 Laser
--     Cutting' (confirmed, migration 715/728's own verification queries).
--   - process_route_steps.calculator_mapping_id -> process_calculator_
--     mappings(id) is ON DELETE SET NULL (migration 026) -- any stale
--     reference is cleared, not blocked, and this operation was never a real
--     calculator anyway (calculator_id has always been NULL for it).
--   - process_taxonomy_operations/aliases/(any other child table) ->
--     process_taxonomy(id) are ON DELETE CASCADE (migration 609) -- deleting
--     the taxonomy row cleans up its own children automatically. Migration
--     725's own Part B left this operation with zero detail/alias rows
--     anyway, so there is nothing real to lose here.
--
-- ORDER MATTERS, and a real live run of this migration's first draft
-- confirmed a SECOND blocker beyond process_calculator_mappings:
--
--   ERROR: 23503: update or delete on table "process_taxonomy" violates
--   foreign key constraint "mhr_records_canonical_process_id_fkey"
--
-- mhr_records.canonical_process_id REFERENCES process_taxonomy(id), also
-- with no cascade (migration 611). Migration 569 originally set the 24 real
-- "Laser Cutting Machine" mhr_records rows to process_route='Sheet Cutting',
-- operation='Co2 Laser Cutting' (COALESCEing machine_class to co2_laser at
-- the same time) -- migration 611 then linked their canonical_process_id to
-- that same 'Co2 Laser Cutting' process_taxonomy row. Migrations 722/723
-- only ever repointed machine_class (via benchmark_source_key matching) and
-- process_calculator_mappings' own catalog row -- they never touched these
-- 24 machines' own operation/process_route/canonical_process_id columns, so
-- the real machine rows themselves were still carrying the old identity.
--
-- Fixed here: repoint the 24 real machines to the same real, active identity
-- process_calculator_mappings' 'Laser Cut' row already carries
-- (process_route='Laser Cutting', same as 'Fiber Laser Cut' -- migration
-- 569 line for that category), with canonical_process_id following via the
-- same (process_group, process_name) join migration 611 itself used. THEN
-- delete process_calculator_mappings' row (clears migration 610's FK),
-- THEN delete process_taxonomy's row (both blocking FKs now empty).
--
-- Supersedes migration 728's UPDATE-based approach for this same operation
-- with an outright DELETE. Both are safe to run in sequence (728's UPDATEs
-- become no-ops once the rows they target are gone), and every statement
-- here is independently idempotent (each WHERE matches 0 rows on a re-run).
--
-- Run in: Supabase SQL Editor
-- ============================================================================

BEGIN;

-- ── 1. Repoint the 24 real machine rows off the operation being removed ────
UPDATE mhr_records mr
   SET process_route = 'Laser Cutting',
       operation = 'Laser Cut',
       canonical_process_id = pt.id
  FROM process_taxonomy pt
 WHERE pt.process_group = 'Sheet Metal'
   AND pt.process_name = 'Laser Cut'
   AND mr.operation = 'Co2 Laser Cutting';

-- ── 2. Delete the dead catalog row (clears migration 610's FK) ─────────────
DELETE FROM process_calculator_mappings
 WHERE process_group = 'Sheet Metal'
   AND process_route = 'Sheet Cutting'
   AND operation = 'Co2 Laser Cutting';

-- ── 3. Delete the taxonomy row itself (both blocking FKs now empty) ────────
DELETE FROM process_taxonomy
 WHERE process_group = 'Sheet Metal'
   AND process_name = 'Co2 Laser Cutting';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification
--
-- 1. Gone from both tables:
--
--   SELECT * FROM process_calculator_mappings
--    WHERE process_group = 'Sheet Metal' AND operation = 'Co2 Laser Cutting';
--   -- Expect 0 rows.
--
--   SELECT * FROM process_taxonomy
--    WHERE process_group = 'Sheet Metal' AND process_name = 'Co2 Laser Cutting';
--   -- Expect 0 rows.
--
-- 1b. The 24 real machines repointed, none orphaned:
--
--   SELECT operation, process_route, count(*), count(canonical_process_id) AS linked
--     FROM mhr_records
--    WHERE benchmark_source_key LIKE 'Laser Cutting Machine:%'
--    GROUP BY operation, process_route;
--   -- Expect one row: operation='Laser Cut', process_route='Laser Cutting',
--   -- count=24, linked=24.
--
-- 2. No costing history existed to lose:
--
--   SELECT count(*) FROM process_cost_records WHERE operation = 'Co2 Laser Cutting';
--   -- Expect 0 (unaffected by this migration either way).
--
-- 3. Process page: reload /process — Sheet Metal now shows 24 ops, "Co2
--    Laser Cutting" no longer listed (active or inactive).
--
-- 4. Every other real laser operation untouched:
--
--   SELECT operation, process_route, machine_class, is_active
--     FROM process_calculator_mappings
--    WHERE process_group = 'Sheet Metal' AND operation ILIKE '%laser%'
--    ORDER BY is_active DESC, operation;
--   -- Expect: 'Fiber Laser Cut' (fiber_laser, active), 'Laser Cut'
--   -- (co2_laser, active), '3D Laser'/'3D Laser Cut' (laser_3d, active).
