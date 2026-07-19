-- Migration 347: Normalize material_grade strings across all raw_materials rows
--
-- Root cause: migration 154 (USD/GL) and migration 175 (INR/IN) inserted rows for
-- the same physical materials with inconsistent grade strings. Migration 175 embedded
-- the form into the grade (e.g. "Martensitic Round Bar") or truncated suffixes
-- ("Weldable Sheet" vs "Weldable Sheet / Plate") instead of using the canonical
-- grade-only format from migration 154. This caused duplicates in the Likely Materials
-- panel because the ranker saw two distinct-grade rows for the same product.
--
-- Fix: update every non-canonical grade string to match the migration 154 canonical form.
-- Scope: WHERE material_grade = '<exact 175 string>' to avoid touching unrelated rows.

-- SS304 sheet: "2B Finish Sheet" → "2B Finish"
UPDATE raw_materials
SET material_grade = '2B Finish', last_updated = NOW()
WHERE material ILIKE '%SS304%'
  AND material_grade = '2B Finish Sheet';

-- SS304 bar: "Round Bar" (bare, no "/ Hex") → "Round / Hex Bar"
UPDATE raw_materials
SET material_grade = 'Round / Hex Bar', last_updated = NOW()
WHERE material ILIKE '%SS304%'
  AND material_grade = 'Round Bar';

-- SS316 sheet: "2B Finish Sheet" → "2B Finish"  (same pattern as SS304)
UPDATE raw_materials
SET material_grade = '2B Finish', last_updated = NOW()
WHERE material ILIKE '%SS316%'
  AND material NOT ILIKE '%316L%'
  AND material_grade = '2B Finish Sheet';

-- SS316L sheet: "Weldable Sheet" → "Weldable Sheet / Plate"
UPDATE raw_materials
SET material_grade = 'Weldable Sheet / Plate', last_updated = NOW()
WHERE material ILIKE '%SS316L%'
  AND material_grade = 'Weldable Sheet';

-- SS410 bar: "Martensitic Round Bar" (no hyphen) → "Martensitic - Round Bar"
UPDATE raw_materials
SET material_grade = 'Martensitic - Round Bar', last_updated = NOW()
WHERE material ILIKE '%SS410%'
  AND material_grade = 'Martensitic Round Bar';

-- Mild Steel IS2062 sheet: "E250A - Sheet" → "E250A"  (form belongs in material_form)
UPDATE raw_materials
SET material_grade = 'E250A', last_updated = NOW()
WHERE material ILIKE '%IS2062%'
  AND material_grade = 'E250A - Sheet';

-- Mild Steel IS2062 bar: "E250A - Round Bar" → "E250A"
UPDATE raw_materials
SET material_grade = 'E250A', last_updated = NOW()
WHERE material ILIKE '%IS2062%'
  AND material_grade = 'E250A - Round Bar';

-- CRCA Steel: "IS513 CR2 - Cold Rolled Close Annealed" → "IS513 CR2 - Cold Rolled"
UPDATE raw_materials
SET material_grade = 'IS513 CR2 - Cold Rolled', last_updated = NOW()
WHERE material ILIKE '%CRCA%'
  AND material_grade = 'IS513 CR2 - Cold Rolled Close Annealed';

-- HRCA Steel: "IS10748 HR2 - Hot Rolled Close Annealed" → "IS10748 HR - Hot Rolled"
UPDATE raw_materials
SET material_grade = 'IS10748 HR - Hot Rolled', last_updated = NOW()
WHERE material ILIKE '%HRCA%'
  AND material_grade = 'IS10748 HR2 - Hot Rolled Close Annealed';

-- EN8 Steel: "C45 / 080M40 - Round Bar" → "C45 / 080M40"
UPDATE raw_materials
SET material_grade = 'C45 / 080M40', last_updated = NOW()
WHERE material ILIKE '%EN8%'
  AND material_grade = 'C45 / 080M40 - Round Bar';

-- EN19 Steel: "4140 Cr-Mo - Round Bar" → "4140 Cr-Mo Alloy"
UPDATE raw_materials
SET material_grade = '4140 Cr-Mo Alloy', last_updated = NOW()
WHERE material ILIKE '%EN19%'
  AND material_grade = '4140 Cr-Mo - Round Bar';

-- EN24 Steel: "4340 Ni-Cr-Mo - Round Bar" → "4340 Ni-Cr-Mo"
UPDATE raw_materials
SET material_grade = '4340 Ni-Cr-Mo', last_updated = NOW()
WHERE material ILIKE '%EN24%'
  AND material_grade = '4340 Ni-Cr-Mo - Round Bar';

-- EN31 Steel: "52100 Bearing Steel - Round Bar" → "52100 Bearing Steel"
UPDATE raw_materials
SET material_grade = '52100 Bearing Steel', last_updated = NOW()
WHERE material ILIKE '%EN31%'
  AND material_grade = '52100 Bearing Steel - Round Bar';

-- Aluminium 6061 sheet: "T6 - Sheet" → "T6 - Sheet / Plate"
UPDATE raw_materials
SET material_grade = 'T6 - Sheet / Plate', last_updated = NOW()
WHERE material ILIKE '%6061%'
  AND material_grade = 'T6 - Sheet';

-- Aluminium 6061 bar: "T6 - Round Bar" → "T6 - Round / Hex Bar"
UPDATE raw_materials
SET material_grade = 'T6 - Round / Hex Bar', last_updated = NOW()
WHERE material ILIKE '%6061%'
  AND material_grade = 'T6 - Round Bar';

-- Aluminium 7075 sheet: "T6 - Sheet" → "T6 - Sheet / Plate"
UPDATE raw_materials
SET material_grade = 'T6 - Sheet / Plate', last_updated = NOW()
WHERE material ILIKE '%7075%'
  AND material_grade = 'T6 - Sheet';

-- SG Iron: "IS1865 SG500 - Ductile Iron" → "IS1865 SG500"
UPDATE raw_materials
SET material_grade = 'IS1865 SG500', last_updated = NOW()
WHERE (material ILIKE '%SG Iron%' OR material ILIKE '%Ductile Iron%' OR material ILIKE '%SG500%')
  AND material_grade = 'IS1865 SG500 - Ductile Iron';

-- Sanity check: count rows where grade still contains a form keyword that shouldn't be there.
-- Run manually after deploy to verify. Expected: 0 rows for each.
-- SELECT material, material_grade, COUNT(*) FROM raw_materials
--   WHERE material_grade ILIKE '%- Round Bar' OR material_grade ILIKE '%- Sheet'
--   GROUP BY material, material_grade ORDER BY material;
