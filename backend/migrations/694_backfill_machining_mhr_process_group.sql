-- ============================================================================
-- Migration 694: Backfill process_group='Machining' on migration 693's rows
-- ============================================================================
-- Root cause of "Machining still not showing on HR Rates" after migration
-- 693 successfully inserted 141 real rows: process_group is a real, direct
-- column on mhr_records (confirmed in mhr.service.ts -- selected directly,
-- set on create/update, no CHECK constraint restricting its values), but
-- migration 693's column list never set it.
--
-- Migration 633's own Injection Molding seed had this identical gap --
-- already found and fixed earlier this session by migration 646 (backfill
-- to 'Plastic & Rubber') and migration 647 (rename to today's canonical
-- 'Plastic Molding'). This migration is the same fix for Machining.
--
-- The frontend's effectiveProcessGroupOf() (app/(dashboard)/hr-rates/
-- page.tsx) falls back to commodityCode, then '-', when processGroup is
-- NULL -- so the 141 real machines landed in the table but were invisible
-- as "Machining": no new process-group dropdown option, no new category
-- sidebar section.
--
-- Scoped via process_family = 'machined' -- a value only migration 693's
-- 141 rows carry (chosen deliberately as a safe, unique marker for exactly
-- this purpose) -- not a broader machine_class/benchmark_source_key
-- pattern match, so this cannot touch any other row.
-- ============================================================================

UPDATE mhr_records
SET process_group = 'Machining'
WHERE process_family = 'machined'
  AND process_group IS NULL;

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after):
-- SELECT count(*) FROM mhr_records WHERE process_group = 'Machining'; -- expect 141
-- SELECT process_group, count(*) FROM mhr_records WHERE process_family = 'machined' GROUP BY process_group; -- expect one row: Machining, 141
