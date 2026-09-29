-- ============================================================================
-- Migration 839: process groups come from HR Rates; remove "Post Processing"
-- ============================================================================
-- ROOT CAUSE
-- The Edit Process Cost dialog lists Process from HR Rates (every public.mhr_records
-- row process_group, else its commodity_code). Saved process lines carried
-- groups HR Rates does not have ("Post Processing" and others), shown as
-- "saved, not in HR Rates", because the group was taken from hardcoded
-- machine_class -> group maps (bom-items.controller.ts, mhr.service.ts, the
-- Manufacturing Intelligence page) or from old catalog rows. Those maps are
-- removed in code: a line group is now the HR Rates group of its machine.
-- This migration brings the stored data in line.
--
--   1. public.process_cost_records linked to a machine (mhr_id) take the HR Rates
--      group of that machine.
--   2. public.process_cost_records not linked to a machine whose group HR Rates does
--      not have are cleared (NULL): the dialog reads the group off the machine
--      once one is chosen. Nothing is guessed.
--   3. Catalog rows (public.process_calculator_mappings, public.process_taxonomy) still in
--      "Post Processing" are deleted where migration 790 already re-homed the
--      same operation elsewhere. A wired row with no re-homed copy stops the
--      migration instead (the guard below) - run migration 790 first.
--   4. public.process_calculator_mappings.lhr_process_group "Post Processing" is
--      cleared: labour is the own rate of each machine; nothing reads this column.
--
-- Lines with cycle_time <= 0 are not touched: they break ck_pcr_cycle_time_positive
-- (migration 717 added it NOT VALID for two legacy fixture lines of 2026-07-12),
-- and Postgres re-checks that constraint on any update of the row. Their fate
-- is a separate decision; the second verify query below lists them.
--
-- One transaction (the SQL editor runs the file as one): the guard failing
-- rolls everything back. Idempotent.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.process_calculator_mappings m
    WHERE m.process_group = 'Post Processing' AND m.calculator_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.process_calculator_mappings x
        WHERE x.process_group <> 'Post Processing' AND x.operation = m.operation
          AND x.machine_class IS NOT DISTINCT FROM m.machine_class)
  ) THEN
    RAISE EXCEPTION 'Migration 839: a wired Post Processing catalog row has no re-homed copy. Run migration 790 first.';
  END IF;
END $$;

-- 1. Lines linked to a machine: the HR Rates group of that machine.
UPDATE public.process_cost_records pcr
SET process_group = coalesce(nullif(m.process_group, ''), nullif(m.commodity_code, ''))
FROM public.mhr_records m
WHERE m.id::text = pcr.mhr_id::text
  AND coalesce(nullif(m.process_group, ''), nullif(m.commodity_code, '')) IS NOT NULL
  AND pcr.process_group IS DISTINCT FROM coalesce(nullif(m.process_group, ''), nullif(m.commodity_code, ''))
  AND pcr.cycle_time > 0;

-- 2. Lines with no machine, on a group HR Rates does not have: cleared.
UPDATE public.process_cost_records pcr
SET process_group = NULL
WHERE pcr.process_group IS NOT NULL
  AND pcr.cycle_time > 0
  AND NOT EXISTS (SELECT 1 FROM public.mhr_records m WHERE m.id::text = pcr.mhr_id::text)
  AND NOT EXISTS (
    SELECT 1 FROM public.mhr_records m
    WHERE coalesce(nullif(m.process_group, ''), nullif(m.commodity_code, '')) = pcr.process_group);

-- 3. Catalog rows left in Post Processing (their operation lives elsewhere now).
DELETE FROM public.process_calculator_mappings m
WHERE m.process_group = 'Post Processing';

DELETE FROM public.process_taxonomy t
WHERE t.process_group = 'Post Processing'
  AND NOT EXISTS (SELECT 1 FROM public.mhr_records r WHERE r.canonical_process_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.process_calculator_mappings m WHERE m.canonical_process_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.process_taxonomy_operations o WHERE o.canonical_process_id = t.id);

-- 4. Unused labour-tier label.
UPDATE public.process_calculator_mappings
SET lhr_process_group = NULL
WHERE lhr_process_group = 'Post Processing';

NOTIFY pgrst, 'reload schema';

-- Verify (all four expect 0):
-- SELECT
--   (SELECT count(*) FROM public.process_cost_records pcr WHERE pcr.process_group IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM public.mhr_records m WHERE coalesce(nullif(m.process_group, ''), nullif(m.commodity_code, '')) = pcr.process_group)) AS lines_on_groups_not_in_hr_rates,
--   (SELECT count(*) FROM public.process_calculator_mappings WHERE process_group = 'Post Processing' OR lhr_process_group = 'Post Processing') AS catalog_post_processing,
--   (SELECT count(*) FROM public.process_taxonomy WHERE process_group = 'Post Processing') AS taxonomy_post_processing,
--   (SELECT count(*) FROM public.process_cost_records WHERE process_group = 'Post Processing') AS lines_post_processing;
-- (the counts above include the legacy cycle_time <= 0 lines, listed here:)
-- SELECT id, bom_item_id, operation, process_group, cycle_time, created_at FROM public.process_cost_records WHERE cycle_time <= 0;
