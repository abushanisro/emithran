-- ============================================================================
-- Migration 321: Populate raw_materials with 2026 costs, properties, and
--                sustainability/machinability metadata.
--
-- Section 1 : ADD COLUMN IF NOT EXISTS (safe no-op if already present)
-- Section 2 : UPDATE existing rows — broad ILIKE patterns to survive
--             any naming convention used during the user's Excel import.
-- Section 3 : INSERT missing engineering plastics, superalloys, and
--             tool steels that were never in the original import.
--
-- All prices: 2026 India market estimates (₹/kg for cost_india)
-- price_source = 'Default India Market Estimate 2026-06-30'
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 0 — WIDEN COLUMNS THAT MAY HAVE BEEN CREATED NARROW
-- ALTER COLUMN TYPE is a metadata-only operation for VARCHAR widening
-- (no table rewrite needed). Safe to run even if already wide enough.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE raw_materials ALTER COLUMN material_group       TYPE VARCHAR(255);
ALTER TABLE raw_materials ALTER COLUMN material             TYPE VARCHAR(255);
ALTER TABLE raw_materials ALTER COLUMN material_grade       TYPE VARCHAR(255);
ALTER TABLE raw_materials ALTER COLUMN material_type        TYPE VARCHAR(255);
ALTER TABLE raw_materials ALTER COLUMN material_description TYPE TEXT;
ALTER TABLE raw_materials ALTER COLUMN stock_form           TYPE VARCHAR(100);
ALTER TABLE raw_materials ALTER COLUMN matl_state           TYPE VARCHAR(100);
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS price_source VARCHAR(120);
ALTER TABLE raw_materials ALTER COLUMN price_source         TYPE VARCHAR(120);

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1 — ADD NEW METADATA COLUMNS
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS price_source          VARCHAR(120);
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS price_date            DATE;
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS last_updated          TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS yield_factor          DECIMAL(5,4)  DEFAULT 0.85;
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS scrap_factor          DECIMAL(5,4)  DEFAULT 0.05;
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS purchase_uom          VARCHAR(20)   DEFAULT 'kg';
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS minimum_order_qty     DECIMAL(10,2);
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS co2_kg_per_kg         DECIMAL(8,4);
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS recyclability_percent DECIMAL(5,2);
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS machinability_rating  DECIMAL(6,2);

-- Regional cost columns (may already exist from Supabase console — safe no-op)
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS cost_india    DECIMAL(15,4);
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS cost_usa      DECIMAL(15,4);
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS cost_china    DECIMAL(15,4);
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS cost_w_europe DECIMAL(15,4);
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS cost_e_europe DECIMAL(15,4);
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS cost_germany  DECIMAL(15,4);
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS cost_france   DECIMAL(15,4);

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2 — UPDATE EXISTING ROWS
-- ────────────────────────────────────────────────────────────────────────────
-- Pattern: match on material name fragment + grade fragment.
-- Both columns use ILIKE so casing / spacing variants are handled.
-- ────────────────────────────────────────────────────────────────────────────

-- ── MILD STEEL ───────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 7.85, density_kg_m3 = 7850,
  cost = 62, cost_india = 62, cost_usa = 0.90, cost_china = 0.70,
  cost_w_europe = 1.10, cost_germany = 1.10, cost_france = 1.10, cost_e_europe = 0.85,
  ultimate_tensile_strength = 410, yield_tensile_strength = 250, shearing_strength = 330,
  astm_standard = 'ASTM A36', din_standard = 'S235JR', en_standard = 'EN 10025', jis_standard = 'SS400',
  co2_kg_per_kg = 2.1, recyclability_percent = 85, machinability_rating = 75,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE (material ILIKE '%mild steel%' OR material ILIKE '%IS2062%' OR material ILIKE '%carbon steel%')
  AND material NOT ILIKE '%CRCA%'
  AND material NOT ILIKE '%GI%'
  AND material NOT ILIKE '%galvanised%';

-- ── CRCA STEEL ───────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 7.85, density_kg_m3 = 7850,
  cost = 72, cost_india = 72, cost_usa = 1.05, cost_china = 0.80,
  cost_w_europe = 1.30, cost_germany = 1.30, cost_france = 1.30, cost_e_europe = 1.00,
  ultimate_tensile_strength = 340, yield_tensile_strength = 210, shearing_strength = 270,
  astm_standard = 'ASTM A1008', din_standard = 'DC01', en_standard = 'EN 10130',
  co2_kg_per_kg = 2.1, recyclability_percent = 85, machinability_rating = 78,
  yield_factor = 0.80, scrap_factor = 0.08, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%CRCA%' OR material ILIKE '%IS513%' OR material ILIKE '%cold roll%';

-- ── GI STEEL ─────────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 7.85, density_kg_m3 = 7850,
  cost = 87, cost_india = 87, cost_usa = 1.25, cost_china = 0.95,
  cost_w_europe = 1.55, cost_germany = 1.55, cost_france = 1.55, cost_e_europe = 1.20,
  ultimate_tensile_strength = 340, yield_tensile_strength = 210, shearing_strength = 270,
  co2_kg_per_kg = 2.8, recyclability_percent = 80, machinability_rating = 72,
  yield_factor = 0.80, scrap_factor = 0.08, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%galvani%' OR material ILIKE '%GI steel%' OR material ILIKE '%IS277%' OR material ILIKE '%zinc coat%';

-- ── STAINLESS STEEL 304 (non-L) ──────────────────────────────────────────────
UPDATE raw_materials SET
  density = 7.93, density_kg_m3 = 7930,
  cost = 215, cost_india = 215, cost_usa = 3.80, cost_china = 2.80,
  cost_w_europe = 4.50, cost_germany = 4.50, cost_france = 4.50, cost_e_europe = 3.80,
  ultimate_tensile_strength = 515, yield_tensile_strength = 205, shearing_strength = 360,
  astm_standard = 'ASTM A240/A276', din_standard = '1.4301', en_standard = 'EN 10088', jis_standard = 'SUS304',
  co2_kg_per_kg = 6.2, recyclability_percent = 80, machinability_rating = 45,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE (material ILIKE '%SS304%' OR material ILIKE '%SS 304%' OR material ILIKE '%304%')
  AND material NOT ILIKE '%304L%'
  AND material_grade NOT ILIKE '%304L%';

-- ── STAINLESS STEEL 304L ─────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 7.93, density_kg_m3 = 7930,
  cost = 225, cost_india = 225, cost_usa = 4.00, cost_china = 3.00,
  cost_w_europe = 4.80, cost_germany = 4.80, cost_france = 4.80, cost_e_europe = 4.00,
  ultimate_tensile_strength = 485, yield_tensile_strength = 170, shearing_strength = 340,
  astm_standard = 'ASTM A240/A276', din_standard = '1.4306', en_standard = 'EN 10088', jis_standard = 'SUS304L',
  co2_kg_per_kg = 6.2, recyclability_percent = 80, machinability_rating = 45,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%304L%' OR material_grade ILIKE '%304L%';

-- ── STAINLESS STEEL 316L ─────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 8.00, density_kg_m3 = 8000,
  cost = 290, cost_india = 290, cost_usa = 5.25, cost_china = 3.80,
  cost_w_europe = 6.20, cost_germany = 6.20, cost_france = 6.20, cost_e_europe = 5.20,
  ultimate_tensile_strength = 515, yield_tensile_strength = 205, shearing_strength = 360,
  astm_standard = 'ASTM A240/A276', din_standard = '1.4404', en_standard = 'EN 10088', jis_standard = 'SUS316L',
  co2_kg_per_kg = 6.8, recyclability_percent = 80, machinability_rating = 38,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%316L%' OR material_grade ILIKE '%316L%';

-- ── STAINLESS STEEL 316 (non-L) ──────────────────────────────────────────────
UPDATE raw_materials SET
  density = 8.00, density_kg_m3 = 8000,
  cost = 280, cost_india = 280, cost_usa = 5.00, cost_china = 3.60,
  cost_w_europe = 5.90, cost_germany = 5.90, cost_france = 5.90, cost_e_europe = 4.90,
  ultimate_tensile_strength = 515, yield_tensile_strength = 205, shearing_strength = 360,
  astm_standard = 'ASTM A240/A276', din_standard = '1.4401', en_standard = 'EN 10088', jis_standard = 'SUS316',
  co2_kg_per_kg = 6.5, recyclability_percent = 80, machinability_rating = 40,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE (material ILIKE '%SS316%' OR material ILIKE '%SS 316%' OR material ILIKE '%316%')
  AND material NOT ILIKE '%316L%'
  AND material_grade NOT ILIKE '%316L%';

-- ── STAINLESS STEEL 430 ───────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 7.74, density_kg_m3 = 7740,
  cost = 172, cost_india = 172, cost_usa = 3.10, cost_china = 2.20,
  cost_w_europe = 3.70, cost_germany = 3.70, cost_france = 3.70, cost_e_europe = 3.00,
  ultimate_tensile_strength = 480, yield_tensile_strength = 275, shearing_strength = 336,
  astm_standard = 'ASTM A240', din_standard = '1.4016', en_standard = 'EN 10088', jis_standard = 'SUS430',
  co2_kg_per_kg = 5.8, recyclability_percent = 80, machinability_rating = 55,
  yield_factor = 0.80, scrap_factor = 0.08, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%430%' OR material_grade ILIKE '%430%';

-- ── STAINLESS STEEL 410 ───────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 7.75, density_kg_m3 = 7750,
  cost = 187, cost_india = 187, cost_usa = 3.40, cost_china = 2.50,
  cost_w_europe = 4.00, cost_germany = 4.00, cost_france = 4.00, cost_e_europe = 3.30,
  ultimate_tensile_strength = 520, yield_tensile_strength = 345, shearing_strength = 364,
  astm_standard = 'ASTM A276', din_standard = '1.4006', en_standard = 'EN 10088', jis_standard = 'SUS410',
  co2_kg_per_kg = 5.8, recyclability_percent = 80, machinability_rating = 55,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%410%' OR material_grade ILIKE '%410%';

-- ── STAINLESS STEEL 202 ───────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 7.92, density_kg_m3 = 7920,
  cost = 142, cost_india = 142, cost_usa = 2.60, cost_china = 1.90,
  cost_w_europe = 3.10, cost_germany = 3.10, cost_france = 3.10, cost_e_europe = 2.60,
  ultimate_tensile_strength = 515, yield_tensile_strength = 275, shearing_strength = 360,
  co2_kg_per_kg = 6.0, recyclability_percent = 80, machinability_rating = 48,
  yield_factor = 0.80, scrap_factor = 0.08, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%202%' OR material_grade ILIKE '%202%';

-- ── CAST IRON (Gray / GG25) ───────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 7.25, density_kg_m3 = 7250,
  cost = 62, cost_india = 62, cost_usa = 0.85, cost_china = 0.65,
  cost_w_europe = 1.05, cost_germany = 1.05, cost_france = 1.05, cost_e_europe = 0.80,
  ultimate_tensile_strength = 250, yield_tensile_strength = 165, shearing_strength = 175,
  astm_standard = 'ASTM A48', din_standard = 'GG-25', en_standard = 'EN-GJL-250',
  co2_kg_per_kg = 1.4, recyclability_percent = 80, machinability_rating = 60,
  yield_factor = 0.90, scrap_factor = 0.03, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE (material ILIKE '%cast iron%' OR material ILIKE '%grey iron%' OR material ILIKE '%gray iron%' OR material ILIKE '%GG25%')
  AND material NOT ILIKE '%ductile%'
  AND material NOT ILIKE '%nodular%'
  AND material NOT ILIKE '%GGG%';

-- ── SPRING STEEL 51CrV4 ──────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 7.85, density_kg_m3 = 7850,
  cost = 105, cost_india = 105, cost_usa = 1.50, cost_china = 1.10,
  cost_w_europe = 1.80, cost_germany = 1.80, cost_france = 1.80, cost_e_europe = 1.50,
  ultimate_tensile_strength = 1200, yield_tensile_strength = 1050, shearing_strength = 840,
  astm_standard = '6150', din_standard = '51CrV4', en_standard = 'EN 10083',
  co2_kg_per_kg = 2.8, recyclability_percent = 80, machinability_rating = 50,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%spring steel%' OR material ILIKE '%51CrV4%' OR material_grade ILIKE '%spring%';

-- ── BEARING STEEL 52100 ───────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 7.85, density_kg_m3 = 7850,
  cost = 115, cost_india = 115, cost_usa = 1.65, cost_china = 1.20,
  cost_w_europe = 2.00, cost_germany = 2.00, cost_france = 2.00, cost_e_europe = 1.60,
  ultimate_tensile_strength = 2000, yield_tensile_strength = 1700, shearing_strength = 1400,
  astm_standard = 'AISI 52100', din_standard = '100Cr6', en_standard = 'EN ISO 683-17',
  co2_kg_per_kg = 3.0, recyclability_percent = 80, machinability_rating = 45,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%52100%' OR material ILIKE '%100Cr6%' OR material ILIKE '%bearing steel%' OR material_grade ILIKE '%52100%';

-- ── ALUMINIUM 6061 T6 — ROUND BAR ────────────────────────────────────────────
UPDATE raw_materials SET
  density = 2.70, density_kg_m3 = 2700,
  cost = 350, cost_india = 350, cost_usa = 3.30, cost_china = 2.60,
  cost_w_europe = 4.10, cost_germany = 4.10, cost_france = 4.10, cost_e_europe = 3.20,
  ultimate_tensile_strength = 310, yield_tensile_strength = 276, shearing_strength = 207,
  astm_standard = 'ASTM B211', din_standard = 'EN AW-6061', en_standard = 'EN 573-3', jis_standard = 'A6061',
  co2_kg_per_kg = 11.5, recyclability_percent = 95, machinability_rating = 90,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%6061%'
  AND (material_grade ILIKE '%Round Bar%' OR material_grade ILIKE '%rod%' OR material_grade ILIKE '%bar%')
  AND material_grade NOT ILIKE '%sheet%'
  AND material_grade NOT ILIKE '%plate%'
  AND material_grade NOT ILIKE '%extrusion%';

-- ── ALUMINIUM 6061 T6 — SHEET ─────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 2.70, density_kg_m3 = 2700,
  cost = 360, cost_india = 360, cost_usa = 3.40, cost_china = 2.70,
  cost_w_europe = 4.20, cost_germany = 4.20, cost_france = 4.20, cost_e_europe = 3.30,
  ultimate_tensile_strength = 310, yield_tensile_strength = 276, shearing_strength = 207,
  astm_standard = 'ASTM B209', din_standard = 'EN AW-6061', en_standard = 'EN 573-3', jis_standard = 'A6061P',
  co2_kg_per_kg = 11.5, recyclability_percent = 95, machinability_rating = 90,
  yield_factor = 0.80, scrap_factor = 0.08, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%6061%'
  AND (material_grade ILIKE '%Sheet%' OR material_grade ILIKE '%Plate%');

-- ── ALUMINIUM 6061 T6 — EXTRUSION ────────────────────────────────────────────
UPDATE raw_materials SET
  density = 2.70, density_kg_m3 = 2700,
  cost = 345, cost_india = 345, cost_usa = 3.25, cost_china = 2.55,
  cost_w_europe = 4.00, cost_germany = 4.00, cost_france = 4.00, cost_e_europe = 3.10,
  ultimate_tensile_strength = 290, yield_tensile_strength = 255, shearing_strength = 193,
  co2_kg_per_kg = 11.5, recyclability_percent = 95, machinability_rating = 90,
  yield_factor = 0.88, scrap_factor = 0.04, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%6061%' AND material_grade ILIKE '%extrusion%';

-- ── ALUMINIUM 7075 — ROUND BAR ────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 2.81, density_kg_m3 = 2810,
  cost = 570, cost_india = 570, cost_usa = 5.20, cost_china = 4.00,
  cost_w_europe = 6.40, cost_germany = 6.40, cost_france = 6.40, cost_e_europe = 5.20,
  ultimate_tensile_strength = 572, yield_tensile_strength = 503, shearing_strength = 331,
  astm_standard = 'ASTM B211', din_standard = 'EN AW-7075', en_standard = 'EN 573-3',
  co2_kg_per_kg = 12.0, recyclability_percent = 95, machinability_rating = 80,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%7075%'
  AND (material_grade ILIKE '%Round Bar%' OR material_grade ILIKE '%rod%' OR material_grade ILIKE '%bar%' OR material_grade ILIKE '%T651%')
  AND material_grade NOT ILIKE '%sheet%';

-- ── ALUMINIUM 7075 — SHEET ────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 2.81, density_kg_m3 = 2810,
  cost = 590, cost_india = 590, cost_usa = 5.40, cost_china = 4.20,
  cost_w_europe = 6.60, cost_germany = 6.60, cost_france = 6.60, cost_e_europe = 5.40,
  ultimate_tensile_strength = 572, yield_tensile_strength = 503, shearing_strength = 331,
  astm_standard = 'ASTM B209', din_standard = 'EN AW-7075', en_standard = 'EN 573-3',
  co2_kg_per_kg = 12.0, recyclability_percent = 95, machinability_rating = 80,
  yield_factor = 0.80, scrap_factor = 0.08, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%7075%' AND (material_grade ILIKE '%Sheet%' OR material_grade ILIKE '%Plate%');

-- ── ALUMINIUM 5052 ────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 2.68, density_kg_m3 = 2680,
  cost = 310, cost_india = 310, cost_usa = 2.90, cost_china = 2.30,
  cost_w_europe = 3.60, cost_germany = 3.60, cost_france = 3.60, cost_e_europe = 2.80,
  ultimate_tensile_strength = 228, yield_tensile_strength = 193, shearing_strength = 138,
  astm_standard = 'ASTM B209', din_standard = 'EN AW-5052', en_standard = 'EN 573-3',
  co2_kg_per_kg = 11.5, recyclability_percent = 95, machinability_rating = 85,
  yield_factor = 0.80, scrap_factor = 0.08, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%5052%';

-- ── ALUMINIUM 5083 ────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 2.66, density_kg_m3 = 2660,
  cost = 320, cost_india = 320, cost_usa = 3.00, cost_china = 2.35,
  cost_w_europe = 3.70, cost_germany = 3.70, cost_france = 3.70, cost_e_europe = 2.90,
  ultimate_tensile_strength = 270, yield_tensile_strength = 125, shearing_strength = 160,
  astm_standard = 'ASTM B209', din_standard = 'EN AW-5083', en_standard = 'EN 573-3',
  co2_kg_per_kg = 11.5, recyclability_percent = 95, machinability_rating = 82,
  yield_factor = 0.80, scrap_factor = 0.08, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%5083%';

-- ── ALUMINIUM 2024 — BAR ──────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 2.78, density_kg_m3 = 2780,
  cost = 530, cost_india = 530, cost_usa = 4.80, cost_china = 3.70,
  cost_w_europe = 5.90, cost_germany = 5.90, cost_france = 5.90, cost_e_europe = 4.80,
  ultimate_tensile_strength = 483, yield_tensile_strength = 345, shearing_strength = 283,
  astm_standard = 'ASTM B211', din_standard = 'EN AW-2024',
  co2_kg_per_kg = 12.0, recyclability_percent = 95, machinability_rating = 70,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%2024%'
  AND (material_grade ILIKE '%Round Bar%' OR material_grade ILIKE '%T3%' OR material_grade ILIKE '%bar%')
  AND material_grade NOT ILIKE '%sheet%';

-- ── ALUMINIUM 2024 — SHEET ────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 2.78, density_kg_m3 = 2780,
  cost = 545, cost_india = 545, cost_usa = 4.95, cost_china = 3.80,
  cost_w_europe = 6.10, cost_germany = 6.10, cost_france = 6.10, cost_e_europe = 4.90,
  ultimate_tensile_strength = 483, yield_tensile_strength = 345, shearing_strength = 283,
  astm_standard = 'ASTM B209', din_standard = 'EN AW-2024',
  co2_kg_per_kg = 12.0, recyclability_percent = 95, machinability_rating = 70,
  yield_factor = 0.80, scrap_factor = 0.08, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%2024%' AND (material_grade ILIKE '%Sheet%' OR material_grade ILIKE '%T351%');

-- ── ALUMINIUM 6082 ────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 2.71, density_kg_m3 = 2710,
  cost = 345, cost_india = 345, cost_usa = 3.25, cost_china = 2.55,
  cost_w_europe = 4.00, cost_germany = 4.00, cost_france = 4.00, cost_e_europe = 3.10,
  ultimate_tensile_strength = 310, yield_tensile_strength = 260, shearing_strength = 205,
  astm_standard = 'ASTM B209', din_standard = 'EN AW-6082', en_standard = 'EN 573-3',
  co2_kg_per_kg = 11.5, recyclability_percent = 95, machinability_rating = 88,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%6082%';

-- ── ALUMINIUM 1050 ────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 2.71, density_kg_m3 = 2710,
  cost = 280, cost_india = 280, cost_usa = 2.60, cost_china = 2.00,
  cost_w_europe = 3.20, cost_germany = 3.20, cost_france = 3.20, cost_e_europe = 2.50,
  ultimate_tensile_strength = 120, yield_tensile_strength = 105, shearing_strength = 75,
  astm_standard = 'ASTM B209', din_standard = 'EN AW-1050', en_standard = 'EN 573-3',
  co2_kg_per_kg = 11.5, recyclability_percent = 98, machinability_rating = 95,
  yield_factor = 0.80, scrap_factor = 0.08, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%1050%' OR material ILIKE '%pure alum%' OR material ILIKE '%commercial aluminium%';

-- ── BRASS CuZn39Pb3 / FREE CUTTING ───────────────────────────────────────────
UPDATE raw_materials SET
  density = 8.50, density_kg_m3 = 8500,
  cost = 710, cost_india = 710, cost_usa = 6.20, cost_china = 4.80,
  cost_w_europe = 7.60, cost_germany = 7.60, cost_france = 7.60, cost_e_europe = 6.20,
  ultimate_tensile_strength = 380, yield_tensile_strength = 200, shearing_strength = 266,
  astm_standard = 'ASTM B16', din_standard = 'CuZn39Pb3', en_standard = 'EN 12165',
  co2_kg_per_kg = 4.5, recyclability_percent = 90, machinability_rating = 300,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE (material ILIKE '%brass%' OR material ILIKE '%CuZn%')
  AND (material ILIKE '%free%' OR material ILIKE '%leaded%' OR material_grade ILIKE '%free%' OR material_grade ILIKE '%Pb%');

-- ── BRASS (non-leaded) ────────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 8.52, density_kg_m3 = 8520,
  cost = 730, cost_india = 730, cost_usa = 6.40, cost_china = 4.90,
  cost_w_europe = 7.80, cost_germany = 7.80, cost_france = 7.80, cost_e_europe = 6.40,
  ultimate_tensile_strength = 360, yield_tensile_strength = 120, shearing_strength = 252,
  astm_standard = 'ASTM B36', din_standard = 'CuZn30', en_standard = 'EN 1652',
  co2_kg_per_kg = 4.5, recyclability_percent = 90, machinability_rating = 200,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE (material ILIKE '%brass%' OR material ILIKE '%CuZn%')
  AND material NOT ILIKE '%free%'
  AND material NOT ILIKE '%leaded%'
  AND material_grade NOT ILIKE '%Pb%'
  AND material NOT ILIKE '%bronze%';

-- ── COPPER ETP ────────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 8.94, density_kg_m3 = 8940,
  cost = 850, cost_india = 850, cost_usa = 9.50, cost_china = 7.20,
  cost_w_europe = 11.50, cost_germany = 11.50, cost_france = 11.50, cost_e_europe = 9.50,
  ultimate_tensile_strength = 220, yield_tensile_strength = 70, shearing_strength = 154,
  astm_standard = 'ASTM B152', din_standard = 'Cu-ETP', en_standard = 'EN 1652',
  co2_kg_per_kg = 3.8, recyclability_percent = 92, machinability_rating = 70,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE (material ILIKE '%copper%' OR material ILIKE '%C11000%' OR material ILIKE '%ETP%')
  AND material NOT ILIKE '%bronze%'
  AND material NOT ILIKE '%phosphor%'
  AND material NOT ILIKE '%aluminium bronze%';

-- ── PHOSPHOR BRONZE ───────────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 8.86, density_kg_m3 = 8860,
  cost = 880, cost_india = 880, cost_usa = 9.80, cost_china = 7.50,
  cost_w_europe = 12.00, cost_germany = 12.00, cost_france = 12.00, cost_e_europe = 9.80,
  ultimate_tensile_strength = 520, yield_tensile_strength = 410, shearing_strength = 364,
  astm_standard = 'ASTM B139', din_standard = 'CuSn8', en_standard = 'EN 12163',
  co2_kg_per_kg = 4.8, recyclability_percent = 88, machinability_rating = 65,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%phosphor%' OR material ILIKE '%C510%' OR material ILIKE '%C51000%';

-- ── ALUMINIUM BRONZE ──────────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 7.60, density_kg_m3 = 7600,
  cost = 720, cost_india = 720, cost_usa = 6.80, cost_china = 5.20,
  cost_w_europe = 8.30, cost_germany = 8.30, cost_france = 8.30, cost_e_europe = 6.80,
  ultimate_tensile_strength = 600, yield_tensile_strength = 280, shearing_strength = 420,
  astm_standard = 'ASTM B150', din_standard = 'CuAl10Fe3', en_standard = 'EN 12163',
  co2_kg_per_kg = 5.0, recyclability_percent = 88, machinability_rating = 60,
  yield_factor = 0.85, scrap_factor = 0.05, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%aluminium bronze%' OR material ILIKE '%aluminum bronze%' OR material ILIKE '%ALBC%';

-- ── ZINC / DIE CAST ───────────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = 6.30, density_kg_m3 = 6300,
  cost = 210, cost_india = 210, cost_usa = 2.20, cost_china = 1.70,
  cost_w_europe = 2.70, cost_germany = 2.70, cost_france = 2.70, cost_e_europe = 2.20,
  ultimate_tensile_strength = 310, yield_tensile_strength = 240, shearing_strength = 217,
  co2_kg_per_kg = 3.9, recyclability_percent = 85, machinability_rating = 100,
  yield_factor = 0.90, scrap_factor = 0.03, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%zinc%' OR material ILIKE '%ZA-%' OR material ILIKE '%zamak%';

-- ── ABS (all injection-moulding grades) ──────────────────────────────────────
-- These are the 526 existing rows from plastic injection molding dataset.
-- We set density from existing density_kg_m3, and add cost_india.
UPDATE raw_materials SET
  density = CASE WHEN density IS NULL AND density_kg_m3 IS NOT NULL THEN density_kg_m3 / 1000.0 ELSE density END,
  cost_india = COALESCE(cost_india, 285),
  cost_usa   = COALESCE(cost_usa, 2.75),
  co2_kg_per_kg = 4.0, recyclability_percent = 30, machinability_rating = 130,
  yield_factor = 0.90, scrap_factor = 0.04, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%Acrylonitrile Butadiene%' OR material ILIKE '%\bABS\b%';

-- ── NYLON / PA (all existing grades) ─────────────────────────────────────────
UPDATE raw_materials SET
  density = CASE WHEN density IS NULL AND density_kg_m3 IS NOT NULL THEN density_kg_m3 / 1000.0 ELSE density END,
  cost_india = COALESCE(cost_india, 335),
  cost_usa   = COALESCE(cost_usa, 3.40),
  co2_kg_per_kg = 6.5, recyclability_percent = 25, machinability_rating = 110,
  yield_factor = 0.90, scrap_factor = 0.04, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%nylon%' OR material ILIKE '%polyamide%'
   OR material ILIKE '%\bPA6%' OR material ILIKE '%\bPA12%' OR material ILIKE '%\bPA66%';

-- ── PP (all existing grades) ──────────────────────────────────────────────────
UPDATE raw_materials SET
  density = CASE WHEN density IS NULL AND density_kg_m3 IS NOT NULL THEN density_kg_m3 / 1000.0 ELSE density END,
  cost_india = COALESCE(cost_india, 112),
  cost_usa   = COALESCE(cost_usa, 1.22),
  co2_kg_per_kg = 2.0, recyclability_percent = 50, machinability_rating = 125,
  yield_factor = 0.90, scrap_factor = 0.04, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%polypropylene%' OR material ILIKE '%\bPP\b%' OR material ILIKE '%PP,%' OR material ILIKE '% PP ';

-- ── HDPE ──────────────────────────────────────────────────────────────────────
UPDATE raw_materials SET
  density = CASE WHEN density IS NULL AND density_kg_m3 IS NOT NULL THEN density_kg_m3 / 1000.0 ELSE density END,
  cost_india = COALESCE(cost_india, 115),
  cost_usa   = COALESCE(cost_usa, 1.20),
  co2_kg_per_kg = 1.9, recyclability_percent = 55, machinability_rating = 130,
  yield_factor = 0.90, scrap_factor = 0.04, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%HDPE%' OR material ILIKE '%high density polyethylene%';

-- ── PVC (all existing grades) ─────────────────────────────────────────────────
UPDATE raw_materials SET
  density = CASE WHEN density IS NULL AND density_kg_m3 IS NOT NULL THEN density_kg_m3 / 1000.0 ELSE density END,
  cost_india = COALESCE(cost_india, 122),
  cost_usa   = COALESCE(cost_usa, 1.43),
  co2_kg_per_kg = 3.8, recyclability_percent = 30, machinability_rating = 100,
  yield_factor = 0.90, scrap_factor = 0.04, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%polyvinyl%' OR material ILIKE '%\bPVC\b%';

-- ── POLYCARBONATE (existing) ───────────────────────────────────────────────────
UPDATE raw_materials SET
  density = CASE WHEN density IS NULL AND density_kg_m3 IS NOT NULL THEN density_kg_m3 / 1000.0 ELSE density END,
  cost_india = COALESCE(cost_india, 320),
  cost_usa   = COALESCE(cost_usa, 3.10),
  co2_kg_per_kg = 7.6, recyclability_percent = 35, machinability_rating = 115,
  yield_factor = 0.90, scrap_factor = 0.04, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%polycarbonate%' OR material ILIKE '%\bPC\b%' OR material ILIKE '% PC,%';

-- ── ACRYLIC / PMMA (existing) ─────────────────────────────────────────────────
UPDATE raw_materials SET
  density = CASE WHEN density IS NULL AND density_kg_m3 IS NOT NULL THEN density_kg_m3 / 1000.0 ELSE density END,
  cost_india = COALESCE(cost_india, 272),
  cost_usa   = COALESCE(cost_usa, 2.65),
  co2_kg_per_kg = 5.5, recyclability_percent = 20, machinability_rating = 100,
  yield_factor = 0.90, scrap_factor = 0.04, purchase_uom = 'kg',
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE material ILIKE '%acrylic%' OR material ILIKE '%PMMA%' OR material ILIKE '%polymethyl%';

-- ── GENERIC: derive density from density_kg_m3 for any remaining plastics ────
UPDATE raw_materials SET
  density = density_kg_m3 / 1000.0,
  price_source = 'Default India Market Estimate', price_date = '2026-06-30', last_updated = NOW()
WHERE density IS NULL
  AND density_kg_m3 IS NOT NULL
  AND density_kg_m3 > 0;

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 3 — INSERT MISSING MATERIALS
-- These do not exist in the 526-row dataset at all.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO raw_materials (
  material_group, material, material_grade, material_type, material_description,
  stock_form, matl_state, currency,
  density, density_kg_m3,
  cost, cost_india, cost_usa, cost_china, cost_w_europe, cost_germany, cost_france, cost_e_europe,
  ultimate_tensile_strength, yield_tensile_strength, shearing_strength,
  astm_standard, din_standard, en_standard, jis_standard,
  co2_kg_per_kg, recyclability_percent, machinability_rating,
  yield_factor, scrap_factor, purchase_uom,
  price_source, price_date, last_updated,
  user_id
)
SELECT
  v.mg, v.mat, v.grade, v.mtype, v.mdesc,
  v.sform, v.mstate, v.curr,
  v.dens, v.dens_kg,
  v.c_cost, v.ci, v.cu, v.cc, v.cwe, v.cg, v.cf, v.cee,
  v.uts, v.ys, v.ss,
  v.astm, v.din, v.en_std, v.jis,
  v.co2, v.recycle, v.mach,
  v.yf, v.sf, v.uom,
  v.psrc, v.pdate::date, NOW(),
  r.user_id
FROM (VALUES

  -- POM / Delrin
  ('Plastics', 'POM / Delrin', 'Homopolymer - Natural Round Bar', 'Engineering Plastic',
   'Polyoxymethylene homopolymer (Delrin 500). Excellent dimensional stability, low friction, high stiffness.',
   'Round Bar', 'Solid', 'INR',
   1.42::numeric, 1420::numeric,
   420::numeric, 420::numeric, 4.50::numeric, 3.10::numeric, 5.20::numeric, 5.20::numeric, 5.20::numeric, 4.20::numeric,
   69::numeric, NULL::numeric, 41::numeric,
   NULL::text, NULL::text, 'ISO 9988-1', NULL::text,
   3.5::numeric, 30.0::numeric, 120.0::numeric,
   0.90::numeric, 0.04::numeric, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  ('Plastics', 'POM / Delrin', 'Black - Round Bar', 'Engineering Plastic',
   'Delrin Black (carbon-filled homopolymer). Same base properties as natural, UV-stabilised.',
   'Round Bar', 'Solid', 'INR',
   1.42, 1420,
   420, 420, 4.50, 3.10, 5.20, 5.20, 5.20, 4.20,
   69, NULL, 41,
   NULL, NULL, 'ISO 9988-1', NULL,
   3.5, 30.0, 120.0,
   0.90, 0.04, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  ('Plastics', 'POM Copolymer', 'Celcon - Natural Round Bar', 'Engineering Plastic',
   'POM copolymer (Celcon/Hostaform). Slightly lower strength than homopolymer but better chemical resistance.',
   'Round Bar', 'Solid', 'INR',
   1.41, 1410,
   400, 400, 4.25, 2.95, 5.00, 5.00, 5.00, 4.00,
   62, NULL, 37,
   NULL, NULL, 'ISO 9988-2', NULL,
   3.5, 30.0, 115.0,
   0.90, 0.04, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  -- PEEK
  ('Plastics', 'PEEK', 'Natural - Rod/Bar', 'Engineering Plastic',
   'Polyether ether ketone. Exceptional temperature resistance, chemical inertness, FDA/biocompatible grades available.',
   'Round Bar', 'Solid', 'INR',
   1.32, 1320,
   8500, 8500, 100.00, 75.00, 120.00, 120.00, 120.00, 100.00,
   100, NULL, 60,
   NULL, NULL, 'ISO 11782', NULL,
   8.0, 15.0, 85.0,
   0.90, 0.04, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  ('Plastics', 'PEEK GF30', '30% Glass Filled - Rod/Bar', 'Engineering Plastic',
   'PEEK with 30% glass fibre reinforcement. Higher stiffness and creep resistance than unfilled PEEK.',
   'Round Bar', 'Solid', 'INR',
   1.51, 1510,
   10000, 10000, 120.00, 90.00, 145.00, 145.00, 145.00, 120.00,
   170, NULL, 100,
   NULL, NULL, 'ISO 11782', NULL,
   8.5, 12.0, 65.0,
   0.90, 0.04, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  -- Nylon (machining bar grades)
  ('Plastics', 'Nylon PA6', 'Natural - Round Bar', 'Engineering Plastic',
   'Polyamide 6 machining bar. General-purpose nylon for bushings, bearings, gears.',
   'Round Bar', 'Solid', 'INR',
   1.14, 1140,
   315, 315, 3.20, 2.30, 3.90, 3.90, 3.90, 3.20,
   75, NULL, 45,
   NULL, NULL, 'ISO 1874', NULL,
   6.5, 25.0, 110.0,
   0.90, 0.04, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  ('Plastics', 'Nylon PA66', 'Natural - Round Bar', 'Engineering Plastic',
   'Polyamide 66 machining bar. Higher temperature rating than PA6. Commonly used in mechanical parts.',
   'Round Bar', 'Solid', 'INR',
   1.15, 1150,
   360, 360, 3.60, 2.60, 4.40, 4.40, 4.40, 3.60,
   82, NULL, 49,
   NULL, NULL, 'ISO 1874', NULL,
   6.5, 25.0, 110.0,
   0.90, 0.04, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  ('Plastics', 'Nylon PA6-GF30', '30% Glass Filled - Round Bar', 'Engineering Plastic',
   'PA6 reinforced with 30% glass fibre. Significantly improved stiffness and strength over unfilled PA6.',
   'Round Bar', 'Solid', 'INR',
   1.36, 1360,
   370, 370, 3.80, 2.80, 4.65, 4.65, 4.65, 3.80,
   155, NULL, 93,
   NULL, NULL, 'ISO 1874', NULL,
   7.0, 20.0, 80.0,
   0.90, 0.04, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  ('Plastics', 'Nylon PA12', 'Natural - Round Bar', 'Engineering Plastic',
   'Polyamide 12. Low moisture absorption, excellent fuel/chemical resistance. Used in automotive and medical.',
   'Round Bar', 'Solid', 'INR',
   1.02, 1020,
   510, 510, 5.20, 3.80, 6.40, 6.40, 6.40, 5.20,
   52, NULL, 31,
   NULL, NULL, 'ISO 1874', NULL,
   6.0, 25.0, 115.0,
   0.90, 0.04, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  -- PTFE
  ('Plastics', 'PTFE', 'Virgin - Rod', 'Engineering Plastic',
   'Polytetrafluoroethylene virgin rod. Widest chemical resistance of any plastic, low friction coefficient.',
   'Round Bar', 'Solid', 'INR',
   2.20, 2200,
   1050, 1050, 16.00, 12.00, 20.00, 20.00, 20.00, 16.00,
   25, NULL, 15,
   NULL, NULL, 'ISO 13000', NULL,
   9.5, 10.0, 140.0,
   0.90, 0.04, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  ('Plastics', 'PTFE GF25', 'Glass Filled 25% - Rod', 'Engineering Plastic',
   'PTFE with 25% glass fibre filler. Better wear resistance and lower creep than virgin PTFE.',
   'Round Bar', 'Solid', 'INR',
   2.32, 2320,
   1200, 1200, 18.50, 14.00, 23.00, 23.00, 23.00, 19.00,
   35, NULL, 21,
   NULL, NULL, 'ISO 13000', NULL,
   10.0, 8.0, 110.0,
   0.90, 0.04, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  -- UHMWPE
  ('Plastics', 'UHMWPE', 'Natural - Rod/Sheet', 'Engineering Plastic',
   'Ultra-high-molecular-weight polyethylene. Outstanding impact strength, abrasion resistance, self-lubricating.',
   'Round Bar', 'Solid', 'INR',
   0.93, 930,
   300, 300, 3.50, 2.60, 4.30, 4.30, 4.30, 3.50,
   27, NULL, 16,
   NULL, NULL, 'ASTM F648', NULL,
   2.5, 55.0, 135.0,
   0.90, 0.04, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  -- Ultem PEI
  ('Plastics', 'Ultem PEI', 'Natural - Rod', 'Engineering Plastic',
   'Polyetherimide (Ultem 1010). High heat resistance, flame retardant, excellent electrical properties.',
   'Round Bar', 'Solid', 'INR',
   1.27, 1270,
   5000, 5000, 65.00, 48.00, 80.00, 80.00, 80.00, 65.00,
   107, NULL, 64,
   NULL, NULL, 'ISO 61', NULL,
   8.5, 20.0, 90.0,
   0.90, 0.04, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  -- PSU Polysulfone
  ('Plastics', 'PSU Polysulfone', 'Natural - Round Bar', 'Engineering Plastic',
   'Polysulfone. Transparent, excellent hydrolysis resistance, autoclavable. Used in medical and food-contact applications.',
   'Round Bar', 'Solid', 'INR',
   1.24, 1240,
   2200, 2200, 28.00, 21.00, 34.00, 34.00, 34.00, 28.00,
   70, NULL, 42,
   NULL, NULL, 'ISO 4660', NULL,
   8.0, 30.0, 95.0,
   0.90, 0.04, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  -- PPS
  ('Plastics', 'PPS', '40% Glass Filled - Round Bar', 'Engineering Plastic',
   'Polyphenylene sulphide, 40% GF. Exceptional chemical resistance, flame retardant, high rigidity.',
   'Round Bar', 'Solid', 'INR',
   1.66, 1660,
   1800, 1800, 22.00, 16.00, 27.00, 27.00, 27.00, 22.00,
   190, NULL, 114,
   NULL, NULL, 'ISO 10724', NULL,
   7.5, 15.0, 70.0,
   0.90, 0.04, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  -- Acrylic PMMA
  ('Plastics', 'Acrylic PMMA', 'Cast Sheet - Clear', 'Engineering Plastic',
   'Cast polymethyl methacrylate sheet. Optical clarity, UV resistance, weatherable.',
   'Sheet', 'Solid', 'INR',
   1.18, 1180,
   285, 285, 2.80, 2.00, 3.45, 3.45, 3.45, 2.80,
   72, NULL, 43,
   NULL, NULL, 'ISO 7823', NULL,
   5.5, 20.0, 100.0,
   0.80, 0.08, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  -- Titanium
  ('Non-Ferrous Metals', 'Titanium Grade 2', 'CP - Round Bar', 'Titanium Alloy',
   'Commercially pure titanium Grade 2. Corrosion resistant, biocompatible, lower strength than Ti-6Al-4V.',
   'Round Bar', 'Solid', 'INR',
   4.51, 4510,
   3200, 3200, 27.00, 20.00, 33.00, 33.00, 33.00, 27.00,
   344, 275, 207,
   'ASTM B348', 'Grade 2', 'EN ISO 4954', 'JIS H 4600',
   35.0, 70.0, 30.0,
   0.85, 0.05, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  ('Non-Ferrous Metals', 'Titanium Ti-6Al-4V', 'Grade 5 - Round Bar', 'Titanium Alloy',
   'Ti-6Al-4V Grade 5. Most widely used titanium alloy. Aerospace and medical applications.',
   'Round Bar', 'Solid', 'INR',
   4.43, 4430,
   5500, 5500, 45.00, 34.00, 56.00, 56.00, 56.00, 45.00,
   950, 880, 570,
   'ASTM B348', '3.7165', 'EN ISO 4954', 'JIS H 4600',
   35.0, 70.0, 20.0,
   0.85, 0.05, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  ('Non-Ferrous Metals', 'Titanium Ti-6Al-4V', 'Grade 23 ELI - Bar', 'Titanium Alloy',
   'Ti-6Al-4V ELI (Extra Low Interstitial) Grade 23. Medical/surgical implant grade.',
   'Round Bar', 'Solid', 'INR',
   4.43, 4430,
   6500, 6500, 55.00, 41.00, 68.00, 68.00, 68.00, 55.00,
   860, 795, 516,
   'ASTM F136', '3.7165 ELI', 'EN ISO 5832-3', NULL,
   35.0, 70.0, 20.0,
   0.85, 0.05, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  -- Inconel / Nickel Alloys
  ('Ferrous Metals', 'Inconel 625', 'Ni-Cr-Mo - Round Bar', 'Nickel Superalloy',
   'Inconel 625 nickel-chromium-molybdenum alloy. Exceptional corrosion and oxidation resistance to 980°C.',
   'Round Bar', 'Solid', 'INR',
   8.44, 8440,
   3500, 3500, 60.00, 45.00, 74.00, 74.00, 74.00, 60.00,
   830, 415, 498,
   'ASTM B446', '2.4856', 'EN 10095', NULL,
   28.0, 60.0, 10.0,
   0.85, 0.05, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  ('Ferrous Metals', 'Inconel 718', 'Ni-Fe-Cr - Round Bar', 'Nickel Superalloy',
   'Inconel 718. Age-hardenable nickel-based superalloy used in aerospace turbines. Service to 650°C.',
   'Round Bar', 'Solid', 'INR',
   8.22, 8220,
   4000, 4000, 70.00, 52.00, 86.00, 86.00, 86.00, 70.00,
   1240, 1035, 744,
   'ASTM B637', '2.4668', 'EN 10095', NULL,
   28.0, 60.0, 8.0,
   0.85, 0.05, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  ('Ferrous Metals', 'Monel 400', 'Ni-Cu - Round Bar', 'Nickel Alloy',
   'Monel 400 nickel-copper alloy. Excellent seawater and acid corrosion resistance.',
   'Round Bar', 'Solid', 'INR',
   8.80, 8800,
   2400, 2400, 42.00, 31.00, 52.00, 52.00, 52.00, 42.00,
   540, 240, 324,
   'ASTM B164', '2.4360', NULL, NULL,
   25.0, 60.0, 20.0,
   0.85, 0.05, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  ('Ferrous Metals', 'Hastelloy C276', 'Ni-Mo-Cr - Round Bar', 'Nickel Superalloy',
   'Hastelloy C-276. Outstanding resistance to reducing and oxidising chemicals. Chemical processing.',
   'Round Bar', 'Solid', 'INR',
   8.89, 8890,
   6000, 6000, 105.00, 78.00, 130.00, 130.00, 130.00, 105.00,
   690, 285, 414,
   'ASTM B574', '2.4819', NULL, NULL,
   30.0, 55.0, 8.0,
   0.85, 0.05, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  -- Duplex Stainless Steel
  ('Ferrous Metals', 'Duplex SS2205', 'Round Bar / Sheet', 'Stainless Steel',
   'Duplex stainless steel 2205. Twice the yield strength of 316L with excellent PREN > 35 pitting resistance.',
   'Round Bar', 'Solid', 'INR',
   7.80, 7800,
   495, 495, 9.50, 7.00, 11.80, 11.80, 11.80, 9.50,
   620, 450, 372,
   'ASTM A276/A240', '1.4462', 'EN 10088', NULL,
   7.5, 80.0, 25.0,
   0.85, 0.05, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  ('Ferrous Metals', 'Duplex SS2507', 'Super Duplex - Round Bar', 'Stainless Steel',
   'Super duplex stainless steel 2507. PREN > 40. Offshore oil/gas and desalination applications.',
   'Round Bar', 'Solid', 'INR',
   7.80, 7800,
   750, 750, 14.00, 10.50, 17.40, 17.40, 17.40, 14.00,
   730, 530, 438,
   'ASTM A276/A240', '1.4410', 'EN 10088', NULL,
   7.5, 80.0, 18.0,
   0.85, 0.05, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  -- Ductile Iron
  ('Ferrous Metals', 'Ductile Iron', 'GGG-40 - Casting Bar', 'Ductile Cast Iron',
   'Spheroidal graphite (ductile) iron GGG-40. Far greater toughness than grey iron. Automotive and machinery.',
   'Casting', 'Solid', 'INR',
   7.10, 7100,
   72, 72, 0.95, 0.72, 1.18, 1.18, 1.18, 0.95,
   420, 280, 294,
   'ASTM A536', 'GGG-40', 'EN-GJS-400-15', NULL,
   1.6, 80.0, 55.0,
   0.90, 0.03, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  -- Tool Steels
  ('Ferrous Metals', 'Tool Steel D2', 'Cold Work - Round Bar', 'Tool Steel',
   'D2 high-carbon high-chromium cold work tool steel. Excellent wear resistance, 58-62 HRC after hardening.',
   'Round Bar', 'Solid', 'INR',
   7.70, 7700,
   320, 320, 7.50, 5.60, 9.30, 9.30, 9.30, 7.50,
   1520, 1380, 910,
   'AISI D2', '1.2379', 'EN ISO 4957', NULL,
   3.5, 75.0, 20.0,
   0.85, 0.05, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  ('Ferrous Metals', 'Tool Steel H13', 'Hot Work - Round Bar', 'Tool Steel',
   'H13 hot work tool steel. Used in die casting dies and hot forging tooling. Air-hardening, 44-50 HRC.',
   'Round Bar', 'Solid', 'INR',
   7.80, 7800,
   390, 390, 9.00, 6.70, 11.10, 11.10, 11.10, 9.00,
   1380, 1240, 828,
   'AISI H13', '1.2344', 'EN ISO 4957', NULL,
   3.5, 75.0, 30.0,
   0.85, 0.05, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  ('Ferrous Metals', 'Tool Steel P20', 'Mould Steel - Round Bar', 'Tool Steel',
   'P20 pre-hardened mould steel (~30 HRC). Most common plastic injection mould material.',
   'Round Bar', 'Solid', 'INR',
   7.85, 7850,
   280, 280, 6.50, 4.90, 8.00, 8.00, 8.00, 6.50,
   1000, 860, 600,
   'AISI P20', '1.2311', 'EN ISO 4957', NULL,
   3.5, 75.0, 35.0,
   0.85, 0.05, 'kg',
   'Default India Market Estimate', '2026-06-30'),

  ('Ferrous Metals', 'Tool Steel M2 HSS', 'High Speed Steel - Round Bar', 'Tool Steel',
   'M2 high speed steel. Standard HSS grade for drills, end mills, taps and general cutting tools.',
   'Round Bar', 'Solid', 'INR',
   8.16, 8160,
   620, 620, 14.00, 10.50, 17.40, 17.40, 17.40, 14.00,
   3100, NULL, 1860,
   'AISI M2', '1.3343', 'EN ISO 4957', 'SKH51',
   4.0, 70.0, 15.0,
   0.85, 0.05, 'kg',
   'Default India Market Estimate', '2026-06-30')

) AS v(mg, mat, grade, mtype, mdesc, sform, mstate, curr,
       dens, dens_kg,
       c_cost, ci, cu, cc, cwe, cg, cf, cee,
       uts, ys, ss,
       astm, din, en_std, jis,
       co2, recycle, mach,
       yf, sf, uom,
       psrc, pdate)
CROSS JOIN (SELECT user_id FROM raw_materials ORDER BY created_at LIMIT 1) AS r
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- INDEXES for new columns (skip if already exist)
-- ────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_raw_materials_cost_india  ON raw_materials(cost_india)  WHERE cost_india  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_materials_cost_usa    ON raw_materials(cost_usa)    WHERE cost_usa    IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_materials_co2         ON raw_materials(co2_kg_per_kg) WHERE co2_kg_per_kg IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_materials_machinability ON raw_materials(machinability_rating) WHERE machinability_rating IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- COMMENTS
-- ────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN raw_materials.price_source          IS 'Who provided the price — e.g. Default India Market Estimate';
COMMENT ON COLUMN raw_materials.price_date            IS 'Date the price was researched or last confirmed';
COMMENT ON COLUMN raw_materials.yield_factor          IS 'Fraction of purchased material that becomes the finished part (0–1)';
COMMENT ON COLUMN raw_materials.scrap_factor          IS 'Additional scrap/offcut loss beyond yield_factor (0–1)';
COMMENT ON COLUMN raw_materials.purchase_uom          IS 'Unit of measure for purchasing: kg / meter / sheet';
COMMENT ON COLUMN raw_materials.minimum_order_qty     IS 'Minimum purchasable quantity in purchase_uom';
COMMENT ON COLUMN raw_materials.co2_kg_per_kg         IS 'Cradle-to-gate carbon footprint in kg CO₂-eq per kg of material (ecoinvent 3.9)';
COMMENT ON COLUMN raw_materials.recyclability_percent IS 'Percentage of material that can be recycled at end of life';
COMMENT ON COLUMN raw_materials.machinability_rating  IS 'Machinability index relative to free-cutting steel AISI 1213 = 100. Higher = easier to machine.';

-- Migration completed successfully
