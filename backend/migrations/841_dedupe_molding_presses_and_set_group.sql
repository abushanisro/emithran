-- ============================================================================
-- Migration 841: molding presses - remove duplicates, set process_group
-- ============================================================================
-- ROOT CAUSE
-- Migration 633 (memory/Plastic Modeling/machine) inserted the presses with a
-- plain INSERT and no process_group. It was run again on 2026-09-28, so every
-- compression / structural foam / RIM press an earlier run had already put in
-- (with process_group Plastic Molding) now exists twice, and the 81 injection
-- presses exist only without a group. A press with no process_group and no
-- commodity_code belongs to no Process in HR Rates or in the Edit Process Cost
-- picker. gen_633 now writes process_group and skips rows that already exist.
--
-- For the four molding classes this migration:
--   1. finds duplicates (same machine_class, location and machine name, trimmed
--      and case-insensitive) and keeps the NEWEST row of each: the current 633
--      output, with the 734 key and the 832 specs;
--   2. repoints every reference to the other rows (process_cost_records.mhr_id,
--      bom_item_machine_overrides.mhr_record_id, machine_capabilities.mhr_id)
--      to the kept row, then deletes the other rows;
--   3. sets process_group = Plastic Molding (the group the memory manifest
--      names for this domain) on every molding press without one.
-- One DO block (no temp table), idempotent: a second run finds nothing to do.
-- ============================================================================

DO $$
BEGIN
  -- 2a. references -> kept row
  WITH k AS (
    SELECT DISTINCT ON (machine_class, location, lower(trim(machine_name)))
           machine_class, location, lower(trim(machine_name)) AS lname, id AS keep_id
    FROM public.mhr_records
    WHERE machine_class IN ('injection_molding', 'compression_molding', 'structural_foam_molding', 'reaction_injection_molding')
    ORDER BY machine_class, location, lower(trim(machine_name)), created_at DESC, id
  ), dup AS (
    SELECT r.id AS dup_id, k.keep_id
    FROM public.mhr_records r
    JOIN k ON k.machine_class = r.machine_class AND k.location = r.location AND k.lname = lower(trim(r.machine_name))
    WHERE r.id <> k.keep_id
  )
  UPDATE public.process_cost_records p SET mhr_id = dup.keep_id
  FROM dup WHERE p.mhr_id::text = dup.dup_id::text;

  IF to_regclass('public.bom_item_machine_overrides') IS NOT NULL THEN
    WITH k AS (
      SELECT DISTINCT ON (machine_class, location, lower(trim(machine_name)))
             machine_class, location, lower(trim(machine_name)) AS lname, id AS keep_id
      FROM public.mhr_records
      WHERE machine_class IN ('injection_molding', 'compression_molding', 'structural_foam_molding', 'reaction_injection_molding')
      ORDER BY machine_class, location, lower(trim(machine_name)), created_at DESC, id
    ), dup AS (
      SELECT r.id AS dup_id, k.keep_id
      FROM public.mhr_records r
      JOIN k ON k.machine_class = r.machine_class AND k.location = r.location AND k.lname = lower(trim(r.machine_name))
      WHERE r.id <> k.keep_id
    )
    UPDATE public.bom_item_machine_overrides o SET mhr_record_id = dup.keep_id
    FROM dup WHERE o.mhr_record_id::text = dup.dup_id::text;
  END IF;

  IF to_regclass('public.machine_capabilities') IS NOT NULL THEN
    WITH k AS (
      SELECT DISTINCT ON (machine_class, location, lower(trim(machine_name)))
             machine_class, location, lower(trim(machine_name)) AS lname, id AS keep_id
      FROM public.mhr_records
      WHERE machine_class IN ('injection_molding', 'compression_molding', 'structural_foam_molding', 'reaction_injection_molding')
      ORDER BY machine_class, location, lower(trim(machine_name)), created_at DESC, id
    ), dup AS (
      SELECT r.id AS dup_id, k.keep_id
      FROM public.mhr_records r
      JOIN k ON k.machine_class = r.machine_class AND k.location = r.location AND k.lname = lower(trim(r.machine_name))
      WHERE r.id <> k.keep_id
    )
    UPDATE public.machine_capabilities c SET mhr_id = dup.keep_id
    FROM dup WHERE c.mhr_id::text = dup.dup_id::text;
  END IF;

  -- 2b. delete the duplicates
  WITH k AS (
    SELECT DISTINCT ON (machine_class, location, lower(trim(machine_name)))
           machine_class, location, lower(trim(machine_name)) AS lname, id AS keep_id
    FROM public.mhr_records
    WHERE machine_class IN ('injection_molding', 'compression_molding', 'structural_foam_molding', 'reaction_injection_molding')
    ORDER BY machine_class, location, lower(trim(machine_name)), created_at DESC, id
  )
  DELETE FROM public.mhr_records r
  USING k
  WHERE k.machine_class = r.machine_class AND k.location = r.location AND k.lname = lower(trim(r.machine_name))
    AND r.id <> k.keep_id;

  -- 3. process group
  UPDATE public.mhr_records
  SET process_group = 'Plastic Molding'
  WHERE machine_class IN ('injection_molding', 'compression_molding', 'structural_foam_molding', 'reaction_injection_molding')
    AND nullif(trim(process_group), '') IS NULL;
END $$;

NOTIFY pgrst, 'reload schema';

-- Verify (expect duplicate_presses 0 and presses_without_group 0):
-- SELECT
--   (SELECT count(*) FROM (SELECT 1 FROM public.mhr_records
--      WHERE machine_class IN ('injection_molding', 'compression_molding', 'structural_foam_molding', 'reaction_injection_molding')
--      GROUP BY machine_class, location, lower(trim(machine_name)) HAVING count(*) > 1) d) AS duplicate_presses,
--   (SELECT count(*) FROM public.mhr_records
--      WHERE machine_class IN ('injection_molding', 'compression_molding', 'structural_foam_molding', 'reaction_injection_molding')
--        AND nullif(trim(process_group), '') IS NULL) AS presses_without_group;
