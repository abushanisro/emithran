-- Migration 154: Seed standard manufacturing materials
--
-- 75 materials covering >90% of Indian manufacturing RFQs.
-- Includes aerospace/defence specialty alloys.
--
-- All costs USD/kg (global commodity pricing, Q1-2025 India import-parity).
-- user_id = NULL, is_global = TRUE  →  visible to all users (requires migration 155).
-- currency = 'USD', country_code = 'GL' (globally traded commodity prices).
-- Densities in kg/m³.
--
-- Run migration 155 before this (adds is_global column + drops user_id NOT NULL).

INSERT INTO raw_materials
  (user_id, is_global,
   material_group, material, material_grade,
   density_kg_m3, cost, currency, country_code, location,
   material_form, material_family, price_source, price_version)
VALUES

-- ──────────────────────────────────────────────────────────────────────────────
-- FERROUS — MILD / STRUCTURAL STEEL
-- ──────────────────────────────────────────────────────────────────────────────
(NULL, TRUE, 'Ferrous Metals', 'Mild Steel IS2062', 'E250A',
 7850, 0.72, 'USD', 'GL', NULL, 'Sheet',   'sheet_metal', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'Mild Steel IS2062', 'E250A',
 7850, 0.70, 'USD', 'GL', NULL, 'Bar',     'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'Mild Steel IS2062', 'E350 - High Strength',
 7850, 0.82, 'USD', 'GL', NULL, 'Plate',   'sheet_metal', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'CRCA Steel', 'IS513 CR2 - Cold Rolled',
 7850, 0.88, 'USD', 'GL', NULL, 'Sheet',   'sheet_metal', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'HRCA Steel', 'IS10748 HR - Hot Rolled',
 7850, 0.68, 'USD', 'GL', NULL, 'Sheet',   'sheet_metal', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'Galvanised Steel', 'IS277 Z120 - GI Sheet',
 7850, 0.95, 'USD', 'GL', NULL, 'Sheet',   'sheet_metal', 'BENCHMARK', 'Q1-2025'),

-- ── MEDIUM / ALLOY STEEL ─────────────────────────────────────────────────────
(NULL, TRUE, 'Ferrous Metals', 'EN8 Steel', 'C45 / 080M40',
 7830, 0.94, 'USD', 'GL', NULL, 'Bar',     'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'EN8 Steel', 'C45 - Flat / Hex',
 7830, 0.96, 'USD', 'GL', NULL, 'Bar',     'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'EN19 Steel', '4140 Cr-Mo Alloy',
 7830, 1.35, 'USD', 'GL', NULL, 'Bar',     'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'EN24 Steel', '4340 Ni-Cr-Mo',
 7830, 1.55, 'USD', 'GL', NULL, 'Bar',     'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'EN31 Steel', '52100 Bearing Steel',
 7810, 1.65, 'USD', 'GL', NULL, 'Bar',     'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'Maraging Steel 300', 'C300 - High-Strength Aerospace',
 8000,18.00, 'USD', 'GL', NULL, 'Bar',     'machining',   'BENCHMARK', 'Q1-2025'),

-- ── TOOL STEEL ───────────────────────────────────────────────────────────────
(NULL, TRUE, 'Ferrous Metals', 'H13 Tool Steel', 'Hot Work Die Steel',
 7800, 4.80, 'USD', 'GL', NULL, 'Block',   'tooling',     'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'D2 Tool Steel', 'Cold Work Die Steel',
 7700, 5.20, 'USD', 'GL', NULL, 'Block',   'tooling',     'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'M2 High Speed Steel', 'HSS',
 8160, 7.50, 'USD', 'GL', NULL, 'Bar',     'tooling',     'BENCHMARK', 'Q1-2025'),

-- ── STAINLESS STEEL ──────────────────────────────────────────────────────────
(NULL, TRUE, 'Ferrous Metals', 'Stainless Steel SS304', '2B Finish',
 8000, 2.95, 'USD', 'GL', NULL, 'Sheet',   'sheet_metal', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'Stainless Steel SS304', 'Round / Hex Bar',
 8000, 2.85, 'USD', 'GL', NULL, 'Bar',     'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'Stainless Steel SS304', 'Seamless Tube',
 8000, 3.20, 'USD', 'GL', NULL, 'Tube',    'general',     'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'Stainless Steel SS316', '2B Finish',
 8000, 3.90, 'USD', 'GL', NULL, 'Sheet',   'sheet_metal', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'Stainless Steel SS316', 'Round Bar',
 8000, 3.75, 'USD', 'GL', NULL, 'Bar',     'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'Stainless Steel SS316L', 'Weldable Sheet / Plate',
 8000, 4.10, 'USD', 'GL', NULL, 'Sheet',   'sheet_metal', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'Stainless Steel SS410', 'Martensitic - Round Bar',
 7740, 2.60, 'USD', 'GL', NULL, 'Bar',     'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'Stainless Steel SS430', 'Ferritic, Magnetic - Sheet',
 7700, 2.30, 'USD', 'GL', NULL, 'Sheet',   'sheet_metal', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'Stainless Steel SS2205', 'Duplex',
 7805, 5.80, 'USD', 'GL', NULL, 'Sheet',   'general',     'BENCHMARK', 'Q1-2025'),

-- ── PRECIPITATION-HARDENING SS (AEROSPACE) ───────────────────────────────────
(NULL, TRUE, 'Ferrous Metals', 'Stainless Steel 17-4PH', 'H900 / H1025 - Bar / Plate',
 7780, 8.50, 'USD', 'GL', NULL, 'Bar',     'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'Stainless Steel 15-5PH', 'H900 / H1025 - Bar / Plate',
 7780, 9.20, 'USD', 'GL', NULL, 'Bar',     'machining',   'BENCHMARK', 'Q1-2025'),

-- ── CAST IRON ────────────────────────────────────────────────────────────────
(NULL, TRUE, 'Ferrous Metals', 'Grey Cast Iron', 'IS210 FG260',
 7200, 0.55, 'USD', 'GL', NULL, 'Casting', 'casting',     'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Ferrous Metals', 'SG Iron', 'IS1865 SG500',
 7100, 0.75, 'USD', 'GL', NULL, 'Casting', 'casting',     'BENCHMARK', 'Q1-2025'),

-- ──────────────────────────────────────────────────────────────────────────────
-- NON-FERROUS — ALUMINIUM
-- ──────────────────────────────────────────────────────────────────────────────
(NULL, TRUE, 'Non-Ferrous Metals', 'Aluminium 6061', 'T6 - Sheet / Plate',
 2700, 2.38, 'USD', 'GL', NULL, 'Sheet',     'sheet_metal', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Aluminium 6061', 'T6 - Round / Hex Bar',
 2700, 2.30, 'USD', 'GL', NULL, 'Bar',       'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Aluminium 6061', 'T6 - Extrusion / Profile',
 2700, 2.55, 'USD', 'GL', NULL, 'Extrusion', 'general',     'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Aluminium 7075', 'T6 - Sheet / Plate',
 2810, 3.50, 'USD', 'GL', NULL, 'Sheet',     'sheet_metal', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Aluminium 7075', 'T651 - Round Bar',
 2810, 3.42, 'USD', 'GL', NULL, 'Bar',       'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Aluminium 5052', 'H32 - Sheet',
 2680, 2.20, 'USD', 'GL', NULL, 'Sheet',     'sheet_metal', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Aluminium 5083', 'H111 - Marine Grade Plate',
 2660, 2.45, 'USD', 'GL', NULL, 'Plate',     'sheet_metal', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Aluminium 6082', 'T6 - Bar / Extrusion',
 2710, 2.35, 'USD', 'GL', NULL, 'Bar',       'machining',   'BENCHMARK', 'Q1-2025'),

-- ── AEROSPACE ALUMINIUM ───────────────────────────────────────────────────────
(NULL, TRUE, 'Non-Ferrous Metals', 'Aluminium 2024', 'T351 - Sheet / Plate',
 2780, 3.10, 'USD', 'GL', NULL, 'Sheet',     'sheet_metal', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Aluminium 2024', 'T3 - Round Bar',
 2780, 3.20, 'USD', 'GL', NULL, 'Bar',       'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Aluminium 7050', 'T7451 - Plate',
 2830, 4.80, 'USD', 'GL', NULL, 'Plate',     'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Aluminium 2219', 'T851 - Plate (Cryogenic / Weldable)',
 2840, 5.20, 'USD', 'GL', NULL, 'Plate',     'machining',   'BENCHMARK', 'Q1-2025'),

-- ── BRASS ────────────────────────────────────────────────────────────────────
(NULL, TRUE, 'Non-Ferrous Metals', 'Brass C360', 'Free-Cutting - Round / Hex Bar',
 8500, 4.45, 'USD', 'GL', NULL, 'Bar',       'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Brass C260', 'Cartridge Brass - Sheet',
 8520, 4.80, 'USD', 'GL', NULL, 'Sheet',     'sheet_metal', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Brass C385', 'Architectural - Extrusion',
 8470, 4.55, 'USD', 'GL', NULL, 'Extrusion', 'general',     'BENCHMARK', 'Q1-2025'),

-- ── COPPER ───────────────────────────────────────────────────────────────────
(NULL, TRUE, 'Non-Ferrous Metals', 'Copper C110', 'ETP - Sheet / Strip',
 8960, 8.50, 'USD', 'GL', NULL, 'Sheet',     'sheet_metal', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Copper C110', 'ETP - Round Bar',
 8960, 8.30, 'USD', 'GL', NULL, 'Bar',       'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Copper C101', 'Oxygen-Free (OF) - Rod',
 8960, 9.20, 'USD', 'GL', NULL, 'Bar',       'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Bronze CuSn8', 'Phosphor Bronze - Bar / Bush',
 8800, 7.80, 'USD', 'GL', NULL, 'Bar',       'machining',   'BENCHMARK', 'Q1-2025'),

-- ── TITANIUM ─────────────────────────────────────────────────────────────────
(NULL, TRUE, 'Non-Ferrous Metals', 'Titanium Grade 2', 'CP Ti - Sheet / Plate',
 4510,18.50, 'USD', 'GL', NULL, 'Sheet',     'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Titanium Grade 5', 'Ti-6Al-4V - Sheet / Plate',
 4430,32.00, 'USD', 'GL', NULL, 'Sheet',     'sheet_metal', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Titanium Grade 5', 'Ti-6Al-4V - Round Bar',
 4430,30.00, 'USD', 'GL', NULL, 'Bar',       'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Titanium Grade 23', 'Ti-6Al-4V ELI - Bar (Medical / Aerospace)',
 4430,38.00, 'USD', 'GL', NULL, 'Bar',       'machining',   'BENCHMARK', 'Q1-2025'),

-- ── NICKEL ALLOYS ────────────────────────────────────────────────────────────
(NULL, TRUE, 'Non-Ferrous Metals', 'Inconel 625', 'Ni-Cr-Mo - Sheet / Bar',
 8440,45.00, 'USD', 'GL', NULL, 'Bar',       'machining',   'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Non-Ferrous Metals', 'Inconel 718', 'Precipitation Hardened - Bar',
 8190,55.00, 'USD', 'GL', NULL, 'Bar',       'machining',   'BENCHMARK', 'Q1-2025'),

-- ──────────────────────────────────────────────────────────────────────────────
-- ENGINEERING PLASTICS
-- ──────────────────────────────────────────────────────────────────────────────
(NULL, TRUE, 'Plastics', 'ABS', 'General Purpose - Natural / Black',
 1050, 1.95, 'USD', 'GL', NULL, 'Granules',  'injection_moulding', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'ABS', 'Flame Retardant V0',
 1060, 2.60, 'USD', 'GL', NULL, 'Granules',  'injection_moulding', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'PP', 'Homopolymer - Natural',
  905, 1.18, 'USD', 'GL', NULL, 'Granules',  'injection_moulding', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'PP', 'Copolymer (Impact Grade)',
  910, 1.25, 'USD', 'GL', NULL, 'Granules',  'injection_moulding', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'PP', 'Glass-Filled 30% (PP-GF30)',
 1120, 1.85, 'USD', 'GL', NULL, 'Granules',  'injection_moulding', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'HDPE', 'Natural - Injection / Blow Moulding',
  950, 1.12, 'USD', 'GL', NULL, 'Granules',  'injection_moulding', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'HDPE', 'Sheet / Rod - Machining Grade',
  955, 2.10, 'USD', 'GL', NULL, 'Sheet',     'machining',          'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'POM', 'Acetal / Delrin - Natural',
 1420, 3.75, 'USD', 'GL', NULL, 'Bar',       'machining',          'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'POM', 'Glass-Filled 20% (POM-GF20)',
 1540, 5.20, 'USD', 'GL', NULL, 'Granules',  'injection_moulding', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'Nylon 6', 'PA6 - Natural',
 1130, 2.65, 'USD', 'GL', NULL, 'Granules',  'injection_moulding', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'Nylon 6', 'PA6-GF30 - Glass-Filled',
 1360, 3.40, 'USD', 'GL', NULL, 'Granules',  'injection_moulding', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'Nylon 66', 'PA66 - Natural',
 1140, 3.15, 'USD', 'GL', NULL, 'Granules',  'injection_moulding', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'Nylon 66', 'PA66-GF30 - Glass-Filled',
 1380, 4.00, 'USD', 'GL', NULL, 'Granules',  'injection_moulding', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'PC', 'Transparent Granules',
 1200, 3.35, 'USD', 'GL', NULL, 'Granules',  'injection_moulding', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'PC', 'Black / Coloured Granules',
 1200, 3.50, 'USD', 'GL', NULL, 'Granules',  'injection_moulding', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'PC', 'Sheet - Optical Grade',
 1200, 5.80, 'USD', 'GL', NULL, 'Sheet',     'general',            'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'PEEK', 'Unfilled - Natural',
 1320,92.00, 'USD', 'GL', NULL, 'Bar',       'machining',          'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'PEEK', 'GF30 - Glass-Filled',
 1490,115.00,'USD', 'GL', NULL, 'Granules',  'injection_moulding', 'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'PVC', 'Rigid - Sheet / Extrusion',
 1400, 1.45, 'USD', 'GL', NULL, 'Sheet',     'general',            'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'PTFE', 'Virgin - Rod / Sheet (Machining)',
 2200,14.50, 'USD', 'GL', NULL, 'Bar',       'machining',          'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'Acrylic PMMA', 'Cast Sheet - Clear',
 1180, 3.20, 'USD', 'GL', NULL, 'Sheet',     'general',            'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Plastics', 'UHMWPE', 'Sheet / Rod - Machining Grade',
  940, 3.80, 'USD', 'GL', NULL, 'Bar',       'machining',          'BENCHMARK', 'Q1-2025'),

-- ──────────────────────────────────────────────────────────────────────────────
-- RUBBER
-- ──────────────────────────────────────────────────────────────────────────────
(NULL, TRUE, 'Rubber', 'Natural Rubber NR', 'SMR20 - Sheet / Moulding Compound',
  920, 1.60, 'USD', 'GL', NULL, 'Sheet',     'general',            'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Rubber', 'Nitrile Rubber NBR', 'Medium ACN - Sheet / O-Ring Cord',
 1000, 3.20, 'USD', 'GL', NULL, 'Sheet',     'general',            'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Rubber', 'EPDM', 'Sheet / Extrusion Compound',
  870, 2.40, 'USD', 'GL', NULL, 'Sheet',     'general',            'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Rubber', 'Silicone Rubber VMQ', 'General Purpose Sheet / Cord',
 1200, 8.50, 'USD', 'GL', NULL, 'Sheet',     'general',            'BENCHMARK', 'Q1-2025'),

(NULL, TRUE, 'Rubber', 'Neoprene CR', 'Sheet / Strip',
 1230, 4.80, 'USD', 'GL', NULL, 'Sheet',     'general',            'BENCHMARK', 'Q1-2025');
