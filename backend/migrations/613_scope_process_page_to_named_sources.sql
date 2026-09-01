-- ============================================================================
-- Migration 613: Scope the Process page to the user's named source files
-- ============================================================================
-- Explicit, repeated user decision (2026-09-01): the Process Calculator
-- Mappings page should show ONLY operations traceable to
-- memory/sheetmetal/process/ (Sheet Metal), the Injection Molding
-- digital-factory files (Plastic & Rubber). Everything else -- Assembly,
-- Post Processing, Packing & Delivery in full, and every Plastic & Rubber
-- operation NOT in the digital-factory processes list, and every Machining
-- operation-based row -- is removed, end to end (DB, and by extension the
-- Process page, BOM item entry, Workflow Builder, and any other consumer
-- of process_calculator_mappings).
--
-- Sheet Metal is explicitly EXCLUDED from this trim -- the user confirmed
-- keeping its full live set (67 rows) even where a row has no match in
-- process_operations.json (e.g. "Gross Usage", "Tapping", "Deburr") --
-- those still have real registered cost engines (Phase 1) even though
-- they're outside process_operations.json's narrower primary-taxonomy
-- scope. Only Assembly/Post Processing/Packing & Delivery/Plastic & Rubber
-- extras/Machining are cut.
--
-- Machining: memory/machining/processes.json's 43 station/machine-type
-- names (e.g. "3 Axis Mill", "Wire EDM") have no natural process_route --
-- that column is NOT NULL on this table (migration 024) and inventing a
-- placeholder route for them would be exactly the fabricated grouping this
-- whole reconciliation effort has avoided throughout. Per explicit user
-- decision: Machining's 68 current operation-based rows (Drilling, Turning,
-- Facing, etc. -- not in processes.json's station list) are deleted and
-- NOT replaced here. The 43 station names already exist correctly in
-- process_taxonomy (no route required there); a real route/calculator
-- model for them is a separate, later task, not invented in this
-- migration.
--
-- SAFETY: full backups of both affected tables are taken first (cheap,
-- and this is a destructive, hard-to-reverse operation the user explicitly
-- confirmed after being told what it removes -- BOM entry's process
-- picker, Workflow Builder, and any calculator wiring for these rows).
-- The underlying `calculators` table rows themselves are NOT touched --
-- only the process_calculator_mappings link to them -- so nothing here
-- deletes a real cost-calculator implementation, only its selectability
-- via this operation list.
-- ============================================================================

BEGIN;

-- Pre-flight check: mhr_records.canonical_process_id (migration 611) has
-- no ON DELETE clause (defaults to RESTRICT) -- if any mhr_records row
-- were ever linked to a process_taxonomy row in one of the groups being
-- removed below, the DELETE FROM process_taxonomy further down would fail
-- with a raw FK-violation error. Migration 611 only ever linked Sheet
-- Metal rows (its own documented scope), which this migration doesn't
-- touch, so this is expected to find nothing -- this just turns a
-- possible cryptic constraint error into a clear, actionable one.
DO $$
DECLARE
  blocking_count INTEGER;
BEGIN
  SELECT count(*) INTO blocking_count
  FROM mhr_records mr
  JOIN process_taxonomy pt ON pt.id = mr.canonical_process_id
  WHERE pt.process_group IN ('Assembly', 'Post Processing', 'Packing & Delivery', 'Machining')
     OR (pt.process_group = 'Plastic & Rubber' AND lower(pt.process_name) NOT IN ('compression molding', 'injection molding', 'structural foam molding'));
  IF blocking_count > 0 THEN
    RAISE EXCEPTION 'Migration 613 aborted: % mhr_records row(s) are linked (via canonical_process_id) to a process_taxonomy row this migration would delete. Run: SELECT mr.id, mr.machine_name, pt.process_group, pt.process_name FROM mhr_records mr JOIN process_taxonomy pt ON pt.id = mr.canonical_process_id WHERE pt.process_group IN (''Assembly'',''Post Processing'',''Packing & Delivery'',''Machining'') OR (pt.process_group = ''Plastic & Rubber'' AND lower(pt.process_name) NOT IN (''compression molding'',''injection molding'',''structural foam molding'')); -- to see which, then decide whether to null their canonical_process_id first or keep those specific process_taxonomy rows.', blocking_count;
  END IF;
END $$;

CREATE TABLE process_calculator_mappings_backup_613 AS
  SELECT * FROM process_calculator_mappings;
CREATE TABLE process_taxonomy_backup_613 AS
  SELECT * FROM process_taxonomy;

-- ----------------------------------------------------------------------------
-- process_calculator_mappings
-- ----------------------------------------------------------------------------
DELETE FROM process_calculator_mappings
WHERE process_group IN ('Assembly', 'Post Processing', 'Packing & Delivery', 'Machining');

DELETE FROM process_calculator_mappings
WHERE process_group = 'Plastic & Rubber'
  AND lower(operation) NOT IN ('compression molding', 'injection molding', 'structural foam molding');

-- ----------------------------------------------------------------------------
-- process_taxonomy (cascades to process_taxonomy_operations/aliases/
-- lookup_tables via ON DELETE CASCADE, migration 609)
-- ----------------------------------------------------------------------------
DELETE FROM process_taxonomy
WHERE process_group IN ('Assembly', 'Post Processing', 'Packing & Delivery', 'Machining');

DELETE FROM process_taxonomy
WHERE process_group = 'Plastic & Rubber'
  AND lower(process_name) NOT IN ('compression molding', 'injection molding', 'structural foam molding');

COMMIT;

-- Verification (run manually after):
-- SELECT process_group, count(*) FROM process_calculator_mappings GROUP BY process_group ORDER BY process_group;
-- -- Expect: Sheet Metal 67, Plastic & Rubber 3. No Assembly/Post Processing/Packing & Delivery/Machining rows.
-- SELECT process_group, count(*) FROM process_taxonomy GROUP BY process_group ORDER BY process_group;
-- -- Expect: Sheet Metal ~68 (unaffected by this migration), Plastic & Rubber 3. No Assembly/Post Processing/Packing & Delivery/Machining rows.
--
-- To restore everything this migration removed, if ever needed:
-- TRUNCATE process_calculator_mappings; INSERT INTO process_calculator_mappings SELECT * FROM process_calculator_mappings_backup_613;
-- TRUNCATE process_taxonomy CASCADE; INSERT INTO process_taxonomy SELECT * FROM process_taxonomy_backup_613;
-- (re-run migration 609's operations/aliases seed afterward to restore the child rows)
