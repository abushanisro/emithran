-- ============================================================================
-- Migration 736: Scope the Plastic Molding process group to its 4 real,
-- registered-engine processes only
-- ============================================================================
--
-- ROOT CAUSE
--
-- Migration 613 (2026-09-01) trimmed process_taxonomy/process_calculator_
-- mappings' Plastic & Rubber group down to exactly the processes with a real
-- registered cost engine: Compression Molding, Injection Molding, Structural
-- foam molding (confirmed by migration 634's own comment, written after 613
-- ran: "Compression Molding, Injection Molding, and Structural foam molding
-- all have a process_taxonomy row + a process_calculator_mappings row").
-- Migration 634 then correctly added the 4th real process, Reaction
-- Injection Molding, the same way.
--
-- Migrations 635/636 (seed_rim_taxonomy_operations /
-- injection_molding_reference_data_staging), run after 634, re-introduced
-- real, sourced fine-grained OPERATION-level rows for this group — e.g. from
-- memory/plastic modeling/process/digital_factory_operations.json's 92 real
-- "<Process>:<OperationCategory>//<FeatureType>" entries (Compression
-- Molding:As Molded//CurvedSurface, Injection Molding:ComplexHole, etc.) —
-- confirmed by migration 647's own comment: by the time it ran, process_
-- taxonomy carried "26 other real rows" in this group beyond the 4 migration
-- 614 had renamed, still on the pre-rename group label. These rows are real
-- (sourced from the same reference file the 4 processes themselves come
-- from), but they are feature/operation-level taxonomy, not a 5th-25th
-- distinct MANUFACTURING PROCESS a part can be routed to or a machine can be
-- selected for — none of them has its own registered ManufacturingProcess
-- Engine, cost function, or machine_class the way the 4 real processes do.
-- Explicit user decision (2026-09-11): the Process page's Plastic Molding
-- group should show exactly those 4 real, routable processes and nothing
-- else — matching the domain's actual production-ready surface (this same
-- session's CLAUDE.md checklist: 4 real cost engines, 4 real machine_class
-- values, nothing else registered).
--
-- Scope covers every historical spelling this group's process_group column
-- has carried across the rename chain (614/647/733), since which of those
-- migrations actually reached the live DB before this one runs is not
-- assumed here — matching every one of them is a no-op for labels that were
-- never live, not a guess.
-- ============================================================================

BEGIN;

-- ── Pre-flight guard: refuse to silently orphan a real mhr_records row ──────
-- If any real machine is linked (via canonical_process_id, migration 611) to
-- one of the fine-grained rows this migration would delete, that is new
-- information this migration's own reasoning did not account for — abort and
-- surface exactly which rows, rather than either corrupting a real machine
-- link or letting Postgres's default RESTRICT throw an opaque FK error.
DO $$
DECLARE
  blocking_count INTEGER;
BEGIN
  SELECT count(*) INTO blocking_count
  FROM mhr_records mr
  JOIN process_taxonomy pt ON pt.id = mr.canonical_process_id
  WHERE pt.process_group IN ('Plastic & Rubber', 'Injection Molding', 'Plastic Molding')
    AND lower(pt.process_name) NOT IN (
      'compression molding', 'injection molding',
      'reaction injection molding', 'structural foam molding'
    );

  IF blocking_count > 0 THEN
    RAISE EXCEPTION 'Migration 736 aborted: % mhr_records row(s) are linked (via canonical_process_id) to a Plastic Molding process_taxonomy row this migration would delete. Run: SELECT mr.id, mr.machine_name, pt.process_group, pt.process_name FROM mhr_records mr JOIN process_taxonomy pt ON pt.id = mr.canonical_process_id WHERE pt.process_group IN (''Plastic & Rubber'',''Injection Molding'',''Plastic Molding'') AND lower(pt.process_name) NOT IN (''compression molding'',''injection molding'',''reaction injection molding'',''structural foam molding''); -- to see which, then decide whether to null their canonical_process_id first or keep those specific rows.', blocking_count;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS process_calculator_mappings_backup_736 AS
  SELECT * FROM process_calculator_mappings
  WHERE process_group IN ('Plastic & Rubber', 'Injection Molding', 'Plastic Molding');
CREATE TABLE IF NOT EXISTS process_taxonomy_backup_736 AS
  SELECT * FROM process_taxonomy
  WHERE process_group IN ('Plastic & Rubber', 'Injection Molding', 'Plastic Molding');

DELETE FROM process_calculator_mappings
WHERE process_group IN ('Plastic & Rubber', 'Injection Molding', 'Plastic Molding')
  AND lower(operation) NOT IN (
    'compression molding', 'injection molding',
    'reaction injection molding', 'structural foam molding'
  );

-- Cascades to process_taxonomy_operations/aliases/lookup_tables (migration 609).
DELETE FROM process_taxonomy
WHERE process_group IN ('Plastic & Rubber', 'Injection Molding', 'Plastic Molding')
  AND lower(process_name) NOT IN (
    'compression molding', 'injection molding',
    'reaction injection molding', 'structural foam molding'
  );

COMMIT;

-- Verification (run manually after):
-- SELECT process_group, process_name FROM process_taxonomy WHERE process_group IN ('Plastic & Rubber','Injection Molding','Plastic Molding') ORDER BY process_name;
-- -- Expect exactly 4 rows: Compression Molding, Injection Molding, Reaction Injection Molding, Structural foam molding.
-- SELECT process_group, operation FROM process_calculator_mappings WHERE process_group IN ('Plastic & Rubber','Injection Molding','Plastic Molding') ORDER BY operation;
-- -- Expect exactly 4 rows, same names.

-- Rollback, if ever needed:
-- INSERT INTO process_calculator_mappings SELECT * FROM process_calculator_mappings_backup_736 ON CONFLICT DO NOTHING;
-- INSERT INTO process_taxonomy SELECT * FROM process_taxonomy_backup_736 ON CONFLICT DO NOTHING;
