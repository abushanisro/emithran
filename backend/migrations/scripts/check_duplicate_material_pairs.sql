-- Diagnostic query only — not a migration, doesn't modify data.
-- Run this in your SQL editor (Supabase) and paste the result back to Claude.
-- Purpose: compare live values for every known duplicate material pair
-- (short-name rows like 'SS304' vs. the newer 'Generic Stainless Steel,
-- AISI 304' style rows from migration 590) to see which pairs actually
-- differ before deciding how to reconcile them.

SELECT pair, side, material, material_grade, ultimate_tensile_strength AS uts, yield_tensile_strength AS yts, density_kg_m3, cost, cost_usa
FROM raw_materials, (VALUES
  ('6061', 'AA6061-T6'), ('6061', 'AA6061-T4'), ('6061', 'AA6061-O'), ('6061', 'Generic Aluminum, ANSI 6061'),
  ('6082', 'AA6082-T6'), ('6082', 'Generic Aluminum, ANSI 6082'),
  ('6060', 'AA6060-T6'), ('6060', 'Generic Aluminum, ANSI 6060'),
  ('7075', 'AA7075-T6'), ('7075', 'AA7075-T651'), ('7075', 'Generic Aluminum, ANSI 7075'),
  ('2024', 'AA2024-T3'), ('2024', 'AA2024-T351'), ('2024', 'Generic Aluminum, ANSI 2024'),
  ('5052', 'AA5052-H32'), ('5052', 'Generic Aluminum, ANSI 5052'),
  ('5083', 'AA5083-H111'), ('5083', 'Generic Aluminum, ANSI 5083'),
  ('5754', 'AA5754-H22'), ('5754', 'Generic Aluminum, ANSI 5754'),
  ('3003', 'AA3003-H14'), ('3003', 'Generic Aluminum, ANSI 3003'),
  ('1100', 'AA1100-H14'), ('1100', 'Generic Aluminum, AA 1100'),
  ('SS304', 'SS304'), ('SS304', 'Generic Stainless Steel, AISI 304'),
  ('SS304L', 'SS304L'), ('SS304L', 'Generic Stainless Steel, AISI 304L'),
  ('SS316', 'SS316'), ('SS316', 'Generic Stainless Steel, AISI 316'),
  ('SS316L', 'SS316L'), ('SS316L', 'Generic Stainless Steel, AISI 316L'),
  ('SS321', 'SS321'), ('SS321', 'Generic Stainless Steel, AISI 321'),
  ('1018', 'SAE 1018'), ('1018', 'Generic Steel, Cold Worked, AISI 1018'), ('1018', 'Generic Steel, Hot Worked, AISI 1018'),
  ('1020', 'SAE 1020'), ('1020', 'Generic Steel, Cold Worked, AISI 1020'), ('1020', 'Generic Steel, Hot Worked, AISI 1020'),
  ('1045', 'SAE 1045'), ('1045', 'Generic Steel, Hot Worked, AISI 1045'),
  ('4140', 'SAE 4140'), ('4140', 'Generic Steel, AISI 4140, Medium-Carbon'), ('4140', 'Generic Steel, Hot Worked, AISI 4140'),
  ('4340', 'SAE 4340'), ('4340', 'Generic Steel, Cold Worked, AISI 4340'),
  ('C11000', 'C11000 Copper'), ('C11000', 'Generic Copper, UNS C11000'),
  ('C36000', 'C36000 Brass'), ('C36000', 'Generic Brass, UNS C36000')
) AS pairs(pair, side)
WHERE raw_materials.material = pairs.side
ORDER BY pair, material;
