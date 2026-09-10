-- ============================================================================
-- Migration 731: Finish migration 613's never-fully-executed scoping, and
-- remove the orphaned "Plastic Molding" process_taxonomy duplicate.
-- ============================================================================
-- ROOT CAUSE
--
-- Migration 613 (2026-09-01) was written to delete process_calculator_
-- mappings/process_taxonomy rows for Assembly, Post Processing, Packing &
-- Delivery, and Machining's legacy operation-based rows (per an explicit,
-- repeated user decision at the time), and to trim "Plastic & Rubber" down
-- to its 3 real digital-factory operations. A direct live-DB query
-- (2026-09-10) confirms process_taxonomy still has Assembly (22 rows),
-- Post Processing (66), Packing & Delivery (11), and full Machining (110
-- rows, at their original migration-609 seed size) -- 613's DELETEs never
-- ran against process_taxonomy for these groups. Same for process_
-- calculator_mappings.
--
-- Separately, migration 614 (rename "Plastic & Rubber" -> "Injection
-- Molding") DID run, but -- per migration 647's own header, written with
-- direct knowledge of the live counts -- only PARTIALLY: process_
-- calculator_mappings was fully renamed (0 "Plastic & Rubber" rows left),
-- but process_taxonomy only had the 4 rows migration 614 explicitly
-- targeted renamed; the other real ~26 rows (plus migration 634's later
-- "Reaction Injection Molding" addition, folded into the correct group
-- separately) still carried "Plastic & Rubber". Migration 647 then renamed
-- that literal remaining string to "Plastic Molding" (this session's final
-- domain-name decision) wherever it was still live -- which is exactly
-- these 26 never-trimmed process_taxonomy rows. The result live today:
-- process_taxonomy has BOTH "Injection Molding" (4 rows: Compression/
-- Injection/Reaction Injection/Structural Foam Molding -- the real,
-- correctly-wired set) AND "Plastic Molding" (26 rows) -- an orphaned
-- duplicate of the pre-613-trim unscoped set, never merged or removed.
--
-- A REAL BUG CAUGHT WHILE WRITING THIS MIGRATION, BEFORE IT WAS EVER RUN
--
-- A first draft of this migration simply re-ran 613's original blanket
-- `DELETE ... WHERE process_group = 'Machining'` against both tables. That
-- would have been WRONG today: 613 was written 2026-09-01, before migration
-- 691 (later) backfilled 41 real, sourced process_taxonomy_operations rows
-- for Machining (memory/machining/operations_full.json's 41 real station
-- processes -- confirmed live: Machining has 110 process_taxonomy rows, 41
-- with real detail matching 691 1:1, 69 without). A blanket delete would
-- have destroyed that real, later-added data. Fixed below: the Machining
-- delete is scoped to ONLY rows with zero process_taxonomy_operations
-- detail (the 69 genuine legacy/undetailed rows 613 always meant to
-- remove) -- the 41 real, detailed rows are explicitly preserved.
--
-- A second risk considered and guarded against (not just assumed away):
-- process_calculator_mappings could, in principle, hold live, active
-- catalog rows for the real registered CNC (cnc_3ax_vmc/cnc_4ax_vmc/
-- cnc_5ax_mc/cnc_lathe/cnc_lathe_live/cnc_mill_turn), CMM inspection
-- (cmm), surface treatment (surface_treatment), or injection molding
-- (injection_molding) engines (manufacturing-process-registry.ts) under
-- one of the groups this migration touches. Deleting those would silently
-- break the Add Operation picker / manual workflow-step validation for a
-- live, working process. Pre-flight guard 2 below aborts loudly instead of
-- guessing if any such row is found.
--
-- THE FIX
--
-- 1. Finish 613's original, still-valid deletion for Assembly/Post
--    Processing/Packing & Delivery (confirmed live: zero
--    process_taxonomy_operations detail across all three -- nothing real
--    to lose) and Machining's undetailed legacy rows only.
-- 2. Remove the "Plastic Molding" duplicate group. Any row that already
--    carries real process_taxonomy_operations detail is name-matched
--    against the 4 known-real Injection Molding operations first (a
--    duplicate of a row that already exists correctly elsewhere is safe to
--    drop); if any detailed "Plastic Molding" row does NOT match one of
--    those 4 names, this migration ABORTS instead of guessing what to do
--    with it.
-- 3. Migration 614 is NOT re-run or reversed -- it is superseded here for
--    process_taxonomy specifically (process_calculator_mappings was
--    already fully and correctly renamed by it, untouched by this
--    migration). A future reader should not go looking for 614 to "still
--    need applying" -- this migration + the existing 636/637+ Injection
--    Molding seed together are the current, correct state.
--
-- SAFETY: same backup-table + FK pre-flight-guard pattern as 613, plus the
-- two additional guards above.
--
-- Idempotent: every DELETE is scoped to the exact current (stale) group
-- names/content; re-running after success is a no-op throughout.
--
-- Run in: Supabase SQL Editor
-- ============================================================================

BEGIN;

-- ── Pre-flight guard 1 (same as 613): no mhr_records row may be linked via
-- canonical_process_id to a process_taxonomy row this migration deletes. ───
DO $$
DECLARE
  blocking_count INTEGER;
BEGIN
  SELECT count(*) INTO blocking_count
  FROM mhr_records mr
  JOIN process_taxonomy pt ON pt.id = mr.canonical_process_id
  WHERE pt.process_group IN ('Assembly', 'Post Processing', 'Packing & Delivery')
     OR pt.process_group = 'Plastic Molding'
     OR (pt.process_group = 'Machining'
         AND NOT EXISTS (SELECT 1 FROM process_taxonomy_operations pto WHERE pto.canonical_process_id = pt.id));
  IF blocking_count > 0 THEN
    RAISE EXCEPTION 'Migration 731 aborted: % mhr_records row(s) are linked (via canonical_process_id) to a process_taxonomy row this migration would delete. Run: SELECT mr.id, mr.machine_name, pt.process_group, pt.process_name FROM mhr_records mr JOIN process_taxonomy pt ON pt.id = mr.canonical_process_id WHERE pt.process_group IN (''Assembly'',''Post Processing'',''Packing & Delivery'') OR pt.process_group = ''Plastic Molding'' OR (pt.process_group = ''Machining'' AND NOT EXISTS (SELECT 1 FROM process_taxonomy_operations pto WHERE pto.canonical_process_id = pt.id)); -- to see which, then decide whether to null their canonical_process_id first or keep those specific rows.', blocking_count;
  END IF;
END $$;

-- ── Pre-flight guard 2 (new): abort if a row this migration would delete
-- from process_calculator_mappings has a machine_class belonging to a real,
-- registered, live-costing engine (manufacturing-process-registry.ts) --
-- do not silently break a working process's Add Operation / manual
-- workflow-step validation path. ────────────────────────────────────────────
DO $$
DECLARE
  live_engine_count INTEGER;
BEGIN
  SELECT count(*) INTO live_engine_count
  FROM process_calculator_mappings
  WHERE (process_group IN ('Assembly', 'Post Processing', 'Packing & Delivery', 'Machining')
         OR process_group = 'Plastic Molding')
    AND machine_class IN (
      'cnc_3ax_vmc', 'cnc_4ax_vmc', 'cnc_5ax_mc',
      'cnc_lathe', 'cnc_lathe_live', 'cnc_mill_turn',
      'cmm', 'surface_treatment', 'injection_molding'
    );
  IF live_engine_count > 0 THEN
    RAISE EXCEPTION 'Migration 731 aborted: % process_calculator_mappings row(s) in a group this migration would delete from reference a real, registered, live-costing engine machine_class. Run: SELECT process_group, process_route, operation, machine_class, is_active FROM process_calculator_mappings WHERE (process_group IN (''Assembly'',''Post Processing'',''Packing & Delivery'',''Machining'') OR process_group = ''Plastic Molding'') AND machine_class IN (''cnc_3ax_vmc'',''cnc_4ax_vmc'',''cnc_5ax_mc'',''cnc_lathe'',''cnc_lathe_live'',''cnc_mill_turn'',''cmm'',''surface_treatment'',''injection_molding''); -- to see which, then decide whether to keep or re-point them before re-running.', live_engine_count;
  END IF;
END $$;

-- ── Pre-flight guard 3 (new): abort if any "Plastic Molding" row that
-- carries real process_taxonomy_operations detail is NOT one of the 4
-- known-real Injection Molding operations -- do not silently delete
-- unrecognized real detail. ────────────────────────────────────────────────
DO $$
DECLARE
  unrecognized_count INTEGER;
BEGIN
  SELECT count(DISTINCT pt.id) INTO unrecognized_count
  FROM process_taxonomy pt
  JOIN process_taxonomy_operations pto ON pto.canonical_process_id = pt.id
  WHERE pt.process_group = 'Plastic Molding'
    AND lower(pt.process_name) NOT IN ('compression molding', 'injection molding', 'reaction injection molding', 'structural foam molding');
  IF unrecognized_count > 0 THEN
    RAISE EXCEPTION 'Migration 731 aborted: % "Plastic Molding" process_taxonomy row(s) carry real operation detail but are not one of the 4 known-real Injection Molding operations. Run: SELECT DISTINCT pt.process_name FROM process_taxonomy pt JOIN process_taxonomy_operations pto ON pto.canonical_process_id = pt.id WHERE pt.process_group = ''Plastic Molding'' AND lower(pt.process_name) NOT IN (''compression molding'',''injection molding'',''reaction injection molding'',''structural foam molding''); -- to see which, then decide whether to merge them into Injection Molding or keep them before re-running.', unrecognized_count;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS process_calculator_mappings_backup_731 AS
  SELECT * FROM process_calculator_mappings;
CREATE TABLE IF NOT EXISTS process_taxonomy_backup_731 AS
  SELECT * FROM process_taxonomy;

-- ── 1. Finish 613's original deletion (never took) ─────────────────────────
-- process_calculator_mappings: blanket for Assembly/Post Processing/
-- Packing & Delivery/Machining -- guard 2 above already confirmed none of
-- these rows carry a real registered engine's machine_class.
DELETE FROM process_calculator_mappings
 WHERE process_group IN ('Assembly', 'Post Processing', 'Packing & Delivery', 'Machining');

-- process_taxonomy: blanket for Assembly/Post Processing/Packing &
-- Delivery (confirmed live: zero rows in any of these three carry real
-- process_taxonomy_operations detail).
DELETE FROM process_taxonomy
 WHERE process_group IN ('Assembly', 'Post Processing', 'Packing & Delivery');

-- process_taxonomy: Machining scoped to UNDETAILED rows only -- the 41 real,
-- sourced rows migration 691 added (memory/machining/operations_full.json)
-- are explicitly preserved, never touched by this migration.
DELETE FROM process_taxonomy pt
 WHERE pt.process_group = 'Machining'
   AND NOT EXISTS (SELECT 1 FROM process_taxonomy_operations pto WHERE pto.canonical_process_id = pt.id);

-- ── 2. Remove the orphaned "Plastic Molding" duplicate ──────────────────────
-- process_calculator_mappings: per migration 647's own header this group
-- was already fully renamed away by 614 (0 rows expected) -- included
-- anyway, scoped and idempotent, in case any row was ever re-created under
-- the old name by a later, unrelated insert.
DELETE FROM process_calculator_mappings
 WHERE process_group = 'Plastic Molding';

DELETE FROM process_taxonomy
 WHERE process_group = 'Plastic Molding';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after):
--
-- SELECT process_group, count(*) FROM process_calculator_mappings GROUP BY process_group ORDER BY process_group;
-- -- Expect: Sheet Metal (unaffected count), Injection Molding (unaffected
-- -- count). No Assembly/Post Processing/Packing & Delivery/Machining/
-- -- Plastic Molding rows.
--
-- SELECT process_group, count(*) FROM process_taxonomy GROUP BY process_group ORDER BY process_group;
-- -- Expect: Sheet Metal 67 (unaffected), Injection Molding 4 (unaffected),
-- -- Machining 41 (down from 110 -- only the real, detailed station rows
-- -- from migration 691 remain). No Assembly/Post Processing/Packing &
-- -- Delivery/Plastic Molding rows.
--
-- SELECT count(*) FROM process_taxonomy pt JOIN process_taxonomy_operations pto ON pto.canonical_process_id = pt.id WHERE pt.process_group = 'Machining';
-- -- Expect 41 -- confirms every real detailed Machining row survived.
--
-- To restore everything this migration removed, if ever needed:
-- TRUNCATE process_calculator_mappings; INSERT INTO process_calculator_mappings SELECT * FROM process_calculator_mappings_backup_731;
-- TRUNCATE process_taxonomy CASCADE; INSERT INTO process_taxonomy SELECT * FROM process_taxonomy_backup_731;
-- (re-run migration 609/691/725's operations/aliases seeds afterward to restore the child rows)
