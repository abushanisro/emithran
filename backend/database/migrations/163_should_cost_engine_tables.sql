
-- Migration 163: Should-Cost Engine Tables
--
-- Creates and seeds:
--   1. material_price_library          — $/kg by material, grade, form, region
--   2. process_cycle_time_library      — MRR, cutting speed, cycle time by driver
--   3. labor_content_library           — minutes per operation/unit
--   4. supplier_capability_benchmarks  — tolerance/geometry limits by tier
--   5. sustainability_factors          — kgCO2e by material, energy, transport
--
-- All tables are global reference data (no user_id). RLS: SELECT USING (true).
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLE CREATION
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS material_price_library (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  material_category    TEXT        NOT NULL,
  material_name        TEXT        NOT NULL,
  grade                TEXT,
  form                 TEXT        NOT NULL,  -- Bar, Sheet, Tube, Pellets, Ingot, etc.
  region               TEXT        NOT NULL,
  price_usd_per_kg     NUMERIC(9,3) NOT NULL,
  price_min_usd_per_kg NUMERIC(9,3),
  price_max_usd_per_kg NUMERIC(9,3),
  effective_year       INTEGER     DEFAULT 2024,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mat_price_cat ON material_price_library (material_category, region);

CREATE TABLE IF NOT EXISTS process_cycle_time_library (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  process_group     TEXT        NOT NULL,
  process_name      TEXT        NOT NULL,
  driver_label      TEXT        NOT NULL,  -- e.g. 'Mild Steel 3mm', 'Aluminium Rough Mill'
  driver_parameter  TEXT        NOT NULL,  -- 'wall_thickness', 'sheet_thickness', 'material_operation'
  driver_value      NUMERIC,               -- numeric value of the driver (mm, etc.)
  driver_unit       TEXT,
  cycle_time_base   NUMERIC     NOT NULL,
  cycle_time_min    NUMERIC,
  cycle_time_max    NUMERIC,
  cycle_time_unit   TEXT        NOT NULL,  -- 'seconds', 'mm/min', 'cm3/min', 'kg/hr', 'min'
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cycle_process ON process_cycle_time_library (process_group, process_name);

CREATE TABLE IF NOT EXISTS labor_content_library (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  process_group        TEXT        NOT NULL,
  operation            TEXT        NOT NULL,
  task_description     TEXT        NOT NULL,
  unit_of_measure      TEXT        NOT NULL,  -- 'per part', 'per meter', 'per feature', 'per batch'
  time_minutes         NUMERIC(8,2) NOT NULL,
  time_min_minutes     NUMERIC(8,2),
  time_max_minutes     NUMERIC(8,2),
  skill_level          TEXT        NOT NULL,  -- Unskilled / Semi-skilled / Skilled / Expert
  operator_count       INTEGER     DEFAULT 1,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_capability_benchmarks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  process_group     TEXT        NOT NULL,
  process_name      TEXT        NOT NULL,
  metric_category   TEXT        NOT NULL,  -- geometric, tolerance, capacity, lead_time, quality
  metric_name       TEXT        NOT NULL,
  standard_value    TEXT,
  advanced_value    TEXT,
  world_class_value TEXT,
  unit              TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sustainability_factors (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category         TEXT        NOT NULL,  -- Material Production, Grid Electricity, Transport, Process Energy, Waste
  subcategory      TEXT,
  item_name        TEXT        NOT NULL,
  region           TEXT,
  kg_co2e_per_unit NUMERIC(10,4) NOT NULL,
  unit             TEXT        NOT NULL,  -- kg, kWh, tonne-km, m2, etc.
  scope_ghg        TEXT,                  -- Scope 1 / 2 / 3
  source_note      TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- RLS — global reference; all authenticated users read
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl TEXT;
  rec RECORD;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'material_price_library','process_cycle_time_library','labor_content_library',
    'supplier_capability_benchmarks','sustainability_factors'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    FOR rec IN SELECT policyname FROM pg_policies WHERE tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', rec.policyname, tbl);
    END LOOP;
    EXECUTE format('CREATE POLICY "global_select" ON %I FOR SELECT USING (true)', tbl);
  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- SEED: 1. MATERIAL PRICE LIBRARY  (2024 indicative market prices, USD/kg)
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO material_price_library
  (material_category, material_name, grade, form, region,
   price_usd_per_kg, price_min_usd_per_kg, price_max_usd_per_kg, notes)
VALUES
  -- ── Carbon & Alloy Steel ─────────────────────────────────────────────────
  ('Carbon Steel','Mild Steel','EN 1A / 1018',  'Bar',   'India',  0.68, 0.58, 0.80, 'Ex-mill; HR bar'),
  ('Carbon Steel','Mild Steel','EN 1A / 1018',  'Bar',   'China',  0.62, 0.55, 0.72, NULL),
  ('Carbon Steel','Mild Steel','EN 1A / 1018',  'Bar',   'Europe', 0.95, 0.80, 1.15, 'S235/S355 equivalent'),
  ('Carbon Steel','Mild Steel','EN 1A / 1018',  'Bar',   'USA',    1.15, 0.95, 1.40, NULL),
  ('Carbon Steel','MS Sheet',  'IS 2062 / S235', 'Sheet', 'India',  0.72, 0.62, 0.85, 'HR sheet 3-10mm'),
  ('Carbon Steel','MS Sheet',  'S235/S275',      'Sheet', 'Europe', 1.00, 0.85, 1.20, NULL),
  ('Carbon Steel','MS Tube',   'ERW',            'Tube',  'India',  0.85, 0.72, 1.00, 'ERW square/rectangular'),
  ('Carbon Steel','MS Tube',   'ERW',            'Tube',  'Europe', 1.25, 1.05, 1.50, NULL),
  ('Alloy Steel','Alloy Steel','4140',           'Bar',   'India',  1.45, 1.20, 1.75, 'Normalised/annealed'),
  ('Alloy Steel','Alloy Steel','4140',           'Bar',   'Europe', 2.30, 1.90, 2.80, NULL),
  ('Alloy Steel','Alloy Steel','4140',           'Bar',   'USA',    2.60, 2.10, 3.20, NULL),
  ('Alloy Steel','Alloy Steel','4340',           'Bar',   'India',  1.90, 1.55, 2.30, NULL),
  ('Alloy Steel','Alloy Steel','4340',           'Bar',   'Europe', 3.00, 2.40, 3.60, NULL),
  ('Tool Steel','Tool Steel',  'H13',            'Bar',   'India',  4.50, 3.80, 5.50, 'Certified mill cert'),
  ('Tool Steel','Tool Steel',  'H13',            'Bar',   'Europe', 7.00, 5.50, 8.50, NULL),
  ('Tool Steel','Tool Steel',  'P20',            'Bar',   'India',  3.80, 3.20, 4.60, 'Pre-hardened ~30 HRC'),
  ('Tool Steel','Tool Steel',  'D2',             'Bar',   'India',  5.00, 4.20, 6.00, NULL),

  -- ── Stainless Steel ──────────────────────────────────────────────────────
  ('Stainless Steel','SS 304', '304',   'Bar',   'India',  2.90, 2.50, 3.40, 'Ex-mill HR bar'),
  ('Stainless Steel','SS 304', '304',   'Bar',   'China',  2.60, 2.20, 3.00, NULL),
  ('Stainless Steel','SS 304', '304',   'Bar',   'Europe', 3.90, 3.30, 4.60, NULL),
  ('Stainless Steel','SS 304', '304',   'Bar',   'USA',    4.60, 3.80, 5.50, NULL),
  ('Stainless Steel','SS 304', '304',   'Sheet', 'India',  3.10, 2.70, 3.60, '2B finish, 1-6mm'),
  ('Stainless Steel','SS 304', '304',   'Sheet', 'Europe', 4.30, 3.60, 5.20, NULL),
  ('Stainless Steel','SS 316', '316',   'Bar',   'India',  3.70, 3.20, 4.40, NULL),
  ('Stainless Steel','SS 316', '316',   'Bar',   'Europe', 5.20, 4.40, 6.20, NULL),
  ('Stainless Steel','SS 316', '316',   'Bar',   'USA',    6.20, 5.20, 7.50, NULL),
  ('Stainless Steel','SS 316L','316L',  'Sheet', 'India',  3.90, 3.30, 4.70, NULL),
  ('Stainless Steel','SS 316L','316L',  'Sheet', 'Europe', 5.60, 4.70, 6.70, NULL),
  ('Stainless Steel','17-4PH', '17-4PH','Bar',  'India',  8.50, 7.00,10.50, 'Precipitation hardened'),
  ('Stainless Steel','17-4PH', '17-4PH','Bar',  'Europe',14.50,12.00,18.00, NULL),
  ('Stainless Steel','Duplex 2205','2205','Bar', 'Europe', 9.00, 7.50,11.00, NULL),

  -- ── Aluminium ─────────────────────────────────────────────────────────────
  ('Aluminium','Al 6061','6061-T6',    'Bar',   'India',  2.90, 2.50, 3.40, NULL),
  ('Aluminium','Al 6061','6061-T6',    'Bar',   'China',  2.65, 2.30, 3.00, NULL),
  ('Aluminium','Al 6061','6061-T6',    'Bar',   'Europe', 3.60, 3.00, 4.30, NULL),
  ('Aluminium','Al 6061','6061-T6',    'Bar',   'USA',    4.30, 3.60, 5.20, NULL),
  ('Aluminium','Al 6061','6061-T6',    'Sheet', 'India',  3.10, 2.70, 3.70, '1.5-6mm sheet'),
  ('Aluminium','Al 6061','6061-T6',    'Sheet', 'Europe', 3.90, 3.30, 4.70, NULL),
  ('Aluminium','Al 7075','7075-T6',    'Bar',   'India',  5.80, 4.80, 7.00, 'Aerospace; limited domestic supply'),
  ('Aluminium','Al 7075','7075-T6',    'Bar',   'Europe', 8.50, 7.00,10.50, NULL),
  ('Aluminium','Al 7075','7075-T6',    'Bar',   'USA',    9.50, 8.00,12.00, NULL),
  ('Aluminium','Al 2024','2024-T3',    'Sheet', 'Europe', 9.80, 8.00,12.00, 'Aerospace spec sheet'),
  ('Aluminium','Al 5052','5052-H32',   'Sheet', 'India',  3.30, 2.80, 3.90, 'Sheet metal grade'),
  ('Aluminium','Al 5052','5052-H32',   'Sheet', 'Europe', 4.10, 3.50, 5.00, NULL),
  ('Aluminium','Al A380','A380',       'Ingot', 'India',  2.30, 1.90, 2.70, 'Die casting alloy ingot'),
  ('Aluminium','Al A380','A380',       'Ingot', 'China',  2.10, 1.80, 2.50, NULL),
  ('Aluminium','Al A356','A356',       'Ingot', 'India',  2.50, 2.10, 3.00, 'Sand/gravity casting'),

  -- ── Titanium ─────────────────────────────────────────────────────────────
  ('Titanium','Ti Grade 2','Gr2 CP',   'Bar',   'India',  30.00,25.00,38.00, 'Limited domestic; mostly imported'),
  ('Titanium','Ti Grade 2','Gr2 CP',   'Bar',   'Europe', 38.00,32.00,48.00, NULL),
  ('Titanium','Ti-6Al-4V', 'Gr5',      'Bar',   'India',  45.00,38.00,55.00, NULL),
  ('Titanium','Ti-6Al-4V', 'Gr5',      'Bar',   'Europe', 60.00,50.00,75.00, NULL),
  ('Titanium','Ti-6Al-4V', 'Gr5',      'Bar',   'USA',    70.00,58.00,88.00, NULL),
  ('Titanium','Ti-6Al-4V', 'Gr5',      'Sheet', 'Europe', 75.00,62.00,95.00, 'AMS 4928 spec'),

  -- ── Nickel Superalloys ────────────────────────────────────────────────────
  ('Superalloy','Inconel 718','IN718',  'Bar',   'Global', 55.00,45.00,68.00, 'AMS 5662/5664; price volatile with Ni'),
  ('Superalloy','Inconel 625','IN625',  'Sheet', 'Global', 65.00,52.00,80.00, NULL),
  ('Superalloy','Hastelloy C-276','C-276','Bar', 'Global', 72.00,58.00,90.00, NULL),
  ('Superalloy','Waspaloy',  'Waspaloy','Bar',   'Global', 85.00,68.00,110.00,NULL),

  -- ── Copper Alloys ─────────────────────────────────────────────────────────
  ('Copper','Pure Copper',  'Cu-ETP C101','Bar',  'India',  7.80, 7.00, 8.80, 'LME + 10-15% premium; volatile'),
  ('Copper','Pure Copper',  'Cu-ETP C101','Bar',  'Europe', 9.50, 8.50,10.80, NULL),
  ('Copper','Brass',        'CuZn37 C260','Rod',  'India',  5.80, 5.00, 6.80, NULL),
  ('Copper','Brass',        'CuZn37 C260','Rod',  'Europe', 7.50, 6.50, 8.80, NULL),
  ('Copper','Phosphor Bronze','CuSn8',   'Rod',  'India',  8.50, 7.50,10.00, NULL),
  ('Copper','Beryllium Copper','CuBe2',  'Bar',  'Global', 55.00,45.00,70.00,'Controlled handling; toxic dust'),

  -- ── Cast Iron ─────────────────────────────────────────────────────────────
  ('Cast Iron','Grey Cast Iron','EN-GJL-250','Bar/Block','India', 0.58,0.50,0.68,NULL),
  ('Cast Iron','Grey Cast Iron','EN-GJL-250','Bar/Block','Europe',0.82,0.70,0.98,NULL),
  ('Cast Iron','Ductile Iron', 'EN-GJS-500','Bar/Block','India', 0.72,0.62,0.85,NULL),

  -- ── Engineering Plastics ──────────────────────────────────────────────────
  ('Engineering Plastic','ABS',        'Natural',      'Pellets','India',  1.85,1.60,2.20,NULL),
  ('Engineering Plastic','ABS',        'Natural',      'Pellets','China',  1.65,1.40,2.00,NULL),
  ('Engineering Plastic','ABS',        'Natural',      'Pellets','Europe', 2.30,1.90,2.80,NULL),
  ('Engineering Plastic','Nylon PA6',  'Natural',      'Pellets','India',  2.30,2.00,2.70,NULL),
  ('Engineering Plastic','Nylon PA6',  'Natural',      'Pellets','Europe', 2.90,2.40,3.50,NULL),
  ('Engineering Plastic','Nylon PA66', 'Natural',      'Pellets','India',  2.60,2.20,3.10,NULL),
  ('Engineering Plastic','Nylon PA66-GF30','30% GF',  'Pellets','India',  3.30,2.80,4.00,NULL),
  ('Engineering Plastic','Nylon PA66-GF30','30% GF',  'Pellets','Europe', 4.20,3.50,5.00,NULL),
  ('Engineering Plastic','Polycarbonate','Optical',   'Pellets','India',  2.60,2.20,3.10,NULL),
  ('Engineering Plastic','Polycarbonate','Optical',   'Pellets','Europe', 3.30,2.80,4.00,NULL),
  ('Engineering Plastic','PEEK',       'Natural',      'Pellets','India',  90.00,75.00,115.00,'Grivory/Victrex import'),
  ('Engineering Plastic','PEEK',       'Natural',      'Pellets','Europe',110.00,90.00,140.00,NULL),
  ('Engineering Plastic','PEEK',       'Natural',      'Pellets','USA',   125.00,100.00,160.00,NULL),
  ('Engineering Plastic','POM Acetal', 'POM-C',        'Pellets','India',  2.90,2.50,3.50,NULL),
  ('Engineering Plastic','POM Acetal', 'POM-C',        'Pellets','Europe', 3.70,3.10,4.50,NULL),
  ('Engineering Plastic','PP Homopolymer','H110MAS',   'Pellets','India',  1.25,1.05,1.50,NULL),
  ('Engineering Plastic','PP Homopolymer','H110MAS',   'Pellets','Europe', 1.55,1.30,1.90,NULL),
  ('Engineering Plastic','HDPE',       'HD50MA180',    'Pellets','India',  1.35,1.10,1.60,NULL),
  ('Engineering Plastic','PTFE',       'Virgin',       'Pellets','India', 13.00,10.50,16.00,NULL),
  ('Engineering Plastic','PTFE',       'Virgin',       'Pellets','Europe',19.00,15.00,24.00,NULL),
  ('Engineering Plastic','Polysulfone PSU','Udel P-1700','Pellets','India',22.00,18.00,28.00,NULL),

  -- ── Rubber / Elastomers ───────────────────────────────────────────────────
  ('Elastomer','Natural Rubber NR','RSS3',   'Bale',  'India',  1.85,1.50,2.30,'Kerala origin; price volatile'),
  ('Elastomer','Silicone VMQ',     '60 ShA', 'Sheet', 'India',  6.50,5.50,8.00,NULL),
  ('Elastomer','Silicone VMQ',     '60 ShA', 'Sheet', 'Europe', 9.50,8.00,12.00,NULL),
  ('Elastomer','EPDM',             '70 ShA', 'Compound','India',2.60,2.20,3.20,NULL),
  ('Elastomer','NBR Nitrile',      '70 ShA', 'Compound','India',2.90,2.40,3.60,NULL)

ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- SEED: 2. PROCESS CYCLE TIME LIBRARY
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO process_cycle_time_library
  (process_group, process_name, driver_label, driver_parameter,
   driver_value, driver_unit, cycle_time_base, cycle_time_min, cycle_time_max,
   cycle_time_unit, notes)
VALUES
  -- ── Injection Moulding — cycle time vs wall thickness ────────────────────
  -- Rule: dominated by cooling time ≈ 0.5 × t² / α (t = wall mm)
  ('Plastic','Injection Moulding','Wall 1.0mm',  'wall_thickness_mm', 1.0,'mm', 18,12,28, 'seconds','Semi-crystalline faster than amorphous'),
  ('Plastic','Injection Moulding','Wall 1.5mm',  'wall_thickness_mm', 1.5,'mm', 26,18,38, 'seconds',NULL),
  ('Plastic','Injection Moulding','Wall 2.0mm',  'wall_thickness_mm', 2.0,'mm', 36,25,52, 'seconds','Most common wall thickness'),
  ('Plastic','Injection Moulding','Wall 2.5mm',  'wall_thickness_mm', 2.5,'mm', 50,35,70, 'seconds',NULL),
  ('Plastic','Injection Moulding','Wall 3.0mm',  'wall_thickness_mm', 3.0,'mm', 65,45,92, 'seconds',NULL),
  ('Plastic','Injection Moulding','Wall 3.5mm',  'wall_thickness_mm', 3.5,'mm', 85,60,118,'seconds',NULL),
  ('Plastic','Injection Moulding','Wall 4.0mm',  'wall_thickness_mm', 4.0,'mm',108,75,150,'seconds',NULL),
  ('Plastic','Injection Moulding','Wall 5.0mm',  'wall_thickness_mm', 5.0,'mm',155,110,210,'seconds',NULL),
  ('Plastic','Injection Moulding','Wall 6.0mm',  'wall_thickness_mm', 6.0,'mm',215,155,290,'seconds',NULL),

  -- Die Casting (Al) — shorter cycle; rapid water cooling
  ('Casting','Die Casting - Al','Wall 1.5mm',  'wall_thickness_mm', 1.5,'mm', 18,12,28, 'seconds','Cold chamber; faster than IM due to metal conductivity'),
  ('Casting','Die Casting - Al','Wall 2.5mm',  'wall_thickness_mm', 2.5,'mm', 28,20,40, 'seconds',NULL),
  ('Casting','Die Casting - Al','Wall 3.0mm',  'wall_thickness_mm', 3.0,'mm', 35,25,50, 'seconds',NULL),
  ('Casting','Die Casting - Al','Wall 4.0mm',  'wall_thickness_mm', 4.0,'mm', 50,35,70, 'seconds',NULL),
  ('Casting','Die Casting - Al','Wall 5.0mm',  'wall_thickness_mm', 5.0,'mm', 68,48,95, 'seconds',NULL),
  ('Casting','Die Casting - Al','Wall 6.0mm',  'wall_thickness_mm', 6.0,'mm', 90,65,125,'seconds',NULL),

  -- ── CNC Machining — Material Removal Rate (MRR) ─────────────────────────
  -- Use: machining_time_min = (stock_volume_cm3 - net_volume_cm3) / MRR
  ('Machining','CNC Milling','Al - Rough Mill (3-axis Carbide)','material_operation',NULL,NULL, 800,600,1200,'cm3/min','Best-in-class VMC; flood coolant'),
  ('Machining','CNC Milling','Al - Finish Mill (Carbide)',      'material_operation',NULL,NULL, 150,100, 250,'cm3/min',NULL),
  ('Machining','CNC Milling','MS - Rough Mill (Carbide)',       'material_operation',NULL,NULL, 180,120, 280,'cm3/min',NULL),
  ('Machining','CNC Milling','MS - Finish Mill (Carbide)',      'material_operation',NULL,NULL,  40, 25,  60,'cm3/min',NULL),
  ('Machining','CNC Milling','SS304 - Rough Mill',              'material_operation',NULL,NULL,  70, 45, 110,'cm3/min','Work-hardening requires sharp tools'),
  ('Machining','CNC Milling','SS304 - Finish Mill',             'material_operation',NULL,NULL,  20, 12,  30,'cm3/min',NULL),
  ('Machining','CNC Milling','Alloy Steel 4140 - Rough',        'material_operation',NULL,NULL, 120, 80, 180,'cm3/min',NULL),
  ('Machining','CNC Milling','Titanium Ti-6Al-4V - Rough',      'material_operation',NULL,NULL,  30, 15,  50,'cm3/min','Low MRR; heat buildup critical'),
  ('Machining','CNC Milling','Inconel 718 - Rough',             'material_operation',NULL,NULL,  12,  5,  20,'cm3/min','Most difficult; shortest tool life'),
  ('Machining','CNC Turning','Al - Rough Turn',                 'material_operation',NULL,NULL, 600,400, 900,'cm3/min',NULL),
  ('Machining','CNC Turning','Al - Finish Turn',                'material_operation',NULL,NULL, 120, 80, 180,'cm3/min',NULL),
  ('Machining','CNC Turning','MS - Rough Turn',                 'material_operation',NULL,NULL, 150,100, 220,'cm3/min',NULL),
  ('Machining','CNC Turning','MS - Finish Turn',                'material_operation',NULL,NULL,  35, 22,  55,'cm3/min',NULL),
  ('Machining','CNC Turning','SS304 - Rough Turn',              'material_operation',NULL,NULL,  60, 38,  90,'cm3/min',NULL),
  ('Machining','CNC Turning','Titanium - Rough Turn',           'material_operation',NULL,NULL,  25, 12,  40,'cm3/min',NULL),
  ('Machining','CNC Grinding','Steel - Surface Grind',          'material_operation',NULL,NULL,   8,  4,  14,'cm3/min','Wheel dressing counted separately'),
  ('Machining','CNC Grinding','Hardened Steel - Cylindrical',   'material_operation',NULL,NULL,   5,  2,   9,'cm3/min',NULL),

  -- ── Laser Cutting — cutting speed vs material + thickness ────────────────
  -- Use: cut_time_min = total_cut_length_mm / speed + (pierce_time_sec × pierce_count / 60)
  -- Pierce time: MS 0.5-2s, SS 1-3s, Al 1-3s per hole
  ('Sheet Metal','Laser Cutting','MS 1mm  (6kW Fibre)',  'sheet_thickness_mm', 1.0,'mm',6000,4500,8500,'mm/min','N2 or O2 assist'),
  ('Sheet Metal','Laser Cutting','MS 2mm  (6kW Fibre)',  'sheet_thickness_mm', 2.0,'mm',3800,2800,5500,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','MS 3mm  (6kW Fibre)',  'sheet_thickness_mm', 3.0,'mm',2400,1700,3500,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','MS 4mm  (6kW Fibre)',  'sheet_thickness_mm', 4.0,'mm',1600,1100,2300,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','MS 5mm  (6kW Fibre)',  'sheet_thickness_mm', 5.0,'mm',1050, 720,1600,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','MS 6mm  (6kW Fibre)',  'sheet_thickness_mm', 6.0,'mm', 750, 500,1200,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','MS 8mm  (6kW Fibre)',  'sheet_thickness_mm', 8.0,'mm', 450, 300, 720,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','MS 10mm (6kW Fibre)',  'sheet_thickness_mm',10.0,'mm', 280, 180, 450,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','MS 12mm (6kW Fibre)',  'sheet_thickness_mm',12.0,'mm', 190, 120, 310,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','MS 15mm (6kW Fibre)',  'sheet_thickness_mm',15.0,'mm', 120,  75, 200,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','MS 20mm (12kW Fibre)', 'sheet_thickness_mm',20.0,'mm',  65,  40, 110,'mm/min','Requires 12kW+ power'),
  ('Sheet Metal','Laser Cutting','SS304 1mm',            'sheet_thickness_mm', 1.0,'mm',4800,3500,7000,'mm/min','N2 assist for bright edge'),
  ('Sheet Metal','Laser Cutting','SS304 2mm',            'sheet_thickness_mm', 2.0,'mm',2600,1800,4000,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','SS304 3mm',            'sheet_thickness_mm', 3.0,'mm',1500,1000,2300,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','SS304 4mm',            'sheet_thickness_mm', 4.0,'mm', 850, 560,1400,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','SS304 5mm',            'sheet_thickness_mm', 5.0,'mm', 520, 340, 880,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','SS304 6mm',            'sheet_thickness_mm', 6.0,'mm', 330, 210, 580,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','SS304 8mm',            'sheet_thickness_mm', 8.0,'mm', 180, 110, 320,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','SS304 10mm',           'sheet_thickness_mm',10.0,'mm', 105,  65, 190,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','Al 5052 1mm',          'sheet_thickness_mm', 1.0,'mm',5200,3800,7500,'mm/min','N2; reflectivity managed with fibre'),
  ('Sheet Metal','Laser Cutting','Al 5052 2mm',          'sheet_thickness_mm', 2.0,'mm',3000,2100,4500,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','Al 5052 3mm',          'sheet_thickness_mm', 3.0,'mm',1700,1200,2700,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','Al 5052 4mm',          'sheet_thickness_mm', 4.0,'mm', 980, 680,1600,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','Al 5052 6mm',          'sheet_thickness_mm', 6.0,'mm', 350, 230, 600,'mm/min',NULL),
  ('Sheet Metal','Laser Cutting','Al 5052 8mm',          'sheet_thickness_mm', 8.0,'mm', 180, 115, 320,'mm/min',NULL),

  -- ── MIG Welding — travel speed & deposition rate ─────────────────────────
  -- Use: weld_time_min = weld_length_mm / speed  +  setup_time
  ('Welding','MIG Welding','MS Fillet 3mm leg (flat)',  'joint_configuration',NULL,NULL, 500,380,680,'mm/min','4.5 kg/hr wire deposition'),
  ('Welding','MIG Welding','MS Fillet 5mm leg (flat)',  'joint_configuration',NULL,NULL, 350,260,480,'mm/min','6.0 kg/hr'),
  ('Welding','MIG Welding','MS Fillet 6mm leg (flat)',  'joint_configuration',NULL,NULL, 280,200,400,'mm/min','6.5 kg/hr'),
  ('Welding','MIG Welding','MS Butt 5mm (flat)',        'joint_configuration',NULL,NULL, 380,280,520,'mm/min','V-prep; single pass'),
  ('Welding','MIG Welding','MS Butt 10mm (flat)',       'joint_configuration',NULL,NULL, 200,140,300,'mm/min','Multi-pass; 3-4 runs'),
  ('Welding','MIG Welding','SS304 Fillet 3mm',          'joint_configuration',NULL,NULL, 400,300,560,'mm/min','Pulse MIG; 3.5 kg/hr'),
  ('Welding','TIG Welding','SS304 Butt 2mm (flat)',     'joint_configuration',NULL,NULL, 180,120,260,'mm/min','1.5 kg/hr; autogenous'),
  ('Welding','TIG Welding','SS304 Butt 3mm (flat)',     'joint_configuration',NULL,NULL, 120, 80,180,'mm/min','Filler required'),
  ('Welding','TIG Welding','Ti-6Al-4V Butt 2mm',       'joint_configuration',NULL,NULL, 100, 60,160,'mm/min','Purge back shielding essential'),
  ('Welding','TIG Welding','Al 5052 Butt 3mm',         'joint_configuration',NULL,NULL, 250,180,380,'mm/min','AC TIG; 2.5 kg/hr'),
  ('Welding','Spot Welding','MS 1.0+1.0mm',            'joint_configuration',NULL,NULL,   4,  2,  6,'seconds/spot','Including squeeze + weld + hold'),
  ('Welding','Spot Welding','MS 1.5+1.5mm',            'joint_configuration',NULL,NULL,   5,  3,  7,'seconds/spot',NULL),
  ('Welding','Spot Welding','MS 2.0+2.0mm',            'joint_configuration',NULL,NULL,   6,  4,  9,'seconds/spot',NULL),
  ('Welding','MIG Welding','Wire Deposition (Mild Steel)',  'deposition_rate',NULL,NULL,   5.0,3.5,8.0,'kg/hr','Typical GMAW; varies with wire dia + current'),
  ('Welding','TIG Welding','Wire Deposition (SS/Ti/Al)',    'deposition_rate',NULL,NULL,   1.5,0.8,2.5,'kg/hr','Operator skill dominant factor'),

  -- ── Thermoforming — cycle time vs thickness ──────────────────────────────
  ('Plastic','Thermoforming','Sheet 1.5mm HDPE', 'sheet_thickness_mm',1.5,'mm', 35,25, 50,'seconds','Heating + forming + cooling + trim'),
  ('Plastic','Thermoforming','Sheet 3.0mm HDPE', 'sheet_thickness_mm',3.0,'mm', 60,45, 85,'seconds',NULL),
  ('Plastic','Thermoforming','Sheet 5.0mm HDPE', 'sheet_thickness_mm',5.0,'mm',100,75,140,'seconds',NULL),
  ('Plastic','Thermoforming','Sheet 3.0mm ABS',  'sheet_thickness_mm',3.0,'mm', 70,50, 95,'seconds',NULL),
  ('Plastic','Thermoforming','Sheet 6.0mm PP',   'sheet_thickness_mm',6.0,'mm',120,90,160,'seconds',NULL),

  -- ── Press Brake Bending ───────────────────────────────────────────────────
  ('Sheet Metal','Sheet Metal Bending','MS 1.0mm single bend', 'bending_operation',NULL,NULL,  8,  5, 14,'seconds/bend','Load+position+bend+measure+unload'),
  ('Sheet Metal','Sheet Metal Bending','MS 2.0mm single bend', 'bending_operation',NULL,NULL, 12,  8, 20,'seconds/bend',NULL),
  ('Sheet Metal','Sheet Metal Bending','MS 3.0mm single bend', 'bending_operation',NULL,NULL, 18, 12, 28,'seconds/bend','Springback correction adds time'),
  ('Sheet Metal','Sheet Metal Bending','MS 5.0mm single bend', 'bending_operation',NULL,NULL, 28, 18, 42,'seconds/bend','CNC backgauge repositioning'),
  ('Sheet Metal','Sheet Metal Bending','SS 2.0mm single bend', 'bending_operation',NULL,NULL, 18, 12, 28,'seconds/bend','Greater springback; extra adjustments')

ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- SEED: 3. LABOR CONTENT LIBRARY
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO labor_content_library
  (process_group, operation, task_description, unit_of_measure,
   time_minutes, time_min_minutes, time_max_minutes, skill_level, operator_count, notes)
VALUES
  -- ── Machine Loading / Handling ────────────────────────────────────────────
  ('Machining','Machine Loading','Load/unload CNC — small part <1kg',        'per part',   1.5, 0.8, 2.5,'Semi-skilled',1,'Includes gauge check before cycle start'),
  ('Machining','Machine Loading','Load/unload CNC — medium part 1-5kg',      'per part',   3.0, 1.8, 5.0,'Semi-skilled',1,NULL),
  ('Machining','Machine Loading','Load/unload CNC — large part >5kg (hoist)','per part',   8.0, 5.0,14.0,'Semi-skilled',2,'2-person lift; hoist time included'),
  ('Machining','Setup','CNC Milling setup — simple (1-2 ops)',               'per batch',  45,  25, 75,'Skilled',     1,'Program load, datum set, first-off check'),
  ('Machining','Setup','CNC Milling setup — complex (3+ ops, fixtures)',     'per batch', 120,  70,200,'Skilled',     1,'Multi-fixture; 5-axis setup'),
  ('Machining','Setup','CNC Turning setup (bar-fed auto)',                   'per batch',  20,  12, 35,'Skilled',     1,'Bar change + program; first-off check'),
  ('Machining','Deburring','Deburring — simple (file/stone)',                'per part',   3.0, 1.5, 6.0,'Semi-skilled',1,'Small prismatic; 3-4 edges'),
  ('Machining','Deburring','Deburring — complex (multiple bores + edges)',   'per part',   8.0, 5.0,15.0,'Semi-skilled',1,'Rotary burr + stone + air'),
  ('Machining','Deburring','Vibratory deburring — load/unload batch',       'per batch',   5.0, 3.0, 9.0,'Unskilled',   1,'Machine does the work; labour is load/unload'),

  -- ── Sheet Metal ───────────────────────────────────────────────────────────
  ('Sheet Metal','Setup','Laser nest setup + DXF import',          'per batch',  15,  8, 25,'Skilled',    1,'Nesting software; check scrap %'),
  ('Sheet Metal','Handling','Load sheet to laser (manual <20kg)',   'per sheet',   2.0, 1.0, 3.5,'Semi-skilled',1,NULL),
  ('Sheet Metal','Handling','Load sheet to laser (crane >20kg)',    'per sheet',   5.0, 3.0, 9.0,'Semi-skilled',2,NULL),
  ('Sheet Metal','Handling','Sort + deslag laser parts',            'per sheet',  12,  8, 20,'Semi-skilled',1,'Remove dross, separate parts from skeleton'),
  ('Sheet Metal','Setup','Press brake setup — first article bend',  'per batch',  20, 12, 35,'Skilled',    1,'Set back gauge + test bend + measure'),
  ('Sheet Metal','Handling','Load/bend/unload press brake (small)', 'per part',   1.5, 0.8, 2.8,'Semi-skilled',1,'Per hit cycle time labour'),
  ('Sheet Metal','Handling','Load/bend/unload press brake (large)', 'per part',   5.0, 3.0, 9.0,'Semi-skilled',2,'Panel >1m; 2 person'),
  ('Sheet Metal','Finishing','Grind weld seam flush',               'per meter',  8.0, 5.0,14.0,'Skilled',    1,'Angle grinder + flap disc'),
  ('Sheet Metal','Finishing','Apply PVC protective film',           'per part',   2.0, 1.0, 4.0,'Unskilled',  1,NULL),

  -- ── Welding ───────────────────────────────────────────────────────────────
  ('Welding','Setup','MIG weld — fixture load + tack up simple part', 'per part',  5.0, 3.0, 9.0,'Skilled',   1,'Before continuous weld'),
  ('Welding','Setup','MIG weld — fixture complex assembly',           'per part', 20,  12, 35,'Skilled',    1,'Multiple datums; measurement before welding'),
  ('Welding','Post-process','Post-weld clean + spatter removal',      'per part',  4.0, 2.0, 8.0,'Semi-skilled',1,'Wire brush + chipping hammer + grind'),
  ('Welding','Post-process','Straighten distorted weldment',         'per part', 15,  8, 35,'Skilled',    1,'Highly variable; press or heat straighten'),
  ('Welding','Setup','TIG weld — purge setup + tack (SS/Ti)',        'per part', 10,  6, 18,'Skilled',    1,'Back purge rig setup; gas flow check'),
  ('Welding','Post-process','Weld inspection — visual per EN ISO 5817','per meter', 2.0, 1.0, 4.0,'Skilled',  1,'Trained inspector; record keeping'),

  -- ── Casting / Moulding ───────────────────────────────────────────────────
  ('Plastic','Post-process','Injection mould part — degate + deburr', 'per part',  0.8, 0.3, 2.0,'Semi-skilled',1,'Gate size critical; auto-degating reduces this'),
  ('Plastic','Post-process','Inspect moulding (visual + dim spot)',    'per part',  0.5, 0.2, 1.2,'Semi-skilled',1,'AQL sampling; not 100%'),
  ('Casting','Post-process','Die cast — trim gate/flash (manual)',     'per part',  1.5, 0.8, 3.0,'Semi-skilled',1,'Hydraulic trim die reduces to <0.5 min'),
  ('Casting','Post-process','Shot blast cast part',                    'per part',  1.0, 0.5, 2.0,'Unskilled',  1,'Batch process; per-part allocation'),

  -- ── Surface Treatment ─────────────────────────────────────────────────────
  ('Surface','Masking','Mask threaded holes + machined surfaces (3-5 features)', 'per part',  4.0, 2.0, 8.0,'Semi-skilled',1,'Plug + tape; critical before anodise/coat'),
  ('Surface','Masking','Mask complex part (>10 features)',            'per part', 12,  7, 20,'Semi-skilled',1,NULL),
  ('Surface','Handling','Hang parts on anodising/plating rack',       'per part',  1.5, 0.8, 3.0,'Semi-skilled',1,NULL),
  ('Surface','Handling','De-rack + inspect after coating',            'per part',  1.0, 0.5, 2.0,'Semi-skilled',1,NULL),
  ('Surface','Post-process','Touch-up powder coat defects',           'per part',  5.0, 2.0,12.0,'Skilled',    1,'Re-coat + re-cure; allowance for ~5% parts'),

  -- ── Assembly ─────────────────────────────────────────────────────────────
  ('Assembly','Manual Assembly','Simple 2-part snap/press fit',            'per assembly',  0.5, 0.2, 1.0,'Unskilled',  1,NULL),
  ('Assembly','Manual Assembly','Fastener install M4-M8 (torque wrench)',  'per fastener',  0.4, 0.2, 0.8,'Semi-skilled',1,'Includes torque to spec + mark'),
  ('Assembly','Manual Assembly','Fastener install M10-M16',               'per fastener',  0.8, 0.4, 1.5,'Semi-skilled',1,NULL),
  ('Assembly','Manual Assembly','Insert threaded Helicoil/Keensert',      'per insert',    1.2, 0.7, 2.2,'Semi-skilled',1,NULL),
  ('Assembly','Manual Assembly','Press-fit bearing/bushing (arbor press)', 'per part',     2.0, 1.0, 4.0,'Skilled',    1,'Check parallelism after fit'),
  ('Assembly','Manual Assembly','Apply adhesive / sealant bead',          'per joint',     2.5, 1.2, 5.0,'Semi-skilled',1,'Dispense + spread + verify coverage'),
  ('Assembly','Manual Assembly','O-ring fit (small <25mm)',               'per O-ring',    0.4, 0.2, 0.8,'Semi-skilled',1,'Lubricate + seat; check for twist'),
  ('Assembly','Manual Assembly','O-ring fit (large >50mm)',               'per O-ring',    0.8, 0.4, 1.8,'Semi-skilled',1,NULL),
  ('Assembly','Manual Assembly','Electrical connector pin insertion',      'per connector', 0.8, 0.4, 1.5,'Semi-skilled',1,NULL),
  ('Assembly','Manual Assembly','Cable / harness routing + secure',       'per harness',   5.0, 3.0,10.0,'Semi-skilled',1,NULL),
  ('Assembly','Testing','Functional test — simple go/no-go',              'per unit',      1.5, 0.8, 3.0,'Semi-skilled',1,'Automated test rig; operator load/unload'),
  ('Assembly','Testing','Functional test — complex multi-parameter',      'per unit',     10,  5, 20,'Skilled',    1,'Multiple check steps; record results'),
  ('Assembly','Testing','Leak test (air under water)',                    'per unit',      3.0, 1.5, 6.0,'Semi-skilled',1,'Pressurize + submerge + inspect + dry'),

  -- ── Quality / Inspection ─────────────────────────────────────────────────
  ('Quality','Inspection','Visual inspection — standard',                'per part',   0.5, 0.2, 1.0,'Semi-skilled',1,'Surface finish, obvious defects'),
  ('Quality','Inspection','Dimensional check — caliper (3-5 dims)',     'per part',   2.0, 1.0, 4.0,'Skilled',    1,NULL),
  ('Quality','Inspection','Dimensional check — caliper (10+ dims)',     'per part',   6.0, 4.0,10.0,'Skilled',    1,NULL),
  ('Quality','Inspection','CMM — first article program creation',       'per program',60,  35,100,'Expert',     1,'Balloon drawing + write program + validate'),
  ('Quality','Inspection','CMM — run existing program (1-20 features)', 'per part',   5.0, 3.0, 9.0,'Skilled',   1,'Includes fixture, run, report'),
  ('Quality','Inspection','CMM — run complex program (50+ features)',   'per part',  20,  12, 35,'Skilled',    1,NULL),
  ('Quality','Inspection','Hardness test (Rockwell)',                   'per part',   1.5, 0.8, 3.0,'Skilled',   1,'3 readings per part; calibration check'),
  ('Quality','Inspection','Surface roughness (profilometer)',           'per surface', 2.0, 1.0, 4.0,'Skilled',  1,'Per measured surface; calibrate before use'),

  -- ── Packing / Shipping ────────────────────────────────────────────────────
  ('Packing','Packing','Pack small part — poly bag + label',           'per part',   0.5, 0.2, 1.0,'Unskilled',  1,NULL),
  ('Packing','Packing','Pack medium part — bubble wrap + carton',      'per part',   1.5, 0.8, 3.0,'Unskilled',  1,NULL),
  ('Packing','Packing','Pack large/fragile — custom foam + crate',     'per part',   8.0, 5.0,15.0,'Semi-skilled',1,NULL),
  ('Packing','Documentation','Create delivery note + shipping label',  'per shipment',2.0, 1.0, 4.0,'Semi-skilled',1,'Per consignment; not per part'),
  ('Packing','Documentation','Compile quality cert + material certs',  'per lot',    15,  8, 30,'Skilled',    1,'COC + mill certs + inspection report')

ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- SEED: 4. SUPPLIER CAPABILITY BENCHMARKS
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO supplier_capability_benchmarks
  (process_group, process_name, metric_category, metric_name,
   standard_value, advanced_value, world_class_value, unit, notes)
VALUES
  -- ── Injection Moulding ────────────────────────────────────────────────────
  ('Plastic','Injection Moulding','geometric',  'Minimum wall thickness',       '1.50','0.80','0.40','mm',   'Thinner = higher tooling cost + flow risk'),
  ('Plastic','Injection Moulding','geometric',  'Maximum wall thickness',       '6.0', '12.0','20.0','mm',   'Above 6mm: sink/void risk; structural foam needed'),
  ('Plastic','Injection Moulding','geometric',  'Max part diagonal dimension',  '400', '800', '1500','mm',   'Driven by platen size'),
  ('Plastic','Injection Moulding','geometric',  'Minimum draft angle (textured)','1.5°','0.5°','0.25°','degrees','Texturing requires more draft'),
  ('Plastic','Injection Moulding','tolerance',  'Linear dimensional tolerance', '±0.20','±0.10','±0.05','mm','Per 100mm; material shrink adds variability'),
  ('Plastic','Injection Moulding','tolerance',  'Flatness (100mm span)',        '0.30','0.15','0.08','mm',   'Amorphous plastics better than semi-crystalline'),
  ('Plastic','Injection Moulding','quality',    'Surface finish (A-side, as-moulded)','Ra 1.6','Ra 0.4','Ra 0.1','µm','Tool steel polish grade determines this'),
  ('Plastic','Injection Moulding','quality',    'Weld line visibility',         'Visible','Faint','None','',  'Gate position + mould fill analysis driven'),
  ('Plastic','Injection Moulding','lead_time',  'T1 sample lead time',          '6','4','2','weeks',          'From approved design; steel tooling'),
  ('Plastic','Injection Moulding','capacity',   'Max shot weight',              '500','2000','8000','g',       NULL),

  -- ── CNC Machining ─────────────────────────────────────────────────────────
  ('Machining','CNC Milling','geometric',  'Minimum hole diameter',             '2.0','0.5','0.1','mm',    '3-axis; smaller = EDM or micro-drill'),
  ('Machining','CNC Milling','geometric',  'Minimum wall thickness',            '0.8','0.3','0.1','mm',    'Material-dependent; Al allows thinner'),
  ('Machining','CNC Milling','geometric',  'Maximum part size (X×Y×Z)',        '500×500×400','2000×1000×800','5000×2000×1500','mm',NULL),
  ('Machining','CNC Milling','geometric',  'Minimum internal corner radius',    '0.5','0.15','0.05','mm',  'Driven by smallest tool radius used'),
  ('Machining','CNC Milling','tolerance',  'Linear positional tolerance',       '±0.05','±0.010','±0.002','mm','5-axis enables tighter on complex geometry'),
  ('Machining','CNC Milling','tolerance',  'Diameter tolerance (reamed bore)',  'H7±0.018','H6±0.011','H5±0.008','mm','For 10-18mm diameter range'),
  ('Machining','CNC Milling','quality',    'Surface finish (milled, as-cut)',   'Ra 1.6','Ra 0.4','Ra 0.1','µm','Finish pass + tool geometry determines Ra'),
  ('Machining','CNC Milling','quality',    'Surface finish (ground)',           'Ra 0.4','Ra 0.1','Ra 0.025','µm',NULL),
  ('Machining','CNC Milling','lead_time',  'Lead time 1-10 parts',              '10','5','2','working days',NULL),
  ('Machining','CNC Milling','lead_time',  'Lead time 100-500 parts',           '4','3','2','weeks',       'Dedicated fixture + optimised cycle time'),

  -- ── Laser Cutting ─────────────────────────────────────────────────────────
  ('Sheet Metal','Laser Cutting','geometric',  'Minimum hole diameter (rule of thumb)','= thickness','0.8× thickness','0.5× thickness','',NULL),
  ('Sheet Metal','Laser Cutting','geometric',  'Minimum slot width',           '1.5','1.0','0.6','mm',     'Narrower = heat buildup + corner blowout'),
  ('Sheet Metal','Laser Cutting','geometric',  'Maximum sheet thickness (MS)',  '15','25','40','mm',        'Power class dependent'),
  ('Sheet Metal','Laser Cutting','geometric',  'Maximum sheet size',           '1500×3000','2000×4000','2500×6000','mm',NULL),
  ('Sheet Metal','Laser Cutting','tolerance',  'Profile dimensional tolerance', '±0.15','±0.08','±0.05','mm','Depends on feature size and position in sheet'),
  ('Sheet Metal','Laser Cutting','quality',    'Edge roughness (MS)',           'Rz 50','Rz 25','Rz 12','µm','Rz measured on cut face'),
  ('Sheet Metal','Laser Cutting','quality',    'Dross / edge taper',           'Visible dross','Light dross','Dross-free','',  'N2 assist eliminates dross at higher cost'),
  ('Sheet Metal','Laser Cutting','lead_time',  'Lead time (standard batch)',    '5','3','1','working days', NULL),

  -- ── Sheet Metal Bending ───────────────────────────────────────────────────
  ('Sheet Metal','Sheet Metal Bending','geometric',  'Minimum bend radius (MS)',   '1.0× t','0.5× t','0.3× t','× material thickness','Tighter = risk of cracking; anneal if needed'),
  ('Sheet Metal','Sheet Metal Bending','geometric',  'Minimum flange length',      '4× t','3× t','2× t','× material thickness','Below this = press brake cannot grip'),
  ('Sheet Metal','Sheet Metal Bending','tolerance',  'Bend angle tolerance',       '±1.0°','±0.5°','±0.2°','degrees',NULL),
  ('Sheet Metal','Sheet Metal Bending','tolerance',  'Overall length after bending','±0.5','±0.25','±0.10','mm',NULL),
  ('Sheet Metal','Sheet Metal Bending','quality',    'Flatness (per meter)',        '1.0','0.5','0.2','mm/m', 'Residual stress in sheet causes bow'),

  -- ── Die Casting ───────────────────────────────────────────────────────────
  ('Casting','Die Casting','geometric',  'Minimum wall thickness (Al)',      '1.5','0.8','0.5','mm',        'Larger part = thicker min wall practical'),
  ('Casting','Die Casting','geometric',  'Maximum part weight (Al)',         '3','12','30','kg',             'Machine tonnage and shot volume limit'),
  ('Casting','Die Casting','geometric',  'Draft angle (external)',           '1.0°','0.5°','0.25°','degrees',NULL),
  ('Casting','Die Casting','tolerance',  'As-cast dimensional tolerance',    '±0.25','±0.10','±0.05','mm',   'IT grade 13-15 as-cast; 7-8 if machined'),
  ('Casting','Die Casting','quality',    'Surface finish (as-cast)',         'Ra 3.2','Ra 1.6','Ra 0.8','µm',NULL),
  ('Casting','Die Casting','quality',    'Porosity (% by volume)',           '<2%','<0.5%','<0.1%',  '%',    'X-ray or CT scan required to verify'),
  ('Casting','Die Casting','lead_time',  'T1 sample (die design + trial)',   '10','7','4','weeks',           NULL),

  -- ── Investment Casting ────────────────────────────────────────────────────
  ('Casting','Investment Casting','geometric','Minimum wall thickness',      '2.5','1.5','0.8','mm',        'Shell thickness limits minimum feature'),
  ('Casting','Investment Casting','geometric','Maximum part weight',          '25','100','500','kg',          'Cluster casting enables lighter alloys'),
  ('Casting','Investment Casting','tolerance','CT Grade (ISO 8062)',          'CT7-8','CT5-6','CT3-4','',    'CT4 = ±0.26mm at 100mm; approaches maching'),
  ('Casting','Investment Casting','quality',  'Surface finish (as-cast)',     'Ra 3.2','Ra 1.6','Ra 0.8','µm',NULL),
  ('Casting','Investment Casting','lead_time','T1 sample lead time',          '10','7','4','weeks',          'Die + wax + shell + cast + clean'),

  -- ── Welding ───────────────────────────────────────────────────────────────
  ('Welding','MIG Welding','tolerance',  'Assembly positional tolerance',    '±2.0','±0.8','±0.3','mm',     'After fixturing and welding'),
  ('Welding','MIG Welding','tolerance',  'Distortion per 500mm weld',        '2.0','0.8','0.3','mm',        'Jig design + weld sequence critical'),
  ('Welding','MIG Welding','quality',    'Visual weld class (EN ISO 5817)',  'Grade C','Grade B','Grade A',  '','Grade A = highest'),
  ('Welding','TIG Welding','quality',    'Visual weld class',                'Grade B','Grade A','Grade A (RT)','','RT = radiographic tested'),

  -- ── Grinding ──────────────────────────────────────────────────────────────
  ('Machining','Grinding / Honing','tolerance','Cylindrical bore tolerance',  'IT7','IT5','IT4','IT grade','IT5 = ±0.006mm at Ø25mm'),
  ('Machining','Grinding / Honing','tolerance','Cylindrical roundness',       '0.005','0.002','0.0005','mm', NULL),
  ('Machining','Grinding / Honing','quality',  'Surface finish',              'Ra 0.4','Ra 0.1','Ra 0.025','µm',NULL),

  -- ── Forging ───────────────────────────────────────────────────────────────
  ('Forging','Hot Forging','geometric',  'Minimum web thickness',            '6','3','1.5','mm',            'Below this: incomplete fill + die failure'),
  ('Forging','Hot Forging','geometric',  'Minimum fillet radius',            '3','1.5','0.8','mm',          NULL),
  ('Forging','Hot Forging','tolerance',  'As-forged dimensional tolerance',  '±1.0','±0.5','±0.25','mm',   'Machining needed for functional surfaces'),
  ('Forging','Hot Forging','quality',    'Grain flow (fibre)','Visible', 'Optimised','Validated by macro',  '','Optimised grain = best fatigue life')

ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- SEED: 5. SUSTAINABILITY FACTORS (kgCO2e)
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO sustainability_factors
  (category, subcategory, item_name, region,
   kg_co2e_per_unit, unit, scope_ghg, source_note, notes)
VALUES
  -- ── Material Production (Scope 3 upstream) ────────────────────────────────
  ('Material Production','Metal','Aluminium (primary, global avg)',    NULL,    12.50, 'kg material', 'Scope 3', 'IAI 2023',  '9-17 range; smelter energy mix dominant factor'),
  ('Material Production','Metal','Aluminium (primary, hydro-powered)', NULL,     4.50, 'kg material', 'Scope 3', 'IAI 2023',  'Iceland/Norway hydro smelters; lowest footprint'),
  ('Material Production','Metal','Aluminium (recycled secondary)',      NULL,     0.75, 'kg material', 'Scope 3', 'IAI 2023',  '94% energy saving vs primary'),
  ('Material Production','Metal','Steel (BF-BOF, primary)',            NULL,     2.20, 'kg material', 'Scope 3', 'World Steel 2023','Blast furnace route; global avg'),
  ('Material Production','Metal','Steel (EAF, recycled scrap)',        NULL,     0.55, 'kg material', 'Scope 3', 'World Steel 2023','Electric arc; scrap-based'),
  ('Material Production','Metal','Stainless Steel 304',                NULL,     6.80, 'kg material', 'Scope 3', 'ISSF 2022',       'Ni + Cr alloy additions add CO2'),
  ('Material Production','Metal','Stainless Steel 316',                NULL,     7.20, 'kg material', 'Scope 3', 'ISSF 2022',       'Higher Mo content'),
  ('Material Production','Metal','Titanium (Ti-6Al-4V)',               NULL,    36.00, 'kg material', 'Scope 3', 'TIMET / literature','Kroll process extremely energy intensive'),
  ('Material Production','Metal','Nickel (primary)',                   NULL,    14.00, 'kg material', 'Scope 3', 'Nickel Institute 2021',NULL),
  ('Material Production','Metal','Inconel 718',                        NULL,    21.00, 'kg material', 'Scope 3', 'Estimated',         'Ni base + Cr + Mo + Nb alloy production'),
  ('Material Production','Metal','Copper (primary)',                   NULL,     3.50, 'kg material', 'Scope 3', 'ICSG 2022',         NULL),
  ('Material Production','Metal','Copper (recycled)',                  NULL,     0.50, 'kg material', 'Scope 3', 'ICSG 2022',         NULL),
  ('Material Production','Metal','Brass (CuZn37)',                     NULL,     4.00, 'kg material', 'Scope 3', 'Estimated',         NULL),
  ('Material Production','Metal','Cast Iron (grey)',                   NULL,     1.80, 'kg material', 'Scope 3', 'Literature',        'Cupola or EAF; less than BOF steel'),
  ('Material Production','Plastic','ABS',                             NULL,     4.10, 'kg material', 'Scope 3', 'PlasticEurope 2023','Petrochemical feedstock + polymerisation'),
  ('Material Production','Plastic','Polypropylene (PP)',              NULL,     2.80, 'kg material', 'Scope 3', 'PlasticEurope 2023',NULL),
  ('Material Production','Plastic','Nylon PA6',                       NULL,     6.50, 'kg material', 'Scope 3', 'PlasticEurope 2023','Caprolactam production energy-intensive'),
  ('Material Production','Plastic','Nylon PA66',                      NULL,     7.00, 'kg material', 'Scope 3', 'PlasticEurope 2023',NULL),
  ('Material Production','Plastic','PEEK',                            NULL,    25.00, 'kg material', 'Scope 3', 'Estimated',         'Complex synthesis; very high value resin'),
  ('Material Production','Plastic','POM Acetal',                      NULL,     4.20, 'kg material', 'Scope 3', 'PlasticEurope 2023',NULL),
  ('Material Production','Plastic','Polycarbonate (PC)',              NULL,     5.00, 'kg material', 'Scope 3', 'PlasticEurope 2023',NULL),
  ('Material Production','Plastic','PTFE',                            NULL,    12.00, 'kg material', 'Scope 3', 'Estimated',         'Fluoropolymer; F2 handling intensive'),
  ('Material Production','Plastic','HDPE',                            NULL,     2.00, 'kg material', 'Scope 3', 'PlasticEurope 2023',NULL),
  ('Material Production','Elastomer','Natural Rubber',                NULL,     3.50, 'kg material', 'Scope 3', 'IRSG 2022',         'Plantation + processing; deforestation risk'),
  ('Material Production','Elastomer','Silicone VMQ',                  NULL,     7.00, 'kg material', 'Scope 3', 'Estimated',         'Silicon + methyl chloride synthesis'),
  ('Material Production','Composite','CFRP (woven CF/epoxy)',         NULL,    29.00, 'kg material', 'Scope 3', 'Duflou et al.',     'PAN precursor carbonisation very intensive'),
  ('Material Production','Composite','GFRP (E-glass/epoxy)',          NULL,     5.00, 'kg material', 'Scope 3', 'Literature',        NULL),

  -- ── Grid Electricity (Scope 2) ────────────────────────────────────────────
  ('Grid Electricity','National Grid','UK Grid',                  'UK',        0.207, 'kWh', 'Scope 2', 'DESNZ 2023 grid factor',  '2023 SAP/carbon factor'),
  ('Grid Electricity','National Grid','EU Average',               'Europe',    0.233, 'kWh', 'Scope 2', 'EEA 2023',                'Weighted EU-27 average'),
  ('Grid Electricity','National Grid','Germany',                  'Germany',   0.380, 'kWh', 'Scope 2', 'UBA 2023',                'Coal + renewables mix'),
  ('Grid Electricity','National Grid','France',                   'France',    0.052, 'kWh', 'Scope 2', 'RTE 2023',                'Nuclear dominant; lowest in EU'),
  ('Grid Electricity','National Grid','India',                    'India',     0.708, 'kWh', 'Scope 2', 'CEA 2023',                'Coal-heavy; improving with solar'),
  ('Grid Electricity','National Grid','China',                    'China',     0.558, 'kWh', 'Scope 2', 'IPCC/IEA 2023',           NULL),
  ('Grid Electricity','National Grid','USA (avg)',                'USA',       0.386, 'kWh', 'Scope 2', 'EPA eGRID 2022',          'Market-weighted national avg'),
  ('Grid Electricity','National Grid','Vietnam',                  'Vietnam',   0.612, 'kWh', 'Scope 2', 'EVN 2022',                'Coal + hydro mix'),
  ('Grid Electricity','National Grid','Turkey',                   'Turkey',    0.432, 'kWh', 'Scope 2', 'EPDK 2022',               NULL),
  ('Grid Electricity','National Grid','Mexico',                   'Mexico',    0.458, 'kWh', 'Scope 2', 'SENER 2022',              NULL),
  ('Grid Electricity','National Grid','Global Average',           'Global',    0.450, 'kWh', 'Scope 2', 'IEA 2023 WEO',            'Use when country unknown'),

  -- ── Process Energy Intensity (Scope 1+2 combined) ─────────────────────────
  -- kgCO2e per kg of material processed (at global avg grid)
  ('Process Energy','Manufacturing','Injection Moulding',          NULL,  1.20, 'kg part produced', 'Scope 1+2','Thiriez & Gutowski 2006','0.8-2.5 range; energy/part × grid factor'),
  ('Process Energy','Manufacturing','CNC Milling — Aluminium',     NULL,  4.50, 'kg stock removed', 'Scope 1+2','Gutowski et al.',        '5-15 kWh/kg × 0.45 CO2/kWh'),
  ('Process Energy','Manufacturing','CNC Milling — Steel',         NULL, 10.00, 'kg stock removed', 'Scope 1+2','Gutowski et al.',        '15-30 kWh/kg'),
  ('Process Energy','Manufacturing','CNC Milling — Titanium',      NULL, 18.00, 'kg stock removed', 'Scope 1+2','Estimated',              '30-50 kWh/kg; low MRR = high energy/kg'),
  ('Process Energy','Manufacturing','Laser Cutting (fibre)',        NULL,  2.50, 'kg sheet cut',     'Scope 1+2','Literature',             'Includes assist gas compression'),
  ('Process Energy','Manufacturing','MIG Welding',                  NULL,  2.00, 'kg weld deposit',  'Scope 1+2','AWS/literature',         'Wire + shielding gas + machine power'),
  ('Process Energy','Manufacturing','Die Casting — Aluminium',      NULL,  1.00, 'kg casting',       'Scope 1+2','NADCA 2021',             '0.5-1.5 kWh/kg × grid factor'),
  ('Process Energy','Manufacturing','Powder Coating',               NULL,  0.90, 'kg part coated',   'Scope 1+2','Industry data',          'Oven cure dominant; 1.5-3 kWh/kg part'),
  ('Process Energy','Manufacturing','Heat Treatment (anneal/harden)','NULL',0.55,'kg treated',       'Scope 1+2','Industry',               '0.5-1.5 kWh/kg depending on cycle'),
  ('Process Energy','Manufacturing','Anodising (Type II)',          NULL,  0.90, 'm2 surface',       'Scope 1+2','Industry',               '1-2.5 kWh/m²; electrolyte + rectifier'),
  ('Process Energy','Manufacturing','Electroplating (zinc)',        NULL,  0.45, 'm2 surface',       'Scope 1+2','Industry',               '0.8-1.2 kWh/m²'),
  ('Process Energy','Manufacturing','Grinding (cylindrical)',       NULL, 13.50, 'kg stock removed', 'Scope 1+2','Literature',             '25-35 kWh/kg removed; very energy intensive'),
  ('Process Energy','Manufacturing','Forging (hot)',                NULL,  1.20, 'kg forging',       'Scope 1+2','Industry',               '1.0-2.5 kWh/kg including furnace'),
  ('Process Energy','Manufacturing','Thermoforming',                NULL,  0.80, 'kg sheet formed',  'Scope 1+2','PlasticEurope',          '1.0-2.0 kWh/kg; mostly oven heating'),

  -- ── Transport (per tonne-km, Scope 3) ────────────────────────────────────
  ('Transport','Air','Air Freight — long haul (>2000km)',           NULL,  0.5560, 'tonne-km', 'Scope 3', 'DEFRA 2023',        'Freighter aircraft; ICAO method'),
  ('Transport','Air','Air Freight — belly cargo (passenger)',       NULL,  0.4320, 'tonne-km', 'Scope 3', 'DEFRA 2023',        'Lower allocation vs dedicated freighter'),
  ('Transport','Air','Air Freight — short haul (<2000km)',          NULL,  1.1300, 'tonne-km', 'Scope 3', 'DEFRA 2023',        'Take-off/landing phase dominates'),
  ('Transport','Sea','Sea Freight — container ship',                NULL,  0.0128, 'tonne-km', 'Scope 3', 'DEFRA / IMO 2023',  'Modern Panamax/ULCV fleet average'),
  ('Transport','Sea','Sea Freight — bulk carrier',                  NULL,  0.0094, 'tonne-km', 'Scope 3', 'DEFRA 2023',        'Capesize ore carrier equivalent'),
  ('Transport','Sea','Sea Freight — RoRo ferry',                    NULL,  0.0507, 'tonne-km', 'Scope 3', 'DEFRA 2023',        'Short-sea; higher fuel per tonne'),
  ('Transport','Road','HGV >32T (diesel)',                          NULL,  0.0886, 'tonne-km', 'Scope 3', 'DEFRA 2023',        'European TIR / UK artic'),
  ('Transport','Road','HGV 7.5-17T (diesel)',                       NULL,  0.2030, 'tonne-km', 'Scope 3', 'DEFRA 2023',        'Rigid truck; urban distribution'),
  ('Transport','Road','Van <3.5T (diesel)',                         NULL,  0.5060, 'tonne-km', 'Scope 3', 'DEFRA 2023',        'Last-mile; sample delivery'),
  ('Transport','Rail','Freight rail — EU average (electric mix)',   NULL,  0.0280, 'tonne-km', 'Scope 3', 'EEA 2023',          'European electrified network'),
  ('Transport','Rail','Freight rail — diesel locomotive',           NULL,  0.0410, 'tonne-km', 'Scope 3', 'DEFRA 2023',        'Non-electrified line'),

  -- ── Waste / End-of-Life ───────────────────────────────────────────────────
  ('Waste','Metal Scrap','Metal swarf — landfill',                  NULL,  0.0100, 'kg waste',  'Scope 3', 'Estimated',         'Mostly collection/transport'),
  ('Waste','Metal Scrap','Metal swarf — recycled (credit)',         NULL, -1.5000, 'kg waste',  'Scope 3', 'World Steel 2023',  'Negative = avoided emissions from recycling'),
  ('Waste','Plastic Scrap','Plastic — landfill',                    NULL,  0.0500, 'kg waste',  'Scope 3', 'Literature',        NULL),
  ('Waste','Plastic Scrap','Plastic — incinerated (with recovery)', NULL,  2.5000, 'kg waste',  'Scope 3', 'DEFRA 2023',        'CO2 from combustion of polymer'),
  ('Waste','Plastic Scrap','Plastic — recycled (credit)',           NULL, -0.8000, 'kg waste',  'Scope 3', 'Literature',        NULL),
  ('Waste','Chemical Waste','Plating / anodising effluent',         NULL,  0.2000, 'kg waste',  'Scope 3', 'Estimated',         'Treatment + disposal; site-specific')

ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r_price    INTEGER;
  r_cycle    INTEGER;
  r_labor    INTEGER;
  r_bench    INTEGER;
  r_sustain  INTEGER;
BEGIN
  SELECT COUNT(*) INTO r_price   FROM material_price_library;
  SELECT COUNT(*) INTO r_cycle   FROM process_cycle_time_library;
  SELECT COUNT(*) INTO r_labor   FROM labor_content_library;
  SELECT COUNT(*) INTO r_bench   FROM supplier_capability_benchmarks;
  SELECT COUNT(*) INTO r_sustain FROM sustainability_factors;

  RAISE NOTICE '=== Migration 163 — Should-Cost Engine Tables ===';
  RAISE NOTICE 'material_price_library:         % rows', r_price;
  RAISE NOTICE 'process_cycle_time_library:     % rows', r_cycle;
  RAISE NOTICE 'labor_content_library:          % rows', r_labor;
  RAISE NOTICE 'supplier_capability_benchmarks: % rows', r_bench;
  RAISE NOTICE 'sustainability_factors:         % rows', r_sustain;
  RAISE NOTICE '=================================================';
END $$;
