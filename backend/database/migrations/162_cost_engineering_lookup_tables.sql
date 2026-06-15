-- Migration 162: Cost-Engineering Lookup Tables
--
-- Creates and seeds the following global reference tables needed for
-- accurate should-cost / RFQ calculations:
--
--   1. process_scrap_rates          — scrap % by process + material
--   2. country_cost_factors         — labour/overhead index by country
--   3. machine_utilization_factors  — OEE, downtime, changeover by machine class
--   4. tool_life_reference          — tool life + cost per part by process/material
--   5. overhead_profiles            — factory OH, SG&A, margin by segment
--   6. material_density_library     — g/cm³ for automatic weight calc
--   7. machine_master               — machine type → hourly rate + capacity
--   8. surface_finish_cost_factors  — cost multiplier for coating/plating
--   9. inspection_level_cost_factors— cost multiplier for quality level
--  10. freight_rates                — $/kg by mode + trade lane
--
-- All tables are global (no user_id). RLS: SELECT USING (true).
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLE CREATION
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. process_scrap_rates
CREATE TABLE IF NOT EXISTS process_scrap_rates (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  process_group     TEXT        NOT NULL,
  process_name      TEXT        NOT NULL,
  material_category TEXT,
  scrap_rate_pct    NUMERIC(5,2) NOT NULL,
  scrap_rate_min    NUMERIC(5,2),
  scrap_rate_max    NUMERIC(5,2),
  scrap_driver      TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scrap_rates_process ON process_scrap_rates (process_group, process_name);

-- 2. country_cost_factors
CREATE TABLE IF NOT EXISTS country_cost_factors (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  country_name              TEXT        NOT NULL,
  country_code              CHAR(2)     NOT NULL,
  region                    TEXT        NOT NULL,
  labor_index               NUMERIC(6,3) NOT NULL,  -- China = 1.00 baseline
  overhead_index            NUMERIC(6,3) NOT NULL,
  electricity_usd_kwh       NUMERIC(6,4),
  avg_operator_rate_usd_hr  NUMERIC(8,2),
  avg_engineer_rate_usd_hr  NUMERIC(8,2),
  currency_code             CHAR(3),
  notes                     TEXT,
  created_at                TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_country_cost_code ON country_cost_factors (country_code);

-- 3. machine_utilization_factors
CREATE TABLE IF NOT EXISTS machine_utilization_factors (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_category       TEXT        NOT NULL,
  process_group          TEXT        NOT NULL,
  typical_oee_pct        NUMERIC(5,2) NOT NULL,
  planned_uptime_pct     NUMERIC(5,2) NOT NULL,
  avg_changeover_min     NUMERIC(7,1),
  preventive_maint_pct   NUMERIC(5,2),
  scrap_rework_loss_pct  NUMERIC(5,2),
  notes                  TEXT,
  created_at             TIMESTAMPTZ DEFAULT now()
);

-- 4. tool_life_reference
CREATE TABLE IF NOT EXISTS tool_life_reference (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  process_group        TEXT        NOT NULL,
  tool_type            TEXT        NOT NULL,
  work_material        TEXT        NOT NULL,
  tool_life_minutes    NUMERIC(8,1),
  tool_life_parts      INTEGER,
  tool_cost_usd        NUMERIC(8,2),
  regrind_possible     BOOLEAN     DEFAULT FALSE,
  regrind_cost_usd     NUMERIC(8,2),
  cost_per_part_usd    NUMERIC(8,4),
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- 5. overhead_profiles
CREATE TABLE IF NOT EXISTS overhead_profiles (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_name         TEXT        NOT NULL,
  industry_segment     TEXT        NOT NULL,
  region               TEXT,
  factory_oh_pct       NUMERIC(6,2) NOT NULL,
  sg_and_a_pct         NUMERIC(6,2) NOT NULL,
  rd_pct               NUMERIC(6,2) DEFAULT 0,
  profit_margin_pct    NUMERIC(6,2) NOT NULL,
  total_cost_uplift_pct NUMERIC(6,2) NOT NULL,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- 6. material_density_library
CREATE TABLE IF NOT EXISTS material_density_library (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  material_category     TEXT        NOT NULL,
  material_name         TEXT        NOT NULL,
  grade                 TEXT,
  density_g_cm3         NUMERIC(7,4) NOT NULL,
  density_kg_m3         NUMERIC(9,2) GENERATED ALWAYS AS (density_g_cm3 * 1000) STORED,
  tensile_strength_mpa  NUMERIC(8,1),
  typical_applications  TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_density_category ON material_density_library (material_category);

-- 7. machine_master
CREATE TABLE IF NOT EXISTS machine_master (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_type               TEXT        NOT NULL,
  process_group              TEXT        NOT NULL,
  capacity_spec              TEXT,
  power_kw                   NUMERIC(8,2),
  hourly_rate_usd_low        NUMERIC(8,2),
  hourly_rate_usd_mid        NUMERIC(8,2),
  hourly_rate_usd_high       NUMERIC(8,2),
  typical_depreciation_yrs   INTEGER,
  notes                      TEXT,
  created_at                 TIMESTAMPTZ DEFAULT now()
);

-- 8. surface_finish_cost_factors
CREATE TABLE IF NOT EXISTS surface_finish_cost_factors (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  process_name        TEXT        NOT NULL,
  finish_category     TEXT        NOT NULL,
  material_category   TEXT,
  cost_factor         NUMERIC(6,3) NOT NULL,  -- multiplier on bare part cost
  setup_cost_usd      NUMERIC(8,2),
  per_m2_cost_usd     NUMERIC(8,4),
  min_batch_size      INTEGER,
  lead_time_days_add  INTEGER,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- 9. inspection_level_cost_factors
CREATE TABLE IF NOT EXISTS inspection_level_cost_factors (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_level          TEXT        NOT NULL,
  industry_standard         TEXT,
  applicable_industries     TEXT,
  cost_factor               NUMERIC(6,3) NOT NULL,
  lead_time_days_add        INTEGER,
  documentation_required    TEXT,
  notes                     TEXT,
  created_at                TIMESTAMPTZ DEFAULT now()
);

-- 10. freight_rates
CREATE TABLE IF NOT EXISTS freight_rates (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_region        TEXT        NOT NULL,
  destination_region   TEXT        NOT NULL,
  mode                 TEXT        NOT NULL,  -- Air / Sea FCL / Sea LCL / Road / Rail
  weight_break_kg      NUMERIC(10,2),
  rate_usd_per_kg      NUMERIC(8,4),
  min_charge_usd       NUMERIC(8,2),
  transit_days_min     INTEGER,
  transit_days_max     INTEGER,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — all tables are global reference data (no user_id)
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'process_scrap_rates','country_cost_factors','machine_utilization_factors',
    'tool_life_reference','overhead_profiles','material_density_library',
    'machine_master','surface_finish_cost_factors','inspection_level_cost_factors',
    'freight_rates'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    -- Drop any stale policies first
    DECLARE rec RECORD;
    BEGIN
      FOR rec IN
        SELECT policyname FROM pg_policies WHERE tablename = tbl
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', rec.policyname, tbl);
      END LOOP;
    END;
    EXECUTE format(
      'CREATE POLICY "global_select" ON %I FOR SELECT USING (true)', tbl
    );
  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- SEED DATA
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. PROCESS SCRAP RATES ───────────────────────────────────────────────────
-- Formula: Raw Material Required = Net Weight / (1 - scrap_rate_pct/100)

INSERT INTO process_scrap_rates
  (process_group, process_name, material_category, scrap_rate_pct, scrap_rate_min, scrap_rate_max, scrap_driver, notes)
VALUES
  -- Plastic & Rubber
  ('Plastic','Injection Moulding','All Plastics',           3.0,  1.5,  5.0, 'Runners/gates, colour purge, startup rejects', 'Virgin material; regrind not counted'),
  ('Plastic','Injection Moulding','Engineering Plastics',   5.0,  3.0,  8.0, 'Higher reject rate for tight-tolerance parts', 'PEEK/POM/GF Nylon'),
  ('Plastic','Injection Moulding - Multi-cavity','All Plastics', 2.0, 1.0, 3.5, 'Hot runner eliminates most runner scrap', NULL),
  ('Rubber','Rubber Moulding','All Rubber',                 8.0,  5.0, 12.0, 'Flash, mismatch, density variation', NULL),
  ('Plastic','Blow Moulding','HDPE/PP',                     5.0,  3.0,  8.0, 'Pinch-off flash, parison waste', NULL),
  ('Plastic','Thermoforming','Sheet Plastics',             22.0, 15.0, 30.0, 'Trim skeleton, edge offcuts', 'Nesting efficiency strongly affects this'),
  ('Plastic','Extrusion','All Plastics',                    2.0,  1.0,  4.0, 'Startup purge, end-of-run trim', NULL),

  -- Machining
  ('Machining','CNC Milling','Aluminium',                   4.0,  2.0,  6.0, 'Chips from billet', 'Buy-to-fly ratio ~3:1 for complex parts'),
  ('Machining','CNC Milling','Steel',                       5.0,  3.0,  8.0, 'Chips, setup scrap', NULL),
  ('Machining','CNC Milling','Titanium',                   10.0,  6.0, 15.0, 'High buy-to-fly; chips unrecoverable', NULL),
  ('Machining','CNC Milling','Stainless Steel',             6.0,  4.0, 10.0, 'Work-hardening increases rejects', NULL),
  ('Machining','CNC Turning','Aluminium',                   3.0,  1.5,  5.0, 'Bar end offcuts, chuck grips', NULL),
  ('Machining','CNC Turning','Steel',                       4.0,  2.0,  6.0, 'Bar end offcuts, setup rejects', NULL),
  ('Machining','Drilling','All Metals',                     1.5,  0.5,  3.0, 'Breakthrough burr, entry chips', NULL),
  ('Machining','Grinding / Honing','All Metals',            2.0,  1.0,  4.0, 'Wheel dressing, size rejects', NULL),

  -- Sheet Metal
  ('Sheet Metal','Laser Cutting','Mild Steel',             10.0,  5.0, 18.0, 'Nesting skeleton, kerf, edge rejects', 'Nesting software can cut to 8%'),
  ('Sheet Metal','Laser Cutting','Stainless Steel',        12.0,  8.0, 20.0, 'Dross on edges, nesting loss', NULL),
  ('Sheet Metal','Laser Cutting','Aluminium',              12.0,  8.0, 20.0, 'Reflectivity causes edge rejects', NULL),
  ('Sheet Metal','Sheet Metal Bending','Mild Steel',        3.0,  1.0,  5.0, 'Springback rejects, setup blanks', NULL),
  ('Sheet Metal','Plasma Cutting','Mild Steel',            15.0, 10.0, 22.0, 'Wide kerf + heat-affected rejects', NULL),
  ('Sheet Metal','Deep Drawing','Mild Steel',               8.0,  5.0, 12.0, 'Ear trimming, cracks, wrinkling', NULL),
  ('Sheet Metal','Stamping / Fine Blanking','Mild Steel',  10.0,  6.0, 15.0, 'Blanking skeleton waste dominant', NULL),

  -- Welding
  ('Welding','MIG Welding','Mild Steel',                    3.0,  1.5,  5.0, 'Wire waste, spatter, distortion rejects', NULL),
  ('Welding','TIG Welding','Stainless Steel',               4.0,  2.0,  7.0, 'Filler rod waste, colour rejects', NULL),
  ('Welding','Spot Welding','Mild Steel',                   2.0,  1.0,  3.5, 'Electrode wear rejects', NULL),
  ('Welding','Laser Welding','All Metals',                  2.0,  0.5,  3.0, 'Low distortion; mainly startup rejects', NULL),

  -- Casting
  ('Casting','Die Casting','Aluminium',                     7.0,  4.0, 12.0, 'Gate/runner, porosity, flash, rejects', 'Runner recyclable in house'),
  ('Casting','Die Casting','Zinc',                          5.0,  3.0,  8.0, 'Lower porosity vs Al; runner recycled', NULL),
  ('Casting','Investment Casting','Steel',                  8.0,  5.0, 12.0, 'Wax, shell, gating, rejects', 'Shell scrap unrecoverable'),
  ('Casting','Investment Casting','Inconel / Superalloy',  12.0,  8.0, 18.0, 'High reject rate; x-ray / FPI needed', NULL),
  ('Casting','Sand Casting','Cast Iron',                   12.0,  8.0, 18.0, 'Cores, misruns, porosity, shrinkage', NULL),
  ('Casting','Sand Casting','Aluminium',                   10.0,  6.0, 15.0, NULL, NULL),

  -- Forging
  ('Forging','Hot Forging','Steel',                        12.0,  8.0, 18.0, 'Flash, scale, end crop', NULL),
  ('Forging','Cold Forging','Steel',                        4.0,  2.0,  7.0, 'Flash minimal; trim scrap', NULL),
  ('Forging','Hot Forging','Aluminium',                     8.0,  5.0, 12.0, 'Flash, oxidation loss', NULL),

  -- Surface Treatment
  ('Surface','Powder Coating','All Metals',                 8.0,  5.0, 12.0, 'Overspray, masking rejects, rework', 'Overspray partially recoverable'),
  ('Surface','Anodising','Aluminium',                       3.0,  1.5,  5.0, 'Rack marks, colour variation rejects', NULL),
  ('Surface','Electroplating','All Metals',                 5.0,  3.0,  8.0, 'Adhesion, blistering, thickness rejects', NULL),
  ('Surface','Painting (Wet)','All Metals',                10.0,  6.0, 15.0, 'Runs, sags, adhesion, colour match', NULL),
  ('Surface','Heat Treatment','Steel',                      2.0,  0.5,  4.0, 'Distortion, decarb, crack rejects', NULL),

  -- Assembly
  ('Assembly','Manual Assembly','General',                   2.0,  0.5,  4.0, 'Damaged parts during assembly, rework', NULL),
  ('Assembly','Automated Assembly','General',                1.0,  0.3,  2.0, 'Feeder jams, incorrect orientation', NULL),

  -- Quality
  ('Quality','Quality Inspection (AQL 2.5)','General',      2.0,  1.0,  4.0, 'Lots rejected at incoming / final', NULL),
  ('Quality','Quality Inspection (100%)','General',          0.5,  0.0,  1.5, 'Individual part rejects only', NULL)

ON CONFLICT DO NOTHING;


-- ── 2. COUNTRY COST FACTORS ──────────────────────────────────────────────────
-- labor_index: China = 1.00 baseline (2024 data, USD)
-- Covers major manufacturing hubs relevant to global sourcing

INSERT INTO country_cost_factors
  (country_name, country_code, region,
   labor_index, overhead_index,
   electricity_usd_kwh, avg_operator_rate_usd_hr, avg_engineer_rate_usd_hr,
   currency_code, notes)
VALUES
  -- Asia Pacific
  ('China',       'CN','Asia Pacific',  1.00, 1.00, 0.085,  4.50,  18.00, 'CNY', 'Baseline; coastal cities 20-30% higher'),
  ('India',       'IN','Asia Pacific',  0.55, 0.70, 0.095,  2.50,   9.00, 'INR', 'Significant regional variation; Pune/Chennai industrial hubs'),
  ('Vietnam',     'VN','Asia Pacific',  0.50, 0.65, 0.080,  2.20,   7.00, 'VND', 'Fastest growing low-cost mfg hub; Ho Chi Minh / Hanoi'),
  ('Bangladesh',  'BD','Asia Pacific',  0.30, 0.55, 0.075,  1.40,   5.00, 'BDT', 'Very low labour; limited advanced mfg capability'),
  ('Indonesia',   'ID','Asia Pacific',  0.55, 0.70, 0.090,  2.50,   8.00, 'IDR', 'Large domestic market; Java industrial zone'),
  ('Thailand',    'TH','Asia Pacific',  0.75, 0.80, 0.100,  3.50,  11.00, 'THB', 'Strong auto supply chain; Eastern Seaboard zone'),
  ('Malaysia',    'MY','Asia Pacific',  0.85, 0.85, 0.070,  4.00,  13.00, 'MYR', 'Higher skill; electronics/semiconductor cluster'),
  ('Philippines', 'PH','Asia Pacific',  0.60, 0.72, 0.140,  2.80,   9.00, 'PHP', 'English-speaking; higher electricity costs'),
  ('Taiwan',      'TW','Asia Pacific',  2.00, 1.60, 0.095,  9.00,  28.00, 'TWD', 'High-precision; semiconductor/electronics leader'),
  ('South Korea', 'KR','Asia Pacific',  2.80, 2.00, 0.100, 13.00,  40.00, 'KRW', 'Strong auto/shipbuilding; fast R&D'),
  ('Japan',       'JP','Asia Pacific',  3.50, 2.50, 0.150, 18.00,  55.00, 'JPY', 'Highest quality standards; aging workforce'),
  ('Australia',   'AU','Asia Pacific',  5.00, 3.50, 0.120, 25.00,  75.00, 'AUD', 'Very high labour; limited bulk mfg'),

  -- Europe
  ('Germany',     'DE','Europe',        4.80, 3.20, 0.280, 28.00,  90.00, 'EUR', 'World-class precision; high energy costs'),
  ('France',      'FR','Europe',        4.00, 2.80, 0.220, 24.00,  80.00, 'EUR', 'Aerospace/auto strength; 35h work week'),
  ('United Kingdom','GB','Europe',      3.80, 2.60, 0.280, 22.00,  75.00, 'GBP', 'Post-Brexit logistics costs added'),
  ('Italy',       'IT','Europe',        3.20, 2.40, 0.250, 19.00,  65.00, 'EUR', 'Strong SME mfg base; design/tooling excellence'),
  ('Spain',       'ES','Europe',        2.50, 2.00, 0.200, 15.00,  50.00, 'EUR', 'Growing auto supply chain'),
  ('Poland',      'PL','Europe',        1.60, 1.50, 0.150,  8.00,  28.00, 'PLN', 'Competitive skilled labour; EU quality standards'),
  ('Czech Republic','CZ','Europe',      1.80, 1.60, 0.160,  9.00,  30.00, 'CZK', 'Strong auto/engineering; Skoda/Bosch cluster'),
  ('Romania',     'RO','Europe',        1.20, 1.30, 0.120,  6.00,  20.00, 'RON', 'Low cost EU base; growing mfg sector'),
  ('Turkey',      'TR','Europe/Asia',   1.10, 1.20, 0.090,  5.00,  18.00, 'TRY', 'Volatile currency; strong metals/auto sector'),
  ('Portugal',    'PT','Europe',        2.00, 1.70, 0.180, 10.00,  32.00, 'EUR', 'Lower cost EU; growing aerospace cluster'),

  -- Americas
  ('United States','US','Americas',     5.50, 3.80, 0.090, 30.00, 100.00, 'USD', 'High labour; reshoring trend driven by IRA/CHIPS'),
  ('Canada',      'CA','Americas',      5.00, 3.40, 0.075, 27.00,  90.00, 'CAD', 'Similar to US; strong auto corridor'),
  ('Mexico',      'MX','Americas',      0.90, 1.00, 0.085,  4.20,  15.00, 'MXN', 'USMCA advantage; Tier-1 auto supplier base'),
  ('Brazil',      'BR','Americas',      1.50, 1.60, 0.095,  7.00,  22.00, 'BRL', 'Large domestic market; high import tariffs'),

  -- Middle East / Africa
  ('UAE',         'AE','Middle East',   3.00, 2.20, 0.060, 15.00,  50.00, 'AED', 'Low energy cost; trade hub; limited local mfg'),
  ('Saudi Arabia','SA','Middle East',   2.50, 1.90, 0.040, 12.00,  45.00, 'SAR', 'Diversification push; Vision 2030 mfg targets'),
  ('South Africa','ZA','Africa',        1.20, 1.30, 0.100,  5.50,  18.00, 'ZAR', 'Auto OEM presence (BMW/Toyota); power reliability risk')

ON CONFLICT (country_code) DO NOTHING;


-- ── 3. MACHINE UTILIZATION FACTORS ───────────────────────────────────────────

INSERT INTO machine_utilization_factors
  (machine_category, process_group, typical_oee_pct, planned_uptime_pct,
   avg_changeover_min, preventive_maint_pct, scrap_rework_loss_pct, notes)
VALUES
  ('Injection Moulding Machine',    'Plastic',      72.0, 85.0,  45.0, 5.0, 2.5, 'OEE leader for high-volume; falls with frequent mould changes'),
  ('CNC Machining Centre (3-axis)', 'Machining',    68.0, 82.0,  30.0, 4.0, 3.0, 'Job shop environment; setup-heavy'),
  ('CNC Machining Centre (5-axis)', 'Machining',    65.0, 80.0,  45.0, 5.0, 3.5, 'Complex setup; longer prove-out cycles'),
  ('CNC Turning / Lathe',           'Machining',    72.0, 85.0,  20.0, 3.5, 2.5, 'Bar-fed lathes hit 85%+ OEE'),
  ('Laser Cutting Machine',         'Sheet Metal',  75.0, 87.0,  15.0, 4.0, 2.0, 'High-speed; nesting software critical for utilisation'),
  ('Press Brake',                   'Sheet Metal',  65.0, 80.0,  20.0, 3.0, 2.5, 'Operator-dependent; tooling change time variable'),
  ('Stamping Press',                'Sheet Metal',  80.0, 90.0,  60.0, 3.0, 3.0, 'High OEE for dedicated tools; dies last 500k+ hits'),
  ('Deep Drawing Press',            'Sheet Metal',  70.0, 83.0,  40.0, 4.0, 4.0, 'Draw ratio and lubrication critical'),
  ('MIG Welding Cell (Manual)',     'Welding',      55.0, 75.0,  10.0, 3.0, 4.0, 'Labour-limited; arc-on time typically 35-40%'),
  ('Robotic Welding Cell',          'Welding',      78.0, 88.0,  20.0, 4.0, 2.5, 'Programme change = changeover time'),
  ('Die Casting Machine',           'Casting',      70.0, 82.0,  30.0, 6.0, 5.0, 'Die warm-up + purge shots = planned downtime'),
  ('Investment Casting Furnace',    'Casting',      65.0, 80.0, 120.0, 8.0, 6.0, 'Batch process; kiln time dominates'),
  ('Sand Casting Line',             'Casting',      60.0, 76.0,  90.0, 8.0, 8.0, 'Mould prep + pour + shake-out cycle'),
  ('Powder Coating Line',           'Surface',      72.0, 85.0,  30.0, 4.0, 5.0, 'Colour change = 30-60 min purge'),
  ('Anodising Tank',                'Surface',      68.0, 83.0,  60.0, 3.0, 3.0, 'Bath chemistry maintenance = downtime'),
  ('Heat Treatment Furnace',        'Surface',      75.0, 88.0,  60.0, 5.0, 2.0, 'Batch loads planned; energy-intensive'),
  ('Grinding Machine',              'Machining',    70.0, 83.0,  25.0, 5.0, 3.0, 'Wheel dressing + sizing = key losses'),
  ('Forging Press',                 'Forging',      68.0, 82.0,  45.0, 6.0, 5.0, 'Die heating + billet heating = planned downtime'),
  ('Manual Assembly Cell',          'Assembly',     60.0, 78.0,   5.0, 2.0, 2.5, 'Ergonomics and fatigue limit productivity'),
  ('Automated Assembly Line',       'Assembly',     80.0, 90.0,  15.0, 3.0, 1.5, 'Feeder reliability is primary loss driver'),
  ('CMM / Inspection Cell',         'Quality',      65.0, 80.0,  10.0, 2.0, 0.5, 'Programme change is main changeover; high utilisation in high-volume'),
  ('Thermoforming Machine',         'Plastic',      68.0, 82.0,  30.0, 4.0, 4.0, 'Sheet loading + trim die change = losses')

ON CONFLICT DO NOTHING;


-- ── 4. TOOL LIFE REFERENCE ───────────────────────────────────────────────────

INSERT INTO tool_life_reference
  (process_group, tool_type, work_material,
   tool_life_minutes, tool_life_parts, tool_cost_usd,
   regrind_possible, regrind_cost_usd, cost_per_part_usd, notes)
VALUES
  -- CNC Milling inserts
  ('Machining','Carbide Insert (Face Mill)','Mild Steel',          120, NULL,  1.80, FALSE, NULL,   0.015, '1 insert per 2 hrs cutting; 4 edges per insert'),
  ('Machining','Carbide Insert (Face Mill)','Stainless Steel 304', 60,  NULL,  1.80, FALSE, NULL,   0.030, 'Half life vs mild steel'),
  ('Machining','Carbide Insert (Face Mill)','Aluminium',           480, NULL,  1.80, FALSE, NULL,   0.004, 'Very long life in Al'),
  ('Machining','Solid Carbide End Mill 10mm','Mild Steel',         90,  NULL, 22.00, TRUE,   6.00,  0.244, '3 regrinds possible before scrap'),
  ('Machining','Solid Carbide End Mill 10mm','Stainless Steel 304',45,  NULL, 22.00, TRUE,   6.00,  0.489, 'Premature edge failure risk'),
  ('Machining','Solid Carbide End Mill 10mm','Aluminium',          360, NULL, 22.00, TRUE,   6.00,  0.061, NULL),
  ('Machining','Solid Carbide End Mill 10mm','Titanium Ti-6Al-4V', 30,  NULL, 22.00, FALSE, NULL,   0.733, 'Chemical affinity causes rapid wear'),
  -- CNC Turning inserts
  ('Machining','Turning Insert (CNMG)','Mild Steel',               90,  NULL,  2.20, FALSE, NULL,   0.024, '4 cutting edges per insert'),
  ('Machining','Turning Insert (CNMG)','Stainless Steel 304',      45,  NULL,  2.20, FALSE, NULL,   0.049, NULL),
  ('Machining','Turning Insert (CNMG)','Aluminium',                360, NULL,  2.20, FALSE, NULL,   0.006, NULL),
  ('Machining','Turning Insert (CNMG)','Hardened Steel >45 HRC',  20,  NULL,  4.50, FALSE, NULL,   0.225, 'CBN preferred above 50 HRC'),
  -- Drilling
  ('Machining','HSS Twist Drill 8mm','Mild Steel',                 90,  NULL,  1.20, TRUE,   0.40,  0.013, '5+ regrinds typical'),
  ('Machining','Carbide Drill 8mm','Stainless Steel 304',          60,  NULL,  8.00, TRUE,   2.00,  0.133, '3 regrinds then scrap'),
  ('Machining','Carbide Drill 8mm','Aluminium',                   360,  NULL,  8.00, TRUE,   2.00,  0.022, NULL),
  -- Grinding wheels
  ('Machining','Vitrified Alumina Wheel','Mild Steel',            480,  NULL, 45.00, FALSE, NULL,   0.094, 'Dress every 15 min; full wheel life ~8 hrs'),
  ('Machining','CBN Grinding Wheel','Hardened Steel',            2400,  NULL,350.00, FALSE, NULL,   0.146, 'Long life justifies high cost for volume'),
  -- Sheet Metal
  ('Sheet Metal','Laser Cutting Nozzle','Mild Steel',             480,  NULL,  8.00, FALSE, NULL,   0.017, 'Replace when focus drifts > 0.1mm'),
  ('Sheet Metal','Laser Cutting Lens','Mild Steel',              2400,  NULL, 60.00, FALSE, NULL,   0.025, 'Inspect every 100 hrs; replace if clouded'),
  ('Sheet Metal','Press Brake Punch/Die Set','Mild Steel',       NULL, 200000, 350.00, TRUE, 80.00, 0.002, 'Regrind 5x; total life ~1M hits'),
  ('Sheet Metal','Stamping Die','Mild Steel',                    NULL, 500000,5000.00, TRUE,500.00, 0.010, 'Progressive die; PM every 50k hits'),
  -- Welding
  ('Welding','MIG Contact Tip M6','Mild Steel',                   120, NULL,  0.50, FALSE, NULL,   0.004, 'Replace every 2-4 hrs arc-on time'),
  ('Welding','MIG Liner 3m','Mild Steel',                        2400, NULL, 12.00, FALSE, NULL,   0.005, 'Replace monthly in production'),
  ('Welding','TIG Tungsten Electrode','Stainless Steel 304',      480, NULL,  3.50, TRUE,   0.50,  0.007, 'Regrind after every 8 hrs'),
  -- Casting tooling
  ('Casting','Injection Moulding Tool (P20 steel)','ABS/PP/Nylon',NULL, 500000, 12000.00, FALSE, NULL, 0.024, 'Budget tool; H13 extends to 1M+ shots'),
  ('Casting','Injection Moulding Tool (H13 steel)','All Plastics', NULL,1000000,25000.00, FALSE, NULL, 0.025, 'High-volume production tool'),
  ('Casting','Die Casting Die (H13)','Aluminium',                NULL, 100000,18000.00, FALSE, NULL, 0.180, 'Thermal fatigue = limiting factor'),
  ('Casting','Investment Casting Die (Wax)','Steel / SS',         NULL, 50000, 3000.00, FALSE, NULL, 0.060, 'Wax dies; lower pressure vs Al die casting'),
  -- Forging
  ('Forging','Forging Die (H13)','Mild Steel',                   NULL, 30000, 8000.00, TRUE,1500.00, 0.267, '3-4 regrind cycles before discard'),
  ('Forging','Forging Die (H13)','Stainless Steel',              NULL, 15000, 8000.00, TRUE,1500.00, 0.533, 'Higher die stress with SS'),
  -- Surface treatment
  ('Surface','Powder Coating Gun','All Metals',                   NULL, NULL,  350.00, FALSE, NULL, NULL, 'Replace tips every 2000 hrs; gun life 5+ yrs'),
  ('Surface','Anodising Rack (Titanium)','Aluminium',             NULL, NULL,  120.00, FALSE, NULL, NULL, 'Replace rack contacts every 6 months production')

ON CONFLICT DO NOTHING;


-- ── 5. OVERHEAD PROFILES ──────────────────────────────────────────────────────

INSERT INTO overhead_profiles
  (profile_name, industry_segment, region,
   factory_oh_pct, sg_and_a_pct, rd_pct, profit_margin_pct, total_cost_uplift_pct, notes)
VALUES
  -- Tier 1 / Aerospace
  ('Aerospace Tier-1 (West)',     'Aerospace',            'Europe/USA',   55.0, 15.0, 8.0, 18.0, 96.0,  'AS9100; NRE recovery; high quality overhead'),
  ('Aerospace Tier-2 (West)',     'Aerospace',            'Europe/USA',   45.0, 12.0, 4.0, 14.0, 75.0,  NULL),
  ('Aerospace Tier-1 (India)',    'Aerospace',            'India',        40.0, 10.0, 3.0, 14.0, 67.0,  'NADCAP aspirant; lower absolute rates'),

  -- Automotive
  ('Auto OEM Supplier Tier-1',    'Automotive',           'Global',       40.0, 12.0, 3.0, 10.0, 65.0,  'IATF 16949; PPM targets; tooling amortisation included'),
  ('Auto Tier-2 (Asia)',          'Automotive',           'Asia Pacific', 30.0,  8.0, 1.0,  8.0, 47.0,  'Lower NRE; price pressure from OEM'),
  ('Auto Tier-2 (Europe)',        'Automotive',           'Europe',       35.0, 10.0, 2.0, 10.0, 57.0,  NULL),

  -- General Engineering / Job Shop
  ('Precision Job Shop (West)',   'General Engineering',  'Europe/USA',   60.0, 14.0, 2.0, 15.0, 91.0,  'Small-batch; high setup/engineering time'),
  ('Precision Job Shop (Asia)',   'General Engineering',  'Asia Pacific', 35.0, 10.0, 1.0, 12.0, 58.0,  NULL),
  ('High-Volume Contract Mfg',    'General Engineering',  'Global',       25.0,  7.0, 0.5,  8.0, 40.5,  'Lean, dedicated lines; low overhead ratio'),

  -- Electronics / EMS
  ('EMS / PCB Assembly (Asia)',   'Electronics',          'Asia Pacific', 20.0,  8.0, 1.0,  6.0, 35.0,  'High throughput; thin margins'),
  ('EMS / PCB Assembly (West)',   'Electronics',          'Europe/USA',   30.0, 12.0, 3.0, 10.0, 55.0,  NULL),

  -- Medical Devices
  ('Medical Device (ISO 13485)',  'Medical',              'Europe/USA',   65.0, 20.0, 8.0, 20.0,113.0,  'FDA 21 CFR 820; validation; full DHR cost'),
  ('Medical Device (Asia)',       'Medical',              'Asia Pacific', 45.0, 15.0, 5.0, 15.0, 80.0,  'Growing cluster; CE/FDA mark sought'),

  -- Defence
  ('Defence / MilSpec',           'Defence',              'USA/UK',       70.0, 18.0,10.0, 18.0,116.0,  'DCAA audit trail; lot traceability; NRE high'),

  -- Consumer / Mass Market
  ('Consumer Goods (Asia)',       'Consumer',             'Asia Pacific', 18.0,  6.0, 0.5,  6.0, 30.5,  'Price-driven; minimal quality overhead'),
  ('Consumer Goods (Branded)',    'Consumer',             'Global',       22.0, 15.0, 3.0, 12.0, 52.0,  'Brand premium and marketing SG&A loaded')

ON CONFLICT DO NOTHING;


-- ── 6. MATERIAL DENSITY LIBRARY ──────────────────────────────────────────────

INSERT INTO material_density_library
  (material_category, material_name, grade, density_g_cm3, tensile_strength_mpa, typical_applications, notes)
VALUES
  -- Steels
  ('Carbon Steel','Mild Steel','EN 1A / AISI 1018',        7.87,  400.0, 'General fabrication, shafts, brackets', NULL),
  ('Carbon Steel','Medium Carbon Steel','AISI 1045',        7.85,  570.0, 'Gears, axles, crankshafts', NULL),
  ('Carbon Steel','High Carbon Steel','AISI 1080',          7.84,  750.0, 'Springs, cutting edges, rails', NULL),
  ('Alloy Steel','Alloy Steel','AISI 4140',                 7.85,  850.0, 'High-strength shafts, gears, bolts', NULL),
  ('Alloy Steel','Alloy Steel','AISI 4340',                 7.85, 1080.0, 'Aerospace structural, landing gear', NULL),
  ('Tool Steel','Tool Steel','H13',                         7.76, 1200.0, 'Die casting dies, forging dies, hot work', NULL),
  ('Tool Steel','Tool Steel','D2',                          7.70, 1500.0, 'Cold work tooling, blanking dies', NULL),
  ('Tool Steel','Tool Steel','P20',                         7.80,  965.0, 'Plastic injection mould tooling', NULL),

  -- Stainless Steels
  ('Stainless Steel','Stainless Steel 304','304 / 1.4301',  7.93,  515.0, 'Food equipment, chemical plant, architecture', NULL),
  ('Stainless Steel','Stainless Steel 316','316 / 1.4401',  7.98,  515.0, 'Marine, pharmaceutical, medical', NULL),
  ('Stainless Steel','Stainless Steel 316L','316L / 1.4404',7.98,  485.0, 'Welded assemblies; low carbon prevents sensitisation', NULL),
  ('Stainless Steel','Stainless Steel 17-4PH','17-4PH / 630',7.78,1170.0, 'Aerospace fasteners, shafts, surgical', NULL),
  ('Stainless Steel','Duplex Stainless','2205 / 1.4462',    7.82,  620.0, 'Oil & gas, chemical, desalination', NULL),

  -- Aluminium Alloys
  ('Aluminium','Aluminium 6061','6061-T6',                  2.70,  310.0, 'Structural, automotive, marine, CNC machining', 'Most common engineering Al'),
  ('Aluminium','Aluminium 6082','6082-T6',                  2.71,  310.0, 'Structural sections; European equiv of 6061', NULL),
  ('Aluminium','Aluminium 7075','7075-T6',                  2.81,  572.0, 'Aerospace, high-strength, sporting goods', NULL),
  ('Aluminium','Aluminium 2024','2024-T3',                  2.78,  448.0, 'Aerospace fuselage, wings', NULL),
  ('Aluminium','Aluminium 5052','5052-H32',                 2.68,  228.0, 'Sheet metal, marine, pressurised vessels', NULL),
  ('Aluminium','Aluminium A380','A380 (Die Casting)',        2.71,  324.0, 'Die casting; automotive housings, brackets', 'Most common die cast Al alloy'),
  ('Aluminium','Aluminium A356','A356-T6 (Sand/Gravity)',   2.68,  228.0, 'Sand/gravity casting; wheels, pump bodies', NULL),

  -- Titanium
  ('Titanium','Titanium Grade 2','Ti Gr2 (CP)',             4.51,  345.0, 'Chemical, medical implants, marine', 'Commercially pure; excellent corrosion'),
  ('Titanium','Titanium Grade 5','Ti-6Al-4V',               4.43,  950.0, 'Aerospace structure, biomedical, racing', 'Workhorse titanium alloy'),
  ('Titanium','Titanium Grade 23','Ti-6Al-4V ELI',          4.43,  860.0, 'Surgical implants; ELI = Extra Low Interstitial', NULL),

  -- Nickel Superalloys
  ('Superalloy','Inconel 718','IN718',                      8.19,  1240.0,'Jet engines, gas turbines, oil & gas',  'Key aerospace alloy; difficult to machine'),
  ('Superalloy','Inconel 625','IN625',                      8.44,   827.0,'Chemical plant, seawater, aerospace', NULL),
  ('Superalloy','Hastelloy C-276','C-276',                  8.89,   785.0,'Severe chemical environments, FGD systems', NULL),
  ('Superalloy','Waspaloy','Waspaloy',                      8.20,  1275.0,'High-temperature rotating parts, disks', NULL),

  -- Copper Alloys
  ('Copper','Pure Copper','Cu-ETP / C101',                  8.96,   210.0,'Electrical conductors, heat exchangers', NULL),
  ('Copper','Brass','CuZn37 / C260',                        8.44,   380.0,'Machined fittings, valves, decorative', NULL),
  ('Copper','Bronze (Tin)','CuSn8 / C903',                  8.80,   380.0,'Bushings, bearings, marine', NULL),
  ('Copper','Beryllium Copper','CuBe2 / C172',              8.23,  1380.0,'Springs, connectors, non-sparking tools', 'Toxic in dust form — controlled handling'),

  -- Cast Iron
  ('Cast Iron','Grey Cast Iron','EN-GJL-250',               7.20,   250.0,'Engine blocks, machine bases, pipes', 'Excellent vibration damping'),
  ('Cast Iron','Ductile (SG) Iron','EN-GJS-500',            7.10,   500.0,'Crankshafts, gears, heavy-duty brackets', NULL),

  -- Engineering Plastics
  ('Engineering Plastic','ABS','ABS Natural',               1.05,    45.0,'Consumer electronics, automotive trim, prototypes', NULL),
  ('Engineering Plastic','Nylon PA6','PA6 Natural',         1.14,    75.0,'Gears, bearings, structural inserts', NULL),
  ('Engineering Plastic','Nylon PA66','PA66 Natural',       1.14,    82.0,'Higher temp than PA6; auto underbonnet', NULL),
  ('Engineering Plastic','Nylon PA66-GF30','PA66+30%GF',   1.38,   170.0,'High-stiffness structural plastic', NULL),
  ('Engineering Plastic','Polycarbonate','PC Optical',      1.20,    65.0,'Lenses, guards, housings, headlamps', NULL),
  ('Engineering Plastic','PEEK','PEEK Natural',             1.32,   100.0,'Aerospace, medical, high-temp seals', 'Expensive but exceptional performance'),
  ('Engineering Plastic','POM Acetal','POM-C / Delrin',     1.42,    65.0,'Precision gears, bushings, valves', NULL),
  ('Engineering Plastic','Polypropylene PP','PP Homopolymer',0.91,   33.0,'Packaging, automotive, medical disposables', NULL),
  ('Engineering Plastic','HDPE','HDPE',                     0.95,    26.0,'Tanks, pipes, cutting boards', NULL),
  ('Engineering Plastic','PTFE','PTFE Virgin',              2.18,    14.0,'Seals, gaskets, non-stick, chemical liners', NULL),
  ('Engineering Plastic','Polysulfone PSU','PSU',           1.24,    70.0,'Medical, food processing, membranes', NULL),

  -- Rubber / Elastomers
  ('Elastomer','Natural Rubber NR','NR 70 Shore A',         0.92,    25.0,'Vibration isolation, seals, tyres', NULL),
  ('Elastomer','Silicone Rubber','VMQ 60 Shore A',          1.20,     8.0,'High-temp seals, medical, food contact', NULL),
  ('Elastomer','EPDM','EPDM 70 Shore A',                   0.86,    10.0,'Weather seals, automotive, roofing', NULL),
  ('Elastomer','NBR Nitrile','NBR 70 Shore A',              1.00,    15.0,'Oil-resistant seals, O-rings', NULL),
  ('Elastomer','Neoprene CR','CR 60 Shore A',               1.23,    15.0,'Marine seals, chemical resistance', NULL),

  -- Composites
  ('Composite','CFRP (Woven)','UD Carbon Fibre/Epoxy',      1.55,  1500.0,'Aerospace primary structure, motorsport', NULL),
  ('Composite','GFRP (Woven)','E-glass/Epoxy',              1.85,   400.0,'Marine, wind, automotive body panels', NULL)

ON CONFLICT DO NOTHING;


-- ── 7. MACHINE MASTER ─────────────────────────────────────────────────────────
-- Hourly rates in USD (mid = typical; low/high = range)

INSERT INTO machine_master
  (machine_type, process_group, capacity_spec,
   power_kw, hourly_rate_usd_low, hourly_rate_usd_mid, hourly_rate_usd_high,
   typical_depreciation_yrs, notes)
VALUES
  -- Injection Moulding
  ('IMM 50T (Micro)',         'Plastic',    '50T clamp, 50cc shot',                6,   15,  25,  40,  12, 'Micro-moulding; high precision small parts'),
  ('IMM 150T (Small)',        'Plastic',    '150T clamp, 300cc shot',             15,   22,  35,  55,  12, 'Small consumer/industrial parts'),
  ('IMM 350T (Medium)',       'Plastic',    '350T clamp, 1000cc shot',            35,   35,  55,  80,  12, 'Most common general purpose range'),
  ('IMM 650T (Large)',        'Plastic',    '650T clamp, 3000cc shot',            75,   55,  85, 130,  15, 'Auto bumpers, large housings'),
  ('IMM 1500T (Very Large)',  'Plastic',    '1500T clamp, 10000cc shot',         180,  100, 160, 250,  15, 'Large structural panels'),
  ('LSR Injection Moulding',  'Rubber',     '50-200T; liquid silicone injection',  25,   50,  80, 130,  12, 'Premium: auto + medical'),
  ('Rubber Transfer Moulding','Rubber',     '100-400T',                            40,   30,  50,  80,  12, NULL),

  -- CNC Machining
  ('CNC VMC 3-axis (Small)',  'Machining',  '600x400x400mm travel',               10,   25,  40,  65,  10, 'Job shop workhorse'),
  ('CNC VMC 3-axis (Large)',  'Machining',  '1200x600x600mm travel',              18,   35,  55,  85,  10, NULL),
  ('CNC 5-axis (Medium)',     'Machining',  '500x500x400mm, trunnion',            22,   60,  95, 150,  10, 'Complex aerospace/medical components'),
  ('CNC 5-axis (Large)',      'Machining',  '1000x800x600mm, tilt-rotary',        45,   90, 140, 220,  12, NULL),
  ('CNC Turning (Bar-fed)',   'Machining',  'Ø6-65mm bar, 1500mm length',          8,   20,  35,  55,  10, 'Swiss-type for small precision parts'),
  ('CNC Turning (Chuck)',     'Machining',  'Ø300mm chuck, 1000mm between centres',15,  30,  50,  80,  10, NULL),
  ('CNC Turn-Mill Centre',    'Machining',  'Ø300mm + milling, Y-axis',           20,   45,  72, 115,  10, 'Single setup complex parts'),
  ('CNC Grinding (Surface)',  'Machining',  '500x200mm table',                    10,   30,  50,  80,  10, NULL),
  ('CNC Grinding (Cylindrical)','Machining','Ø300x1000mm between centres',        15,   40,  65, 100,  10, NULL),

  -- Sheet Metal
  ('Fibre Laser 2kW',         'Sheet Metal','1500x3000mm bed; up to 8mm MS',      20,   35,  55,  85,  10, 'Entry-level; thick plate limited'),
  ('Fibre Laser 6kW',         'Sheet Metal','1500x3000mm; up to 20mm MS',         40,   50,  80, 130,  10, 'Production workhorse'),
  ('Fibre Laser 12kW',        'Sheet Metal','3000x1500mm; up to 30mm MS',         80,   80, 130, 200,  10, 'Thick plate + high speed on thin'),
  ('Press Brake 80T',         'Sheet Metal','80T x 2500mm; 5mm MS',               15,   20,  35,  55,  15, NULL),
  ('Press Brake 250T',        'Sheet Metal','250T x 4000mm; 15mm MS',             30,   30,  50,  80,  15, NULL),
  ('Turret Punch Press',      'Sheet Metal','1500x3000mm; up to 6mm',             25,   30,  50,  80,  12, NULL),
  ('Mechanical Stamping Press 200T','Sheet Metal','200T; 600x400mm bolster',      45,   25,  40,  65,  20, 'Progressive/compound die production'),
  ('Deep Drawing Press 400T', 'Sheet Metal','400T hydraulic; 800mm bed',          55,   40,  65, 100,  15, NULL),

  -- Welding
  ('MIG Welding Station (Manual)',  'Welding','1 torch; manual',                   5,   12,  20,  35,  10, 'Labour dominant cost; cell rate excludes operator'),
  ('Robotic MIG Cell (Single arm)', 'Welding','1 robot + positioner',             20,   40,  65, 100,  10, 'High volume; includes robot depreciation'),
  ('TIG Welding Station',           'Welding','Manual; Ø200A',                     5,   12,  20,  35,  10, NULL),
  ('Spot Welding Gun (Manual)',      'Welding','100kVA pedestal',                  25,   10,  18,  30,  15, NULL),
  ('Robotic Spot Welding Cell',      'Welding','2 x robot + 16 guns',             80,   50,  80, 130,  10, 'Auto body assembly'),
  ('Laser Welding Cell (Robotic)',   'Welding','3kW fibre; 6-axis robot',          40,   70, 110, 170,  10, 'Precision, thin-wall, disimilar metals'),

  -- Casting
  ('Die Casting 200T (Cold)',        'Casting','200T; up to 1.5kg Al shot',        45,   40,  65, 100,  15, NULL),
  ('Die Casting 400T (Cold)',        'Casting','400T; up to 4kg Al shot',          80,   55,  90, 140,  15, NULL),
  ('Die Casting 800T (Cold)',        'Casting','800T; large housing capacity',    160,   80, 130, 200,  15, NULL),
  ('Sand Casting Line',              'Casting','Manual / semi-auto moulding',      25,   25,  40,  65,  20, 'Labour intensive; low tooling cost'),
  ('Investment Casting Furnace',     'Casting','Batch; up to 50kg per pour',       30,   35,  55,  90,  20, 'Wax injection + shell + dewax + pour'),
  ('Gravity Die Casting',            'Casting','100-500kg ingot capacity',         20,   25,  40,  65,  15, 'Non-ferrous; Al/Zn/Brass'),

  -- Forging
  ('Hydraulic Forging Press 500T',   'Forging','500T; up to 50kg part',            80,   50,  80, 130,  20, NULL),
  ('Mechanical Forging Press 2000T', 'Forging','2000T; high-volume auto parts',   200,   70, 115, 180,  20, NULL),
  ('Cold Forging Press 200T',        'Forging','200T; small precision fasteners',  40,   40,  65, 100,  15, NULL),

  -- Surface / Heat Treatment
  ('Powder Coating Line (Manual)',   'Surface','Batch; up to 2x1x1m',              20,   20,  35,  55,  15, NULL),
  ('Powder Coating Line (Auto)',     'Surface','Conveyor; high volume',            80,   35,  55,  85,  15, NULL),
  ('Anodising Tank (Hard)',          'Surface','Batch; 2x1m tank; 100A/dm²',       30,   25,  40,  65,  20, 'Hard anodising; higher current density'),
  ('Electroplating Line',            'Surface','Semi-auto; multi-tank',            25,   30,  50,  80,  15, NULL),
  ('Heat Treatment Furnace (Box)',   'Surface','Batch; up to 1x1x0.8m; 1200°C',   60,   20,  35,  55,  20, NULL),
  ('Heat Treatment Furnace (Cont.)', 'Surface','Continuous belt; high volume',    120,   15,  25,  40,  20, NULL),

  -- Assembly / Inspection
  ('Manual Assembly Bench',          'Assembly','1 operator; fixtures',              2,    8,  15,  25,  10, 'Labour dominant'),
  ('Automated Assembly Cell',        'Assembly','PLC-controlled; multi-station',    30,   40,  65, 100,  10, NULL),
  ('CMM (Coordinate Measuring)',     'Quality', '600x600x500mm volume',              5,   20,  35,  55,  10, NULL),
  ('CMM (Large)',                    'Quality', '2000x1200x1000mm volume',          10,   35,  55,  90,  10, NULL),
  ('Vision Inspection System',       'Quality', '2D/3D; inline',                   10,   25,  40,  65,  10, NULL),
  ('3D Scanner (Portable)',          'Quality', '±0.02mm; up to 8m³',               0.5, 15,  25,  40,  7,  NULL)

ON CONFLICT DO NOTHING;


-- ── 8. SURFACE FINISH COST FACTORS ───────────────────────────────────────────
-- cost_factor: multiplier ON the base part manufacturing cost
-- per_m2_cost_usd: alternative area-based pricing

INSERT INTO surface_finish_cost_factors
  (process_name, finish_category, material_category,
   cost_factor, setup_cost_usd, per_m2_cost_usd, min_batch_size, lead_time_days_add, notes)
VALUES
  -- Powder Coating
  ('Powder Coating (Standard)','Powder Coating','Steel / Cast Iron',       1.12,  50.0,  8.00,  10,  3, 'Single colour; standard RAL; oven cure'),
  ('Powder Coating (Special Colour)','Powder Coating','Steel',             1.18,  80.0, 10.00,   5,  5, 'Colour change + purge cost'),
  ('Powder Coating (Textured)','Powder Coating','Steel',                   1.22, 100.0, 12.00,   5,  4, 'Crinkle/texture finish; premium powder cost'),
  ('Powder Coating (Two-coat)','Powder Coating','Steel',                   1.35, 120.0, 16.00,  10,  5, 'Primer + topcoat; marine/exterior spec'),

  -- Wet Painting
  ('Wet Spray (Single)','Wet Paint','All Metals',                          1.15,  60.0, 10.00,   5,  4, '1K or 2K polyurethane; standard quality'),
  ('Wet Spray (Automotive Grade)','Wet Paint','Steel / Aluminium',         1.35, 150.0, 20.00,   5,  7, '2K PU basecoat + clearcoat; 20+ micron DFT'),
  ('Electrophoretic (E-coat)','Wet Paint','Steel',                         1.20,  80.0, 12.00,  50,  5, 'Even coverage including recesses; cathodic preferred'),

  -- Anodising
  ('Anodise (Clear Type II)','Anodising','Aluminium',                      1.10,  60.0, 15.00,  10,  5, '10-15 micron; corrosion protection + adhesion'),
  ('Anodise (Colour Dye)','Anodising','Aluminium',                         1.18,  80.0, 20.00,  10,  7, 'Black/red/blue/gold etc.; add colour premium'),
  ('Anodise (Hard Type III)','Anodising','Aluminium',                      1.35, 100.0, 35.00,   5, 10, '25-50 micron; wear/corrosion critical; aerospace'),
  ('Anodise (Chromic Type I)','Anodising','Aluminium',                     1.30, 120.0, 30.00,   5, 10, 'Aerospace spec; REACH restrictions on Cr(VI)'),

  -- Electroplating
  ('Zinc Plating (Clear Passivate)','Electroplating','Steel',              1.12,  80.0, 12.00,  20,  5, '8-12 micron Zn + trivalent Cr passivate; RoHS'),
  ('Zinc Plating (Yellow Passivate)','Electroplating','Steel',             1.14,  80.0, 13.00,  20,  5, 'Extra salt spray resistance vs clear'),
  ('Zinc-Nickel Plating','Electroplating','Steel',                         1.28, 120.0, 25.00,  20,  7, 'High corrosion (1000h+ SST); automotive OEM spec'),
  ('Nickel Plating','Electroplating','Steel / Copper',                     1.30, 100.0, 28.00,  10,  7, 'Decorative + functional; sub-layer for chrome'),
  ('Chrome Plating (Decorative)','Electroplating','Steel / Brass',         1.50, 150.0, 40.00,  10, 10, 'Bright chrome; Cr(VI) restricted in EU'),
  ('Chrome Plating (Hard)','Electroplating','Steel',                       1.60, 200.0, 60.00,   5, 14, 'Functional; 20-100 micron; repair worn surfaces'),
  ('Electroless Nickel','Electroplating','Steel / Aluminium / Copper',     1.25, 100.0, 22.00,  10,  7, 'Uniform thickness; complex geometry; 90-93% Ni-P'),
  ('Gold Plating','Electroplating','Copper / Brass',                       1.80, 200.0,150.00,   5, 10, 'Contact plating; 0.5-3 micron; precious metal premium'),
  ('Silver Plating','Electroplating','Copper',                             1.40, 150.0, 60.00,   5,  7, 'Electrical conductivity; tarnish note'),
  ('Tin Plating','Electroplating','Steel / Copper',                        1.15,  80.0, 15.00,  20,  5, 'Solderable; food safe; PCB component finish'),

  -- Chemical / Conversion Coatings
  ('Passivation (Stainless)','Chemical Treatment','Stainless Steel',       1.06,  40.0,  5.00,  20,  3, 'Citric or nitric acid; removes free iron'),
  ('Chromate Conversion (Alodine)','Chemical Treatment','Aluminium',       1.08,  50.0,  6.00,  20,  3, 'MIL-DTL-5541; paint adhesion + mild corr. protection'),
  ('Phosphating (Iron)','Chemical Treatment','Steel',                      1.06,  40.0,  5.00,  50,  3, 'Pre-treatment before paint/powder coat'),
  ('Phosphating (Zinc)','Chemical Treatment','Steel',                      1.10,  60.0,  8.00,  30,  4, 'Anti-corrosion + paint adhesion; heavier coat'),
  ('Black Oxide','Chemical Treatment','Steel',                             1.05,  30.0,  4.00,  20,  3, 'Decorative; minimal corrosion; oil topcoat needed'),

  -- Mechanical Surface Treatment
  ('Shot Blasting (SA2.5)','Mechanical Finishing','Steel',                 1.04,  30.0,  3.00,  10,  1, 'Pre-paint prep standard'),
  ('Shot Peening','Mechanical Finishing','Steel / Aluminium',              1.12,  80.0,  8.00,  10,  3, 'Fatigue life improvement; aerospace/auto spec'),
  ('Vibratory Deburring','Mechanical Finishing','All Metals',              1.05,  20.0,  2.50,  50,  2, 'Batch process; good for small parts'),
  ('Electropolishing','Mechanical Finishing','Stainless Steel',            1.20,  80.0, 20.00,  10,  5, 'Ra improvement + passivation; medical/pharma'),

  -- Specialist
  ('PVD Coating (TiN)','PVD / CVD','Tool Steel / Carbide',                1.50, 150.0, NULL,   5, 10, '3-5 micron gold TiN; cutting tools, wear parts'),
  ('PVD Coating (TiAlN)','PVD / CVD','Tool Steel / Carbide',              1.55, 180.0, NULL,   5, 10, 'Higher temp rating than TiN; dry cutting'),
  ('DLC Coating','PVD / CVD','All Hard Substrates',                       1.70, 200.0, NULL,   5, 14, 'Diamond-like carbon; extreme wear + low friction'),
  ('PTFE Coating (Teflon)','Specialist','Aluminium / Steel',               1.20,  80.0, 15.00,  10,  7, 'Non-stick; food/chemical; bake-cure at 400°C'),
  ('Ceramic Coating (Thermal Spray)','Specialist','Steel',                 1.60, 200.0, 50.00,   3, 14, 'Thermal barrier; HVOF/APS; aerospace/power gen')

ON CONFLICT DO NOTHING;


-- ── 9. INSPECTION LEVEL COST FACTORS ─────────────────────────────────────────

INSERT INTO inspection_level_cost_factors
  (inspection_level, industry_standard, applicable_industries,
   cost_factor, lead_time_days_add, documentation_required, notes)
VALUES
  ('Standard Commercial',   NULL,            'General Engineering, Consumer',       1.00,  0, 'Delivery note only',                                      'Baseline; visual + dimensional spot check at supplier'),
  ('AQL 4.0 (Level I)',     'ANSI/ASQ Z1.4','General Industrial',                  1.05,  1, 'COC + inspection report',                                  'Reduced sampling; low criticality parts'),
  ('AQL 2.5 (Level II)',    'ANSI/ASQ Z1.4','Automotive, Mechanical',              1.12,  2, 'COC + dimensional report + material cert',                 'Normal sampling; standard industrial'),
  ('AQL 1.0 (Level III)',   'ANSI/ASQ Z1.4','Automotive OEM, Medical Device',      1.22,  3, 'Full dimensional + functional + material traceability',    'Tightened sampling; high reliability required'),
  ('100% Inspection',       'Customer Spec', 'Medical, Aerospace, Defence',         1.40,  4, 'Individual part record; serialisation may apply',          'Highest cost; operator or CMM 100% check'),
  ('PPAP Level 1',          'AIAG PPAP 4th', 'Automotive OEM Supply',              1.15,  5, 'Warrant (PSW) only',                                       'Submission to OEM; minimum documentation'),
  ('PPAP Level 3',          'AIAG PPAP 4th', 'Automotive OEM Supply',              1.45, 21, 'Full PPAP package: dimensional, material, MSA, FMEA, CP',  'Full customer approval; 1st article requirement'),
  ('First Article (AS9102)','AS9102',        'Aerospace, Defence',                  1.50, 14, 'Full FAIR: ballooned drawing, CMM report, material certs', 'Every new part number or design change'),
  ('NADCAP Process Audit',  'NADCAP',        'Aerospace (special processes)',       1.35,  7, 'NADCAP certificate + in-process traveller',                'Heat treat, NDT, welding, plating; customer mandated'),
  ('NDT (Dye Penetrant FPI)','ASTM E165',   'Aerospace, Defence, Oil & Gas',       1.20,  2, 'FPI report + operator Level II cert',                      'Surface crack detection; per-part or lot basis'),
  ('NDT (Radiography X-ray)','ASTM E1032',  'Aerospace, Casting, Pressure Vessel', 1.35,  3, 'Radiograph + Level II cert + interpretation sheet',        'Volumetric defects; porosity in castings'),
  ('NDT (Ultrasonic UT)',   'ASTM E114',    'Aerospace, Heavy Engineering',         1.30,  3, 'UT report + calibration records',                          'Forgings, thick plate, bonded structures'),
  ('CMM Full Dimensional',  'GD&T ASME Y14.5','Precision Engineering, Medical',   1.25,  3, 'Full CMM report to drawing dimensions',                    'Entire drawing ballooned and reported'),
  ('ISO 13485 Medical',     'ISO 13485',    'Medical Devices, Pharmaceutical',      1.60, 28, 'Full DHR: design validation, process validation, COC',     'Traceability from raw material to sterilisation'),
  ('AS9100 Aerospace',      'AS9100 Rev D', 'Aerospace OEM/Tier-1',                1.55, 21, 'AS9100 cert + config management + concession process',     'Flow-down from prime; every characteristic controlled')

ON CONFLICT DO NOTHING;


-- ── 10. FREIGHT RATES ────────────────────────────────────────────────────────
-- Representative 2024 market rates; wide ranges normal — use as planning estimates

INSERT INTO freight_rates
  (origin_region, destination_region, mode, weight_break_kg,
   rate_usd_per_kg, min_charge_usd, transit_days_min, transit_days_max, notes)
VALUES
  -- AIR FREIGHT (origin → destination; per kg incl. fuel surcharge typical)
  ('China',           'United Kingdom',  'Air',          45,   5.50,  150,  3,  5, 'Forwarder rate ex-Shanghai/Shenzhen; fuel surcharge included'),
  ('China',           'United Kingdom',  'Air',         300,   4.20,  200,  3,  5, '300kg break'),
  ('China',           'United Kingdom',  'Air',        1000,   3.80,  500,  3,  5, '+1000kg rate'),
  ('China',           'United States',   'Air',          45,   5.00,  150,  3,  5, 'Ex-PVG/SZX to US gateway'),
  ('China',           'United States',   'Air',         300,   3.90,  200,  3,  5, NULL),
  ('China',           'Germany',         'Air',          45,   5.20,  150,  3,  5, 'Ex-PVG to FRA'),
  ('India',           'United Kingdom',  'Air',          45,   4.80,  120,  2,  4, 'Ex-BOM/DEL to LHR'),
  ('India',           'United States',   'Air',          45,   5.20,  120,  3,  5, NULL),
  ('Vietnam',         'United Kingdom',  'Air',          45,   6.00,  150,  4,  6, 'Ex-HAN/SGN; slightly higher than China'),
  ('Vietnam',         'United States',   'Air',          45,   5.50,  150,  4,  6, NULL),
  ('Germany',         'United Kingdom',  'Air',          45,   2.50,  100,  1,  2, 'Intra-EU air; rare for freight — road preferred'),
  ('Turkey',          'United Kingdom',  'Air',          45,   3.50,  100,  1,  2, 'Ex-IST; competitive option'),
  ('United States',   'United Kingdom',  'Air',          45,   4.00,  120,  1,  2, 'Transatlantic air'),

  -- SEA FREIGHT FCL (Full Container Load — per container, converted to $/kg guide)
  ('China',           'United Kingdom',  'Sea FCL',   20000,   0.22,  2500, 28, 35, '20ft FCL ex-Shanghai to Felixstowe; inc THC/BAF'),
  ('China',           'United Kingdom',  'Sea FCL',   26000,   0.18,  3200, 28, 35, '40ft HQ FCL ex-Shanghai to Felixstowe'),
  ('China',           'United States',   'Sea FCL',   20000,   0.25,  2800, 18, 25, 'Transpacific; ex-Shenzhen to LA/Long Beach'),
  ('China',           'Germany',         'Sea FCL',   20000,   0.24,  2800, 30, 38, 'Ex-Shanghai to Hamburg; via Suez'),
  ('India',           'United Kingdom',  'Sea FCL',   20000,   0.30,  2000, 22, 30, 'Ex-JNPT Nhava Sheva to Tilbury/Felixstowe'),
  ('India',           'United States',   'Sea FCL',   20000,   0.32,  2200, 25, 32, NULL),
  ('Vietnam',         'United Kingdom',  'Sea FCL',   20000,   0.26,  2600, 30, 40, 'Ex-Ho Chi Minh; longer transit than China'),
  ('Vietnam',         'United States',   'Sea FCL',   20000,   0.23,  2500, 20, 28, NULL),
  ('Turkey',          'United Kingdom',  'Sea FCL',   20000,   0.15,  1500, 10, 15, 'Via Mediterranean/Aegean; competitive'),

  -- SEA FREIGHT LCL (Less than Container Load — per CBM, approx $/kg)
  ('China',           'United Kingdom',  'Sea LCL',     500,   0.80,   500, 30, 40, '$/kg equiv for LCL; incl. CFS + origin charges'),
  ('China',           'United States',   'Sea LCL',     500,   0.90,   500, 22, 30, NULL),
  ('India',           'United Kingdom',  'Sea LCL',     500,   1.00,   400, 25, 35, NULL),

  -- ROAD FREIGHT (European land; per km basis summarised)
  ('Germany',         'United Kingdom',  'Road',        500,   0.45,   200,  2,  4, 'Inc Channel Tunnel/ferry; Euro pallet rates'),
  ('Germany',         'United Kingdom',  'Road',       5000,   0.30,   500,  2,  4, 'FTL rate; 33 pallet truck'),
  ('Poland',          'United Kingdom',  'Road',        500,   0.40,   200,  3,  5, NULL),
  ('Turkey',          'United Kingdom',  'Road',        500,   0.55,   300,  5,  8, 'TIR; variable with border wait'),
  ('Turkey',          'Germany',         'Road',        500,   0.45,   250,  3,  5, NULL),
  ('Mexico',          'United States',   'Road',        500,   0.35,   200,  2,  5, 'USMCA cross-border; FTL truck'),

  -- RAIL FREIGHT (China-Europe Belt & Road)
  ('China',           'Germany',         'Rail',       5000,   0.60,  1500, 18, 25, 'China-Europe rail via Kazakhstan; growing reliability'),
  ('China',           'Poland',          'Rail',       5000,   0.55,  1400, 16, 22, 'Łódź/Małaszewicze rail terminal')

ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r_scrap     INTEGER;
  r_country   INTEGER;
  r_util      INTEGER;
  r_tool      INTEGER;
  r_oh        INTEGER;
  r_density   INTEGER;
  r_machine   INTEGER;
  r_surface   INTEGER;
  r_inspect   INTEGER;
  r_freight   INTEGER;
BEGIN
  SELECT COUNT(*) INTO r_scrap    FROM process_scrap_rates;
  SELECT COUNT(*) INTO r_country  FROM country_cost_factors;
  SELECT COUNT(*) INTO r_util     FROM machine_utilization_factors;
  SELECT COUNT(*) INTO r_tool     FROM tool_life_reference;
  SELECT COUNT(*) INTO r_oh       FROM overhead_profiles;
  SELECT COUNT(*) INTO r_density  FROM material_density_library;
  SELECT COUNT(*) INTO r_machine  FROM machine_master;
  SELECT COUNT(*) INTO r_surface  FROM surface_finish_cost_factors;
  SELECT COUNT(*) INTO r_inspect  FROM inspection_level_cost_factors;
  SELECT COUNT(*) INTO r_freight  FROM freight_rates;

  RAISE NOTICE '=== Migration 162 — Cost Engineering Lookup Tables ===';
  RAISE NOTICE 'process_scrap_rates:          % rows', r_scrap;
  RAISE NOTICE 'country_cost_factors:         % rows', r_country;
  RAISE NOTICE 'machine_utilization_factors:  % rows', r_util;
  RAISE NOTICE 'tool_life_reference:          % rows', r_tool;
  RAISE NOTICE 'overhead_profiles:            % rows', r_oh;
  RAISE NOTICE 'material_density_library:     % rows', r_density;
  RAISE NOTICE 'machine_master:               % rows', r_machine;
  RAISE NOTICE 'surface_finish_cost_factors:  % rows', r_surface;
  RAISE NOTICE 'inspection_level_cost_factors:% rows', r_inspect;
  RAISE NOTICE 'freight_rates:                % rows', r_freight;
  RAISE NOTICE '======================================================';
END $$;
