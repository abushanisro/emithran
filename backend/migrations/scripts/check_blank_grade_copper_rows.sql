-- Diagnostic query only — not a migration, doesn't modify data.
-- Run this in your SQL editor and paste the result back.
-- Purpose: find every 'Generic Copper, ...' row and its material_grade,
-- created_at, and price_source, to determine which rows came from
-- migration 590 (real, grade-populated) vs. an older bulk import
-- (blank grade, possibly fabricated placeholder properties).

SELECT id, material, material_grade, material_type, density_kg_m3,
       ultimate_tensile_strength, yield_tensile_strength, hardness,
       cost, cost_usa, price_source, created_at
FROM raw_materials
WHERE material ILIKE 'Generic Copper%'
   OR material ILIKE 'Copper, UNS%'
ORDER BY material;
