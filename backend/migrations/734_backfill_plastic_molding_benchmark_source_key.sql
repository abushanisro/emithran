-- ============================================================================
-- Migration 734: Backfill mhr_records.benchmark_source_key for the Plastic
-- Molding domain (Injection/Compression/Reaction Injection/Structural Foam
-- Molding), so mhrCategoryOf() resolves an explicit, real per-class category
-- instead of relying on its humanize-the-slug fallback.
-- ============================================================================
--
-- ROOT CAUSE
--
-- mhrCategoryOf() (lib/utils/mhrCategoryOf.ts) — the one resolver the Add
-- Process dialog's Category picker and HR Rates both use — reads
-- benchmark_source_key ("<category>:<machine name>") FIRST, falling back to
-- a humanized machine_class slug only when that column is NULL. Migration
-- 633 staged all 127 real Plastic Molding domain machines (injection_
-- molding/compression_molding/reaction_injection_molding/structural_foam_
-- molding) without ever populating benchmark_source_key — confirmed
-- directly: migration 633's own INSERT column list has no such column, and
-- migration 645's own comment says so explicitly ("no benchmark_source_key
-- category-prefix matching needed here... unlike Sheet Metal's 15
-- categories" — true for that migration's own purpose, wage-grade backfill,
-- since every row in one machine_class shares one wage grade regardless of
-- category source).
--
-- The humanize-the-slug fallback (VERIFIED_CLASS_CATEGORY miss ->
-- humanizeMachineClass) happens to already produce the right string for
-- each of these 4 classes (injection_molding -> "Injection Molding", etc. —
-- the slugs were named to match). This migration makes that explicit and
-- real rather than relying on that naming coincidence — the same real,
-- durable pattern Sheet Metal already uses (benchmark_source_key), sourced
-- directly from the same reference files migration 633 was generated from:
-- each of the 4 real machine files (memory/plastic modeling/machine/
-- {injection_molding,compression_molding,reaction_injection_molding,
-- structural_foam_molding}_machines.json) declares its own real, single
-- processCategory at the top level, shared by every machine in that file
-- (verified directly, 2026-09-10): "Injection Molding", "Compression
-- Molding", "Reaction Injection Molding", "Structural Foam Molding"
-- respectively.
--
-- Only fills rows currently NULL — never overwrites a real shop-entered
-- value, same discipline as migration 645.
-- ============================================================================

UPDATE mhr_records
SET benchmark_source_key = 'Injection Molding:' || machine_name
WHERE benchmark_source_key IS NULL AND machine_class = 'injection_molding';

UPDATE mhr_records
SET benchmark_source_key = 'Compression Molding:' || machine_name
WHERE benchmark_source_key IS NULL AND machine_class = 'compression_molding';

UPDATE mhr_records
SET benchmark_source_key = 'Reaction Injection Molding:' || machine_name
WHERE benchmark_source_key IS NULL AND machine_class = 'reaction_injection_molding';

UPDATE mhr_records
SET benchmark_source_key = 'Structural Foam Molding:' || machine_name
WHERE benchmark_source_key IS NULL AND machine_class = 'structural_foam_molding';

-- Verification (run manually after):
-- SELECT machine_class, count(*) AS rows, count(DISTINCT benchmark_source_key) AS distinct_keys
--   FROM mhr_records
--   WHERE machine_class IN ('injection_molding','compression_molding','reaction_injection_molding','structural_foam_molding')
--   GROUP BY machine_class ORDER BY machine_class;
-- -- Expect distinct_keys == rows for each class (one real "<category>:<machine name>" per machine).
