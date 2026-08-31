-- Verification query only — not a migration, doesn't modify data.
-- Run this in your SQL editor and paste the result back.
-- Confirms migration 600's alias landed: expect exactly 1 row,
-- material = 'SS304', ultimate_tensile_strength = 515.

SELECT alias, alias_normalized, rm.material, rm.ultimate_tensile_strength
FROM material_aliases ma
JOIN raw_materials rm ON rm.id = ma.raw_material_id
WHERE alias_normalized = 'AISI304';
