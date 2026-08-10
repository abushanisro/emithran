-- ===================================================================================
-- Migration 385: Elastic modulus / Poisson's ratio for non-aluminum metal families (2026-07-30)
--
-- Same reasoning as migration 384's aluminum backfill: elastic modulus and
-- Poisson's ratio are near-invariant WITHIN a metal family (dominated by the
-- base metal's crystal structure, not by alloying/strength-affecting
-- additions), so a single verified per-family value is a real engineering
-- approximation, not a per-alloy guess. Sources: AmesWeb / EngineeringToolbox
-- / Sonelastic standard materials-property references, cross-checked across
-- multiple values per family where available.
--
-- Deliberately EXCLUDED from this migration:
--   Gray Cast Iron -- elastic modulus varies too much by grade to treat as one
--     constant (roughly 100-130 GPa across ASTM A48 classes, driven by
--     graphite flake morphology, unlike other metals here). Needs per-grade
--     data, not a blanket value.
--   Cobalt Chrome, Manganese, Lead, Maraging Steel -- too few rows (1-2 each)
--     and specialized enough that a quick web reference isn't a confident
--     enough source; left for individual verification if/when needed.
--   All Plastic & Rubber materials -- polymer modulus is highly dependent on
--     formulation, fillers, and fiber reinforcement; there is no valid
--     per-family constant the way there is for metals. Not touched here.
--
-- Values used (material_type -> E in GPa, Poisson's ratio):
--   Steel / Low-Alloy Steel / Unalloyed Steel / Galvanized Steel: 200 GPa, 0.29
--   Stainless Steel: 193 GPa, 0.27
--   Copper: 115 GPa, 0.34
--   Brass / Silicon Brass: 110 GPa, 0.34
--   Bronze / Aluminum Bronze: 110 GPa, 0.34
--   Ductile Iron: 168 GPa, 0.28
--   Malleable Cast Iron: 172 GPa, 0.28
--   Titanium / Titanium Alloy: 114 GPa, 0.33  (Ti-6Al-4V reference values)
--   Magnesium: 45 GPa, 0.35
--   Zinc / Zinc-Aluminum: 99.3 GPa, 0.25
-- ===================================================================================

UPDATE raw_materials
SET elastic_modulus_gpa = 200, poisson_ratio = 0.29
WHERE material_type IN ('Steel', 'Low-Alloy Steel', 'Unalloyed Steel', 'Galvanized Steel')
  AND elastic_modulus_gpa IS NULL;

UPDATE raw_materials
SET elastic_modulus_gpa = 193, poisson_ratio = 0.27
WHERE material_type = 'Stainless Steel'
  AND elastic_modulus_gpa IS NULL;

UPDATE raw_materials
SET elastic_modulus_gpa = 115, poisson_ratio = 0.34
WHERE material_type = 'Copper'
  AND elastic_modulus_gpa IS NULL;

UPDATE raw_materials
SET elastic_modulus_gpa = 110, poisson_ratio = 0.34
WHERE material_type IN ('Brass', 'Silicon Brass', 'Bronze', 'Aluminum Bronze')
  AND elastic_modulus_gpa IS NULL;

UPDATE raw_materials
SET elastic_modulus_gpa = 168, poisson_ratio = 0.28
WHERE material_type = 'Ductile Iron'
  AND elastic_modulus_gpa IS NULL;

UPDATE raw_materials
SET elastic_modulus_gpa = 172, poisson_ratio = 0.28
WHERE material_type = 'Malleable Cast Iron'
  AND elastic_modulus_gpa IS NULL;

UPDATE raw_materials
SET elastic_modulus_gpa = 114, poisson_ratio = 0.33
WHERE material_type IN ('Titanium', 'Titanium Alloy')
  AND elastic_modulus_gpa IS NULL;

UPDATE raw_materials
SET elastic_modulus_gpa = 45, poisson_ratio = 0.35
WHERE material_type = 'Magnesium'
  AND elastic_modulus_gpa IS NULL;

UPDATE raw_materials
SET elastic_modulus_gpa = 99.3, poisson_ratio = 0.25
WHERE material_type IN ('Zinc', 'Zinc-Aluminum')
  AND elastic_modulus_gpa IS NULL;

-- Verification:
-- SELECT material_type, count(*), elastic_modulus_gpa, poisson_ratio
--   FROM raw_materials
--   WHERE elastic_modulus_gpa IS NOT NULL
--   GROUP BY material_type, elastic_modulus_gpa, poisson_ratio
--   ORDER BY material_type;
-- Still-missing families after this migration (by design, see header):
-- SELECT material_type, count(*) FROM raw_materials
--   WHERE elastic_modulus_gpa IS NULL AND material_group = 'Ferrous & Non-Ferrous'
--   GROUP BY material_type ORDER BY count(*) DESC;
