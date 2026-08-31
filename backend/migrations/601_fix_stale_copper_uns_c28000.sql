-- ============================================================================
-- Migration 601: Correct the stale "Generic Copper, UNS C28000" row
-- ============================================================================
-- Root cause (confirmed live via direct query, not guessed): migration 590
-- intended to insert a real, ASTM/reference-sourced "Generic Copper, UNS
-- C28000" row (material_grade='Copper, UNS C28000', UTS=606, YTS=240,
-- hardness=100 Brinell, cost_usa=10.768 -- see 590.sql's own promoteRows
-- literal for this exact material) but its `WHERE NOT EXISTS (... material =
-- v.material)` dedup guard found a PRE-EXISTING row already named exactly
-- "Generic Copper, UNS C28000" (created 2026-07-18, from an older bulk
-- import -- material_grade NULL, UTS=140, YTS=288, no hardness_system,
-- price_source already 'BENCHMARK'). Migration 590 silently skipped this one
-- row, leaving the old, wrong values live instead of applying the correct
-- replacement that was sitting right there in the same migration.
--
-- Confirmed via direct query (created_at): every other migration-590 copper
-- row (C11000, C18150, C27200, C51900, C62730) landed correctly with
-- material_grade populated and created_at = 2026-08-28 -- C28000 is the ONLY
-- one of the 6 that got silently blocked.
--
-- Fix: UPDATE the existing row (identified by material name + the fact its
-- material_grade is still NULL, so this is a no-op if already corrected) to
-- migration 590's real, intended, ASTM/reference-sourced values -- not a new
-- INSERT (would create a confusing duplicate under an identical name).
--
-- Scope note: 7 OTHER old-import copper rows ("Generic Copper - Expanded",
-- "Generic Copper Panel", "Generic Copper, UNS C11000 (ETP)", "Generic
-- Copper, UNS C18000", "Generic Copper, UNS C27000", "Generic Copper, UNS
-- C51000", "Generic Copper, UNS C62000") also have material_grade=NULL and
-- share suspicious copy-pasted properties (four of them: Panel/C27000/
-- C51000/C62000 share an IDENTICAL UTS=220/YTS=70 -- the same placeholder-
-- data pattern already disclosed for ~20 "Generic Stainless Steel" rows in
-- migration 422's header). NOT touched here -- no real sourced replacement
-- data exists for these codes (they aren't in rawmetalusa.json / migration
-- 590 at all). Per explicit user decision (2026-08-30): user will source
-- real data for these 7 separately; do not fabricate placeholder-of-a-
-- placeholder values to fill the gap.
-- ============================================================================

UPDATE raw_materials
SET
  material_grade = 'Copper, UNS C28000',
  material_type = 'Copper',
  density_kg_m3 = 8930,
  density = 8.93,
  ultimate_tensile_strength = 606,
  yield_tensile_strength = 240,
  shearing_strength = 289,
  hardness = 100,
  hardness_system = 'Brinell',
  elastic_modulus_gpa = 115,
  poisson_ratio = 0.35,
  strength_coeff_k_mpa = 317,
  strain_hardening_exponent_n = 0.34,
  lankford_coefficient_r = 0.99,
  cost = 10.768,
  cost_usa = 10.768,
  currency = 'USD'
WHERE material = 'Generic Copper, UNS C28000'
  AND material_grade IS NULL;

-- Verification:
-- SELECT material, material_grade, ultimate_tensile_strength, yield_tensile_strength, hardness_system, cost_usa
-- FROM raw_materials WHERE material = 'Generic Copper, UNS C28000';
-- Expect exactly 1 row: material_grade = 'Copper, UNS C28000', uts = 606, yts = 240, hardness_system = 'Brinell', cost_usa = 10.768.
