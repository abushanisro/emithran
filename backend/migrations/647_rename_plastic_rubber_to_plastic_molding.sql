-- ============================================================================
-- Migration 647: Rename process_group "Plastic & Rubber" -> "Plastic Molding"
-- ============================================================================
-- Migration 614 already renamed process_calculator_mappings/process_taxonomy
-- from "Plastic & Rubber" to "Injection Molding" once, but only partially
-- took (process_calculator_mappings: fully renamed, 0 rows left; process_
-- taxonomy: only the 4 rows migration 614 targeted directly were renamed —
-- 26 other real rows, plus new ones added by later migrations such as 634's
-- Reaction Injection Molding row, still carry "Plastic & Rubber"). This
-- migration does NOT touch "Injection Molding" process_group values (out of
-- scope, matching the user's earlier explicit "domain heading only, not the
-- specific process_group DB value" decision for that separate rename) — it
-- only retargets the remaining literal "Plastic & Rubber" string, this
-- session's user-requested final name for the domain-level group, wherever
-- it is still real and live:
--
--   process_taxonomy.process_group        (26 rows)
--   mhr_records.process_group             (127 rows — migration 633/646)
--   mhr_benchmark_rates.process_group     (30 rows)
--   lhr_benchmark_rates.process_group     (10 rows)
--
-- lhr_records has 0 rows with either value today — included for safety,
-- a no-op if still empty.
-- ============================================================================

BEGIN;

UPDATE process_taxonomy SET process_group = 'Plastic Molding' WHERE process_group = 'Plastic & Rubber';
UPDATE mhr_records SET process_group = 'Plastic Molding' WHERE process_group = 'Plastic & Rubber';
UPDATE mhr_benchmark_rates SET process_group = 'Plastic Molding' WHERE process_group = 'Plastic & Rubber';
UPDATE lhr_benchmark_rates SET process_group = 'Plastic Molding' WHERE process_group = 'Plastic & Rubber';
UPDATE lhr_records SET process_group = 'Plastic Molding' WHERE process_group = 'Plastic & Rubber';

COMMIT;

-- Verification (run manually after):
-- SELECT process_group, count(*) FROM process_taxonomy WHERE process_group ILIKE '%plastic%' OR process_group ILIKE '%injection%' GROUP BY process_group;
