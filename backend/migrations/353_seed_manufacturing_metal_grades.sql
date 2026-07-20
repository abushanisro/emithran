-- ============================================================================
-- Migration 353: Seed Standard Manufacturing Metal Grades
-- ============================================================================
-- Inserts 50+ industry-standard metal grades used in job-shop / sheet-metal /
-- machining manufacturing so the raw-material dropdown shows real matches
-- instead of the PCB/electronics materials from the original import.
--
-- Units:
--   density_kg_m3              kg/m³
--   density                    g/cm³  (kept in sync)
--   ultimate_tensile_strength  MPa
--   yield_tensile_strength     MPa
--   melting_temp_c             °C
--   thermal_conductivity_melt  W/(m·°C)
--   specific_heat_melt         J/(g·°C)   ← per migration 077 COMMENT
--   cost                       INR/kg  (2026 India market)
--
-- Idempotent: skips any row whose `material` already exists.
-- user_id = NULL → global shared library row (migration 349).
-- ============================================================================

INSERT INTO raw_materials (
  material, material_grade, material_group,
  density_kg_m3, density,
  ultimate_tensile_strength, yield_tensile_strength,
  melting_temp_c,
  thermal_conductivity_melt, specific_heat_melt,
  cost,
  user_id
)
SELECT
  v.material, v.material_grade, v.material_group,
  v.density_kg_m3, v.density,
  v.uts, v.yts,
  v.melting,
  v.tc, v.sh,
  v.cost,
  NULL
FROM (VALUES

  -- ── ALUMINIUM ALLOYS ─────────────────────────────────────────────────────
  -- 6xxx series (Mg-Si) — most common structural/extruded alloys
  ('AA6061-T6',  'T6',      'Ferrous & Non-Ferrous', 2710, 2.71,  310,  276,  652,  167.0, 0.896,  250),
  ('AA6061-T4',  'T4',      'Ferrous & Non-Ferrous', 2710, 2.71,  241,  145,  652,  167.0, 0.896,  245),
  ('AA6061-O',   'O',       'Ferrous & Non-Ferrous', 2710, 2.71,  124,   55,  652,  167.0, 0.896,  240),
  ('AA6082-T6',  'T6',      'Ferrous & Non-Ferrous', 2700, 2.70,  310,  260,  650,  170.0, 0.896,  260),
  ('AA6063-T6',  'T6',      'Ferrous & Non-Ferrous', 2700, 2.70,  241,  214,  655,  201.0, 0.900,  240),
  ('AA6060-T6',  'T6',      'Ferrous & Non-Ferrous', 2700, 2.70,  195,  150,  655,  200.0, 0.896,  235),
  -- 7xxx series (Zn-Mg) — high strength aerospace
  ('AA7075-T6',  'T6',      'Ferrous & Non-Ferrous', 2810, 2.81,  572,  503,  477,  130.0, 0.960,  380),
  ('AA7075-T651','T651',    'Ferrous & Non-Ferrous', 2810, 2.81,  572,  503,  477,  130.0, 0.960,  385),
  -- 2xxx series (Cu) — fatigue/aerospace
  ('AA2024-T3',  'T3',      'Ferrous & Non-Ferrous', 2780, 2.78,  483,  345,  502,  121.0, 0.875,  360),
  ('AA2024-T351','T351',    'Ferrous & Non-Ferrous', 2780, 2.78,  483,  345,  502,  121.0, 0.875,  365),
  -- 5xxx series (Mg) — marine/sheet metal
  ('AA5052-H32', 'H32',     'Ferrous & Non-Ferrous', 2680, 2.68,  228,  193,  607,  138.0, 0.880,  255),
  ('AA5083-H111','H111',    'Ferrous & Non-Ferrous', 2660, 2.66,  290,  145,  574,  121.0, 0.900,  270),
  ('AA5754-H22', 'H22',     'Ferrous & Non-Ferrous', 2660, 2.66,  220,  170,  593,  147.0, 0.880,  260),
  -- 3xxx series (Mn) — heat exchangers
  ('AA3003-H14', 'H14',     'Ferrous & Non-Ferrous', 2730, 2.73,  152,  124,  654,  163.0, 0.893,  230),
  -- 1xxx series (pure Al) — electrical/chemical
  ('AA1100-H14', 'H14',     'Ferrous & Non-Ferrous', 2710, 2.71,  124,  117,  657,  222.0, 0.904,  200),

  -- ── STAINLESS STEELS ─────────────────────────────────────────────────────
  -- Austenitic (most common)
  ('SS304',      '304',     'Ferrous & Non-Ferrous', 8000, 8.00,  515,  205, 1400,   16.2, 0.500,  180),
  ('SS304L',     '304L',    'Ferrous & Non-Ferrous', 8000, 8.00,  485,  170, 1400,   16.2, 0.500,  185),
  ('SS316',      '316',     'Ferrous & Non-Ferrous', 8000, 8.00,  515,  205, 1390,   15.9, 0.500,  220),
  ('SS316L',     '316L',    'Ferrous & Non-Ferrous', 8000, 8.00,  485,  170, 1390,   15.9, 0.500,  225),
  ('SS321',      '321',     'Ferrous & Non-Ferrous', 8028, 8.03,  515,  205, 1400,   16.1, 0.500,  230),
  ('SS202',      '202',     'Ferrous & Non-Ferrous', 7920, 7.92,  515,  275, 1400,   16.2, 0.500,  155),
  ('SS201',      '201',     'Ferrous & Non-Ferrous', 7870, 7.87,  515,  275, 1400,   16.2, 0.500,  150),
  -- Ferritic
  ('SS430',      '430',     'Ferrous & Non-Ferrous', 7720, 7.72,  480,  310, 1425,   26.1, 0.460,  140),
  -- Martensitic
  ('SS410',      '410',     'Ferrous & Non-Ferrous', 7750, 7.75,  480,  275, 1480,   24.9, 0.460,  145),
  ('SS420',      '420',     'Ferrous & Non-Ferrous', 7750, 7.75,  586,  345, 1450,   24.9, 0.460,  150),

  -- ── CARBON / MILD STEELS ─────────────────────────────────────────────────
  -- Indian standard structural (IS2062)
  ('IS2062 E250','E250',    'Ferrous & Non-Ferrous', 7850, 7.85,  410,  250, 1510,   50.0, 0.490,   62),
  ('IS2062 E350','E350',    'Ferrous & Non-Ferrous', 7850, 7.85,  490,  350, 1510,   50.0, 0.490,   68),
  ('IS2062 E410','E410',    'Ferrous & Non-Ferrous', 7850, 7.85,  540,  410, 1510,   50.0, 0.490,   72),
  -- Cold-rolled
  ('CRCA',       'CR4',     'Ferrous & Non-Ferrous', 7850, 7.85,  340,  210, 1510,   50.0, 0.490,   72),
  ('DC01',       'DC01',    'Ferrous & Non-Ferrous', 7850, 7.85,  270,  175, 1510,   50.0, 0.490,   68),
  ('DC03',       'DC03',    'Ferrous & Non-Ferrous', 7850, 7.85,  270,  160, 1510,   50.0, 0.490,   70),
  ('DC04',       'DC04',    'Ferrous & Non-Ferrous', 7850, 7.85,  270,  150, 1510,   50.0, 0.490,   72),
  ('DC05',       'DC05',    'Ferrous & Non-Ferrous', 7850, 7.85,  270,  140, 1510,   50.0, 0.490,   74),
  -- General mild steel
  ('Mild Steel', 'MS',      'Ferrous & Non-Ferrous', 7850, 7.85,  400,  250, 1510,   50.0, 0.490,   62),
  -- British/EN engineering steels
  ('EN8',        '080M40',  'Ferrous & Non-Ferrous', 7850, 7.85,  540,  370, 1505,   48.0, 0.490,   78),
  ('EN24',       '817M40',  'Ferrous & Non-Ferrous', 7850, 7.85,  850,  680, 1500,   42.0, 0.490,  120),
  ('EN31',       '535A99',  'Ferrous & Non-Ferrous', 7850, 7.85,  740,  560, 1490,   40.0, 0.490,  130),
  ('EN36',       '655M13',  'Ferrous & Non-Ferrous', 7850, 7.85,  850,  680, 1480,   40.0, 0.490,  135),
  -- SAE/AISI grades
  ('SAE 1018',   '1018',    'Ferrous & Non-Ferrous', 7870, 7.87,  340,  200, 1510,   51.9, 0.486,   70),
  ('SAE 1020',   '1020',    'Ferrous & Non-Ferrous', 7870, 7.87,  380,  210, 1510,   51.9, 0.486,   70),
  ('SAE 1045',   '1045',    'Ferrous & Non-Ferrous', 7870, 7.87,  585,  450, 1480,   49.8, 0.486,   82),
  ('SAE 4140',   '4140',    'Ferrous & Non-Ferrous', 7850, 7.85,  655,  417, 1460,   42.6, 0.473,  110),
  ('SAE 4340',   '4340',    'Ferrous & Non-Ferrous', 7850, 7.85,  745,  470, 1427,   44.5, 0.475,  130),

  -- ── TOOL STEELS ──────────────────────────────────────────────────────────
  ('D2',         'D2',      'Ferrous & Non-Ferrous', 7700, 7.70,  900,  750, 1421,   20.0, 0.460,  350),
  ('H13',        'H13',     'Ferrous & Non-Ferrous', 7760, 7.76,  900,  750, 1380,   24.3, 0.460,  380),
  ('P20',        'P20',     'Ferrous & Non-Ferrous', 7850, 7.85,  900,  700, 1430,   28.0, 0.460,  280),
  ('O1',         'O1',      'Ferrous & Non-Ferrous', 7820, 7.82,  800,  620, 1430,   36.0, 0.460,  300),

  -- ── COPPER ALLOYS ────────────────────────────────────────────────────────
  ('C11000 Copper','ETP',   'Ferrous & Non-Ferrous', 8900, 8.90,  220,   69, 1083,  391.0, 0.385,  850),
  ('C26000 Brass','70/30',  'Ferrous & Non-Ferrous', 8530, 8.53,  338,  105,  915,  120.0, 0.377,  700),
  ('C36000 Brass','60/40',  'Ferrous & Non-Ferrous', 8500, 8.50,  338,  124,  900,  116.0, 0.377,  720),
  ('C51000 Phosphor Bronze','PB',
                            'Ferrous & Non-Ferrous', 8800, 8.80,  380,  160,  960,   63.0, 0.376,  800),

  -- ── TITANIUM ─────────────────────────────────────────────────────────────
  ('Ti Grade 2', 'Grade 2', 'Ferrous & Non-Ferrous', 4510, 4.51,  345,  275, 1668,   16.0, 0.520, 2200),
  ('Ti-6Al-4V',  'Grade 5', 'Ferrous & Non-Ferrous', 4430, 4.43,  950,  880, 1604,    7.2, 0.526, 3500),

  -- ── CAST IRONS ───────────────────────────────────────────────────────────
  ('Grey Cast Iron GR15','IS210 Gr.15', 'Ferrous & Non-Ferrous', 7200, 7.20, 150,  98, 1175, 46.0, 0.460, 48),
  ('Grey Cast Iron GR25','IS210 Gr.25', 'Ferrous & Non-Ferrous', 7200, 7.20, 250, 165, 1175, 46.0, 0.460, 50),
  ('SG Iron 500/7',      'IS1865 500/7','Ferrous & Non-Ferrous', 7100, 7.10, 500, 320, 1175, 36.0, 0.460, 55)

) AS v(material, material_grade, material_group,
       density_kg_m3, density,
       uts, yts, melting, tc, sh, cost)
WHERE NOT EXISTS (
  SELECT 1 FROM raw_materials r WHERE r.material = v.material
);

-- ============================================================================
-- End of migration 353
-- ============================================================================
