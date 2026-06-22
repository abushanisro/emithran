-- Migration 175: Seed India INR 2026 raw material prices
--
-- Context: Migration 154 seeded 75+ materials in USD (Q1-2025 global commodity pricing).
-- The material ranker uses locationFitScore — India-located records score 0.9 vs 0.5
-- for global (NULL location) records, so these INR records rank ABOVE the USD baseline
-- for any Indian manufacturing org.
--
-- Prices: mid-2026 India market rates (ex-GST), verified against:
--   Tata Nexarc, Steeltube, IndiaMART, Comaron, Sachiya Steel, Worth Will (June 2026).
-- Currency: INR. Country: IN. Location: India.
--
-- Run order: 155 → 153 → 154 → 156 → 175
-- Safe to re-run: all inserts guarded by WHERE NOT EXISTS on (material, material_grade, currency, country_code).

-- ── Idempotent column guard (in case migration 154's prerequisites weren't run) ──
ALTER TABLE raw_materials
  ADD COLUMN IF NOT EXISTS material_form   VARCHAR(30)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS material_family VARCHAR(30)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS price_source    VARCHAR(20)  DEFAULT 'BENCHMARK',
  ADD COLUMN IF NOT EXISTS price_version   VARCHAR(20)  DEFAULT 'Q1-2025';

-- ── Insert India INR 2026 records ─────────────────────────────────────────────────
INSERT INTO raw_materials
  (user_id, is_global,
   material_group, material, material_grade,
   density_kg_m3, cost, currency, country_code, location,
   material_form, material_family, price_source, price_version)

SELECT
  m.user_id, m.is_global,
  m.material_group, m.material, m.material_grade,
  m.density_kg_m3, m.cost, m.currency, m.country_code, m.location,
  m.material_form, m.material_family, m.price_source, m.price_version
FROM (VALUES

  -- ── MILD / STRUCTURAL STEEL — SHEET ──────────────────────────────────────────
  -- CRCA: Cold Rolled Close Annealed. Most common sheet metal blank in India.
  -- Source: IndiaMART, June 2026. Range ₹42-54/kg; mid-gauge ₹52/kg.
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'CRCA Steel', 'IS513 CR2 - Cold Rolled Close Annealed',
   7850, 52.00, 'INR', 'IN', 'India',
   'Sheet', 'sheet_metal', 'BENCHMARK', 'Q2-2026'),

  -- HR Sheet (Hot Rolled): slightly cheaper than CRCA, used where surface finish is not critical.
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'HRCA Steel', 'IS10748 HR2 - Hot Rolled Close Annealed',
   7850, 48.00, 'INR', 'IN', 'India',
   'Sheet', 'sheet_metal', 'BENCHMARK', 'Q2-2026'),

  -- MS Sheet IS2062 E250A: structural grade; laser-cut brackets, frames.
  -- Source: Tata Nexarc, June 2026. HR coil ₹52-58/kg; using mid ₹55.
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'Mild Steel IS2062', 'E250A - Sheet',
   7850, 55.00, 'INR', 'IN', 'India',
   'Sheet', 'sheet_metal', 'BENCHMARK', 'Q2-2026'),

  -- MS Plate IS2062 E350: high-strength structural, thicker laser/plasma cuts.
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'Mild Steel IS2062', 'E350 - High Strength Plate',
   7850, 62.00, 'INR', 'IN', 'India',
   'Plate', 'sheet_metal', 'BENCHMARK', 'Q2-2026'),

  -- GI Sheet (Galvanized Iron / Steel): enclosures, cabinets.
  -- Source: ThePipingMart, May 2026. Plain GI ₹70/kg.
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'Galvanised Steel', 'IS277 Z120 - GI Sheet',
   7850, 70.00, 'INR', 'IN', 'India',
   'Sheet', 'sheet_metal', 'BENCHMARK', 'Q2-2026'),

  -- ── STAINLESS STEEL — SHEET ───────────────────────────────────────────────────
  -- SS304 2B: most common stainless sheet; food/pharma/general fabrication.
  -- Source: Steeltube, June 9 2026. Range ₹146-170/kg; using mid ₹160.
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'Stainless Steel SS304', '2B Finish Sheet',
   8000, 160.00, 'INR', 'IN', 'India',
   'Sheet', 'sheet_metal', 'BENCHMARK', 'Q2-2026'),

  -- SS316 2B: molybdenum-bearing; marine, chemical equipment.
  -- Source: Steeltube 2026. ₹220-240/kg; using ₹225.
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'Stainless Steel SS316', '2B Finish Sheet',
   8000, 225.00, 'INR', 'IN', 'India',
   'Sheet', 'sheet_metal', 'BENCHMARK', 'Q2-2026'),

  -- SS316L: low-carbon weldable; critical weld joints.
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'Stainless Steel SS316L', 'Weldable Sheet',
   8000, 235.00, 'INR', 'IN', 'India',
   'Sheet', 'sheet_metal', 'BENCHMARK', 'Q2-2026'),

  -- SS430: ferritic, magnetic, cheaper than 304; decorative/appliance panels.
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'Stainless Steel SS430', 'Ferritic Sheet',
   7700, 140.00, 'INR', 'IN', 'India',
   'Sheet', 'sheet_metal', 'BENCHMARK', 'Q2-2026'),

  -- ── ALUMINIUM — SHEET ─────────────────────────────────────────────────────────
  -- Al 5052 H32: most weldable aluminium sheet; enclosures, marine.
  -- Source: Worth Will, 2026. ₹240-250/kg; using ₹245.
  (NULL::uuid, TRUE,
   'Non-Ferrous Metals', 'Aluminium 5052', 'H32 - Sheet',
   2680, 245.00, 'INR', 'IN', 'India',
   'Sheet', 'sheet_metal', 'BENCHMARK', 'Q2-2026'),

  -- Al 6061 T6 Sheet: general fabrication, anodising applications.
  -- Source: Sachiya Steel 2026. ₹255-265/kg; using ₹260.
  (NULL::uuid, TRUE,
   'Non-Ferrous Metals', 'Aluminium 6061', 'T6 - Sheet',
   2700, 260.00, 'INR', 'IN', 'India',
   'Sheet', 'sheet_metal', 'BENCHMARK', 'Q2-2026'),

  -- Al 7075 T6 Sheet: aerospace/high-strength; expensive.
  (NULL::uuid, TRUE,
   'Non-Ferrous Metals', 'Aluminium 7075', 'T6 - Sheet',
   2810, 420.00, 'INR', 'IN', 'India',
   'Sheet', 'sheet_metal', 'BENCHMARK', 'Q2-2026'),

  -- ── MILD / STRUCTURAL STEEL — BAR (CNC TURNING / MILLING) ────────────────────
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'Mild Steel IS2062', 'E250A - Round Bar',
   7850, 58.00, 'INR', 'IN', 'India',
   'Bar', 'machining', 'BENCHMARK', 'Q2-2026'),

  -- ── ALLOY STEEL — BAR ────────────────────────────────────────────────────────
  -- EN8 C45: most common medium-carbon bar for shafts, studs.
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'EN8 Steel', 'C45 / 080M40 - Round Bar',
   7830, 85.00, 'INR', 'IN', 'India',
   'Bar', 'machining', 'BENCHMARK', 'Q2-2026'),

  -- EN19 4140 Cr-Mo: gears, spindles, high-tensile fasteners.
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'EN19 Steel', '4140 Cr-Mo - Round Bar',
   7830, 115.00, 'INR', 'IN', 'India',
   'Bar', 'machining', 'BENCHMARK', 'Q2-2026'),

  -- EN24 4340 Ni-Cr-Mo: heavy-duty shafts, aerospace components.
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'EN24 Steel', '4340 Ni-Cr-Mo - Round Bar',
   7830, 135.00, 'INR', 'IN', 'India',
   'Bar', 'machining', 'BENCHMARK', 'Q2-2026'),

  -- EN31 52100 Bearing Steel: precision bearing rings, races.
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'EN31 Steel', '52100 Bearing Steel - Round Bar',
   7810, 150.00, 'INR', 'IN', 'India',
   'Bar', 'machining', 'BENCHMARK', 'Q2-2026'),

  -- ── STAINLESS STEEL — BAR ────────────────────────────────────────────────────
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'Stainless Steel SS304', 'Round Bar',
   8000, 245.00, 'INR', 'IN', 'India',
   'Bar', 'machining', 'BENCHMARK', 'Q2-2026'),

  (NULL::uuid, TRUE,
   'Ferrous Metals', 'Stainless Steel SS316', 'Round Bar',
   8000, 280.00, 'INR', 'IN', 'India',
   'Bar', 'machining', 'BENCHMARK', 'Q2-2026'),

  -- SS410 martensitic: valve bodies, cutlery (machineable SS).
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'Stainless Steel SS410', 'Martensitic Round Bar',
   7740, 195.00, 'INR', 'IN', 'India',
   'Bar', 'machining', 'BENCHMARK', 'Q2-2026'),

  -- ── ALUMINIUM — BAR ──────────────────────────────────────────────────────────
  (NULL::uuid, TRUE,
   'Non-Ferrous Metals', 'Aluminium 6061', 'T6 - Round Bar',
   2700, 260.00, 'INR', 'IN', 'India',
   'Bar', 'machining', 'BENCHMARK', 'Q2-2026'),

  (NULL::uuid, TRUE,
   'Non-Ferrous Metals', 'Aluminium 7075', 'T651 - Round Bar',
   2810, 360.00, 'INR', 'IN', 'India',
   'Bar', 'machining', 'BENCHMARK', 'Q2-2026'),

  -- ── CAST IRON ────────────────────────────────────────────────────────────────
  (NULL::uuid, TRUE,
   'Ferrous Metals', 'Grey Cast Iron', 'IS210 FG260',
   7200, 48.00, 'INR', 'IN', 'India',
   'Casting', 'casting', 'BENCHMARK', 'Q2-2026'),

  (NULL::uuid, TRUE,
   'Ferrous Metals', 'SG Iron', 'IS1865 SG500 - Ductile Iron',
   7100, 58.00, 'INR', 'IN', 'India',
   'Casting', 'casting', 'BENCHMARK', 'Q2-2026'),

  -- ── COPPER ALLOYS ────────────────────────────────────────────────────────────
  -- Brass 70/30: common turned parts, fittings.
  (NULL::uuid, TRUE,
   'Non-Ferrous Metals', 'Brass', 'CuZn30 70/30 - Round Bar',
   8530, 520.00, 'INR', 'IN', 'India',
   'Bar', 'machining', 'BENCHMARK', 'Q2-2026'),

  -- Free Cutting Brass: highest machinability rating.
  (NULL::uuid, TRUE,
   'Non-Ferrous Metals', 'Brass', 'CuZn39Pb3 Free Cutting - Bar',
   8500, 540.00, 'INR', 'IN', 'India',
   'Bar', 'machining', 'BENCHMARK', 'Q2-2026'),

  -- Electrolytic Copper: bus bars, electrical contacts.
  (NULL::uuid, TRUE,
   'Non-Ferrous Metals', 'Copper', 'C11000 ETP - Flat / Bar',
   8960, 840.00, 'INR', 'IN', 'India',
   'Bar', 'general', 'BENCHMARK', 'Q2-2026')

) AS m(user_id, is_global,
        material_group, material, material_grade,
        density_kg_m3, cost, currency, country_code, location,
        material_form, material_family, price_source, price_version)

WHERE NOT EXISTS (
  SELECT 1 FROM raw_materials r
  WHERE r.material      = m.material
    AND r.material_grade = m.material_grade
    AND r.currency      = m.currency
    AND r.country_code  = m.country_code
);

-- ── Verify ────────────────────────────────────────────────────────────────────
-- Run this after migration to confirm records were inserted:
--
-- SELECT material_family, currency, COUNT(*) AS n,
--        STRING_AGG(material || ' (' || material_grade || ') ₹' || cost::int::text, E'\n' ORDER BY material)
-- FROM   raw_materials
-- WHERE  currency = 'INR' AND country_code = 'IN'
-- GROUP  BY material_family, currency
-- ORDER  BY material_family;
