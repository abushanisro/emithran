-- ============================================================================
-- Migration 645: Backfill mhr_records.wage_grade for Injection Molding
--
-- Real per-process wage grade, sourced from memory/Injection/wagegrade.png
-- (staged as im_reference_data category='wage_grade' by migration 642),
-- with Compression Molding / Reaction Injection Molding's values confirmed
-- directly by the user. Unlike Sheet Metal's migration 643 (which replaced
-- migration 577's FABRICATED Skilled/Semi-Skilled/Unskilled guesses),
-- mhr_records.wage_grade has never been populated for Injection Molding at
-- all -- this is a pure backfill of real data into all-NULL rows, not a
-- correction.
--
-- Migration 633's 127 real IM machine rows already carry a direct, exact
-- machine_class per row (injection_molding / compression_molding /
-- structural_foam_molding / reaction_injection_molding) -- no
-- benchmark_source_key category-prefix matching needed here, unlike Sheet
-- Metal's 15 categories.
--
-- Only fills rows currently NULL -- never overwrites a real shop-entered
-- value, same discipline as every prior wage_grade migration.
-- ============================================================================

UPDATE mhr_records SET wage_grade = '3 - Plastic'
WHERE wage_grade IS NULL AND machine_class = 'injection_molding';

UPDATE mhr_records SET wage_grade = '1 - Plastic'
WHERE wage_grade IS NULL AND machine_class = 'compression_molding';

UPDATE mhr_records SET wage_grade = '3 - Plastic'
WHERE wage_grade IS NULL AND machine_class = 'structural_foam_molding';

UPDATE mhr_records SET wage_grade = '3 - Plastic'
WHERE wage_grade IS NULL AND machine_class = 'reaction_injection_molding';
