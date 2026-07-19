-- Migration 345: mhr_benchmark_rates table + 2026 industry seed data
-- ════════════════════════════════════════════════════════════════════════════════
-- PURPOSE
--   Provides a global (no user_id) machine-hour-rate benchmark table that the
--   Process Cost dialog falls back to when the user has no custom MHR records for
--   the selected location.  Mirrors the lhr_benchmark_rates pattern.
--
-- METHODOLOGY (aPriori-style fully-burdened MHR, USD/hr, machine costs only)
--   MHR = (depreciation + interest + insurance + facility + maintenance
--          + energy + tooling consumables + admin overhead) / effective_hours
--   Effective hours = working_hours × OEE (70 % unless noted)
--   Direct labour is NOT included — that is LHR, tracked separately.
--
-- BASIS (mid-2026 contract-manufacturing industry estimates)
--   Depreciation periods: 8–12 yr depending on machine class
--   OEE assumption: 70 % (conservative; typical CM facility)
--   Energy rates used:
--     USA $0.09/kWh · UK $0.22/kWh · DE/FR $0.20/kWh · W.Europe $0.18/kWh
--     E.Europe $0.11/kWh · China $0.07/kWh · India $0.08/kWh
--     Vietnam $0.08/kWh · Mexico $0.10/kWh
--   FX: all rates expressed in USD (USD, GBP→1.27, EUR→1.09, CNY→0.138,
--        INR→0.012, VND~0.000039, MXN→0.057) as of mid-2026
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mhr_benchmark_rates (
  id               BIGSERIAL    PRIMARY KEY,
  machine_name     TEXT         NOT NULL,
  process_group    TEXT         NOT NULL,
  location         TEXT         NOT NULL,
  mhr_usd          NUMERIC(10,2) NOT NULL,  -- fully-burdened machine rate in USD/hr
  machine_ref      TEXT,                     -- representative machine / size class
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_mhr_bm_machine_group_loc UNIQUE (machine_name, process_group, location)
);

CREATE INDEX IF NOT EXISTS idx_mhr_bm_location     ON mhr_benchmark_rates(location);
CREATE INDEX IF NOT EXISTS idx_mhr_bm_process_group ON mhr_benchmark_rates(process_group);

-- ════════════════════════════════════════════════════════════════════════════════
-- SEED: Sheet Metal machines
-- ════════════════════════════════════════════════════════════════════════════════
INSERT INTO mhr_benchmark_rates (machine_name, process_group, location, mhr_usd, machine_ref) VALUES

-- Fiber Laser Cutter 6kW — Trumpf TruLaser/Bystronic ByStar
-- Purchase: ~$600 K landed; 10 yr; 18 kW avg draw; consumables $8 K/yr
('Fiber Laser Cutter', 'Sheet Metal', 'USA',       95.00, 'Trumpf TruLaser 5030 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'UK',        82.00, 'Bystronic ByStar 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'Germany',  102.00, 'Trumpf TruLaser 5030 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'France',    88.00, 'Trumpf TruLaser 3030 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'W. Europe', 92.00, 'Bystronic ByStar 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'E. Europe', 45.00, 'Bystronic ByStar 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'China',     24.00, 'Han''s Laser 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'India',     13.00, 'Trumpf/HGTECH 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'Vietnam',   19.00, 'Han''s Laser 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'Mexico',    36.00, 'Bystronic ByStar 4kW'),

-- Press Brake 100T — Trumpf TruBend/Amada HFE
-- Purchase: ~$120 K landed; 10 yr; 12 kW avg; tooling $3 K/yr
('Press Brake',        'Sheet Metal', 'USA',       74.00, 'Trumpf TruBend 5130'),
('Press Brake',        'Sheet Metal', 'UK',        64.00, 'Amada HFE 100-3'),
('Press Brake',        'Sheet Metal', 'Germany',   78.00, 'Trumpf TruBend 5130'),
('Press Brake',        'Sheet Metal', 'France',    70.00, 'Amada HFE 100-3'),
('Press Brake',        'Sheet Metal', 'W. Europe', 72.00, 'Amada HFE 100-3'),
('Press Brake',        'Sheet Metal', 'E. Europe', 34.00, 'Amada HFE 100-3'),
('Press Brake',        'Sheet Metal', 'China',     18.00, 'Durma AD-S 100'),
('Press Brake',        'Sheet Metal', 'India',     10.00, 'Durma / Delem 100T'),
('Press Brake',        'Sheet Metal', 'Vietnam',   15.00, 'Amada HFE 80T'),
('Press Brake',        'Sheet Metal', 'Mexico',    28.00, 'Amada HFE 100-3'),

-- CNC Turret Punch — Amada EM-3612 / Trumpf TruPunch
-- Purchase: ~$350 K landed; 10 yr; 25 kW avg
('CNC Turret Punch',   'Sheet Metal', 'USA',       84.00, 'Amada EM-3612 NT'),
('CNC Turret Punch',   'Sheet Metal', 'UK',        73.00, 'Trumpf TruPunch 3000'),
('CNC Turret Punch',   'Sheet Metal', 'Germany',   88.00, 'Trumpf TruPunch 5000'),
('CNC Turret Punch',   'Sheet Metal', 'France',    78.00, 'Amada EM-3612 NT'),
('CNC Turret Punch',   'Sheet Metal', 'W. Europe', 80.00, 'Amada EM-3612 NT'),
('CNC Turret Punch',   'Sheet Metal', 'E. Europe', 38.00, 'Trumpf TruPunch 3000'),
('CNC Turret Punch',   'Sheet Metal', 'China',     20.00, 'Amada EM-2510'),
('CNC Turret Punch',   'Sheet Metal', 'India',     11.00, 'Amada EM-2510'),
('CNC Turret Punch',   'Sheet Metal', 'Vietnam',   16.00, 'Amada EM-2510'),
('CNC Turret Punch',   'Sheet Metal', 'Mexico',    30.00, 'Trumpf TruPunch 3000'),

-- Waterjet Cutter — Flow Mach 4 / OMAX 2626
-- Purchase: ~$250 K landed; 10 yr; 37 kW; abrasive $18 K/yr
('Waterjet Cutter',    'Sheet Metal', 'USA',       78.00, 'Flow Mach 4c 3020'),
('Waterjet Cutter',    'Sheet Metal', 'UK',        70.00, 'Flow Mach 4c 3020'),
('Waterjet Cutter',    'Sheet Metal', 'Germany',   84.00, 'Flow Mach 4c 3020'),
('Waterjet Cutter',    'Sheet Metal', 'France',    74.00, 'OMAX 80160'),
('Waterjet Cutter',    'Sheet Metal', 'W. Europe', 76.00, 'Flow Mach 4c 3020'),
('Waterjet Cutter',    'Sheet Metal', 'E. Europe', 36.00, 'OMAX 80160'),
('Waterjet Cutter',    'Sheet Metal', 'China',     19.00, 'Shenyang CNC Waterjet'),
('Waterjet Cutter',    'Sheet Metal', 'India',     10.00, 'OMAX 55100'),
('Waterjet Cutter',    'Sheet Metal', 'Vietnam',   15.00, 'OMAX 55100'),
('Waterjet Cutter',    'Sheet Metal', 'Mexico',    28.00, 'Flow Mach 4c'),

-- Spot Welder / Resistance Welder
-- Purchase: ~$80 K; 8 yr; 40 kW peak / 8 kW avg; tooling $2 K/yr
('Spot Welder',        'Sheet Metal', 'USA',       52.00, 'Lincoln Electric IDEALARC'),
('Spot Welder',        'Sheet Metal', 'UK',        46.00, 'Lincoln Electric IDEALARC'),
('Spot Welder',        'Sheet Metal', 'Germany',   55.00, 'NIMAK spot welder'),
('Spot Welder',        'Sheet Metal', 'France',    50.00, 'Lincoln Electric IDEALARC'),
('Spot Welder',        'Sheet Metal', 'W. Europe', 52.00, 'NIMAK spot welder'),
('Spot Welder',        'Sheet Metal', 'E. Europe', 24.00, 'Lincoln Electric IDEALARC'),
('Spot Welder',        'Sheet Metal', 'China',     11.00, 'Panasonic TIG/MIG spot'),
('Spot Welder',        'Sheet Metal', 'India',      6.00, 'Lincoln Electric IDEALARC'),
('Spot Welder',        'Sheet Metal', 'Vietnam',    9.00, 'Lincoln Electric IDEALARC'),
('Spot Welder',        'Sheet Metal', 'Mexico',    18.00, 'Lincoln Electric IDEALARC'),

-- ════════════════════════════════════════════════════════════════════════════════
-- SEED: CNC Machining machines  (stored under BOTH 'Machining' and 'CNC Machining')
-- ════════════════════════════════════════════════════════════════════════════════

-- CNC Lathe (2-axis turning centre) — Mazak Quick Turn 250 / DMG NLX 2500
-- Purchase: ~$180 K landed; 10 yr; 15 kW avg
('CNC Lathe',          'Machining',   'USA',      100.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'Machining',   'UK',        88.00, 'DMG NLX 2500'),
('CNC Lathe',          'Machining',   'Germany',  108.00, 'DMG NLX 2500'),
('CNC Lathe',          'Machining',   'France',    96.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'Machining',   'W. Europe', 98.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'Machining',   'E. Europe', 46.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'Machining',   'China',     25.00, 'Mazak Quick Turn 200'),
('CNC Lathe',          'Machining',   'India',     15.00, 'Mazak Quick Turn 200'),
('CNC Lathe',          'Machining',   'Vietnam',   19.00, 'Mazak Quick Turn 200'),
('CNC Lathe',          'Machining',   'Mexico',    38.00, 'Mazak Quick Turn 250'),

('CNC Lathe',          'CNC Machining', 'USA',    100.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'CNC Machining', 'UK',      88.00, 'DMG NLX 2500'),
('CNC Lathe',          'CNC Machining', 'Germany',108.00, 'DMG NLX 2500'),
('CNC Lathe',          'CNC Machining', 'France',  96.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'CNC Machining', 'W. Europe', 98.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'CNC Machining', 'E. Europe', 46.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'CNC Machining', 'China',   25.00, 'Mazak Quick Turn 200'),
('CNC Lathe',          'CNC Machining', 'India',   15.00, 'Mazak Quick Turn 200'),
('CNC Lathe',          'CNC Machining', 'Vietnam', 19.00, 'Mazak Quick Turn 200'),
('CNC Lathe',          'CNC Machining', 'Mexico',  38.00, 'Mazak Quick Turn 250'),

-- CNC Mill 3-Axis — Haas VF-2 / DMG DMU 50
-- Purchase: ~$220 K landed; 10 yr; 18 kW avg; tooling $8 K/yr
('CNC Mill 3-Axis',    'Machining',   'USA',      115.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'Machining',   'UK',       100.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'Machining',   'Germany',  120.00, 'DMG DMU 50'),
('CNC Mill 3-Axis',    'Machining',   'France',   108.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'Machining',   'W. Europe',110.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'Machining',   'E. Europe', 52.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'Machining',   'China',     28.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'Machining',   'India',     16.00, 'Haas VF-2 / BFW'),
('CNC Mill 3-Axis',    'Machining',   'Vietnam',   22.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'Machining',   'Mexico',    42.00, 'Haas VF-2'),

('CNC Mill 3-Axis',    'CNC Machining', 'USA',    115.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'CNC Machining', 'UK',     100.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'CNC Machining', 'Germany',120.00, 'DMG DMU 50'),
('CNC Mill 3-Axis',    'CNC Machining', 'France', 108.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'CNC Machining', 'W. Europe', 110.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'CNC Machining', 'E. Europe', 52.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'CNC Machining', 'China',   28.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'CNC Machining', 'India',   16.00, 'Haas VF-2 / BFW'),
('CNC Mill 3-Axis',    'CNC Machining', 'Vietnam', 22.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'CNC Machining', 'Mexico',  42.00, 'Haas VF-2'),

-- CNC Mill 5-Axis — DMG DMU 60 eVo / Makino D200Z
-- Purchase: ~$450 K landed; 10 yr; 28 kW avg; tooling $12 K/yr
('CNC Mill 5-Axis',    'Machining',   'USA',      160.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'Machining',   'UK',       140.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'Machining',   'Germany',  172.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'Machining',   'France',   152.00, 'Makino D200Z'),
('CNC Mill 5-Axis',    'Machining',   'W. Europe',156.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'Machining',   'E. Europe', 75.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'Machining',   'China',     40.00, 'DMG DMU 50 / local'),
('CNC Mill 5-Axis',    'Machining',   'India',     24.00, 'DMG DMU 50'),
('CNC Mill 5-Axis',    'Machining',   'Vietnam',   32.00, 'DMG DMU 50'),
('CNC Mill 5-Axis',    'Machining',   'Mexico',    62.00, 'DMG DMU 60 eVo'),

('CNC Mill 5-Axis',    'CNC Machining', 'USA',    160.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'CNC Machining', 'UK',     140.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'CNC Machining', 'Germany',172.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'CNC Machining', 'France', 152.00, 'Makino D200Z'),
('CNC Mill 5-Axis',    'CNC Machining', 'W. Europe', 156.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'CNC Machining', 'E. Europe', 75.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'CNC Machining', 'China',   40.00, 'DMG DMU 50 / local'),
('CNC Mill 5-Axis',    'CNC Machining', 'India',   24.00, 'DMG DMU 50'),
('CNC Mill 5-Axis',    'CNC Machining', 'Vietnam', 32.00, 'DMG DMU 50'),
('CNC Mill 5-Axis',    'CNC Machining', 'Mexico',  62.00, 'DMG DMU 60 eVo'),

-- Surface Grinder — Studer S33 / Jones & Shipman 540X
-- Purchase: ~$180 K; 10 yr; 12 kW avg; wheel/dress consumables $4 K/yr
('Surface Grinder',    'Machining',   'USA',       88.00, 'Studer S33'),
('Surface Grinder',    'Machining',   'UK',        77.00, 'Jones & Shipman 540X'),
('Surface Grinder',    'Machining',   'Germany',   94.00, 'Studer S33'),
('Surface Grinder',    'Machining',   'France',    82.00, 'Studer S33'),
('Surface Grinder',    'Machining',   'W. Europe', 85.00, 'Studer S33'),
('Surface Grinder',    'Machining',   'E. Europe', 40.00, 'Studer S33'),
('Surface Grinder',    'Machining',   'China',     22.00, 'Studer S11 / local'),
('Surface Grinder',    'Machining',   'India',     12.00, 'Bharat Fritz Werner'),
('Surface Grinder',    'Machining',   'Vietnam',   17.00, 'Studer S11'),
('Surface Grinder',    'Machining',   'Mexico',    32.00, 'Studer S33'),

('Surface Grinder',    'CNC Machining', 'USA',     88.00, 'Studer S33'),
('Surface Grinder',    'CNC Machining', 'UK',      77.00, 'Jones & Shipman 540X'),
('Surface Grinder',    'CNC Machining', 'Germany', 94.00, 'Studer S33'),
('Surface Grinder',    'CNC Machining', 'France',  82.00, 'Studer S33'),
('Surface Grinder',    'CNC Machining', 'W. Europe', 85.00, 'Studer S33'),
('Surface Grinder',    'CNC Machining', 'E. Europe', 40.00, 'Studer S33'),
('Surface Grinder',    'CNC Machining', 'China',   22.00, 'Studer S11 / local'),
('Surface Grinder',    'CNC Machining', 'India',   12.00, 'Bharat Fritz Werner'),
('Surface Grinder',    'CNC Machining', 'Vietnam', 17.00, 'Studer S11'),
('Surface Grinder',    'CNC Machining', 'Mexico',  32.00, 'Studer S33'),

-- Drill Press (CNC) — Chiron DZ 12 W / OKK VP500
-- Purchase: ~$60 K; 8 yr; 8 kW avg
('Drill Press',        'Machining',   'USA',       58.00, 'Chiron DZ 12 W'),
('Drill Press',        'Machining',   'UK',        52.00, 'Chiron DZ 12 W'),
('Drill Press',        'Machining',   'Germany',   62.00, 'Chiron DZ 12 W'),
('Drill Press',        'Machining',   'France',    56.00, 'Chiron DZ 12 W'),
('Drill Press',        'Machining',   'W. Europe', 58.00, 'Chiron DZ 12 W'),
('Drill Press',        'Machining',   'E. Europe', 27.00, 'Chiron DZ 12 W'),
('Drill Press',        'Machining',   'China',     13.00, 'Chiron DZ / local'),
('Drill Press',        'Machining',   'India',      7.00, 'HMT / local CNC drill'),
('Drill Press',        'Machining',   'Vietnam',   11.00, 'Chiron DZ'),
('Drill Press',        'Machining',   'Mexico',    20.00, 'Chiron DZ 12 W'),

('Drill Press',        'CNC Machining', 'USA',     58.00, 'Chiron DZ 12 W'),
('Drill Press',        'CNC Machining', 'UK',      52.00, 'Chiron DZ 12 W'),
('Drill Press',        'CNC Machining', 'Germany', 62.00, 'Chiron DZ 12 W'),
('Drill Press',        'CNC Machining', 'France',  56.00, 'Chiron DZ 12 W'),
('Drill Press',        'CNC Machining', 'W. Europe', 58.00, 'Chiron DZ 12 W'),
('Drill Press',        'CNC Machining', 'E. Europe', 27.00, 'Chiron DZ 12 W'),
('Drill Press',        'CNC Machining', 'China',   13.00, 'Chiron DZ / local'),
('Drill Press',        'CNC Machining', 'India',    7.00, 'HMT / local CNC drill'),
('Drill Press',        'CNC Machining', 'Vietnam', 11.00, 'Chiron DZ'),
('Drill Press',        'CNC Machining', 'Mexico',  20.00, 'Chiron DZ 12 W'),

-- ════════════════════════════════════════════════════════════════════════════════
-- SEED: Injection Molding machines (stored under 'Injection Molding', 'Plastics',
--       and 'Plastic & Rubber' for seamless process-group alias resolution)
-- ════════════════════════════════════════════════════════════════════════════════

-- IM 100T — Arburg Allrounder 370 / Engel e-victory 100
-- Purchase: ~$150 K landed; 10 yr; 20 kW avg
('IM Machine 100T', 'Injection Molding', 'USA',       73.00, 'Arburg Allrounder 370'),
('IM Machine 100T', 'Injection Molding', 'UK',        65.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Injection Molding', 'Germany',   78.00, 'Arburg Allrounder 370'),
('IM Machine 100T', 'Injection Molding', 'France',    68.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Injection Molding', 'W. Europe', 70.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Injection Molding', 'E. Europe', 33.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Injection Molding', 'China',     17.00, 'Haitian Mars II 100T'),
('IM Machine 100T', 'Injection Molding', 'India',     10.00, 'Haitian / Ferromatic 100T'),
('IM Machine 100T', 'Injection Molding', 'Vietnam',   14.00, 'Haitian Mars II 100T'),
('IM Machine 100T', 'Injection Molding', 'Mexico',    27.00, 'Arburg Allrounder 370'),

('IM Machine 100T', 'Plastics',          'USA',       73.00, 'Arburg Allrounder 370'),
('IM Machine 100T', 'Plastics',          'UK',        65.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Plastics',          'Germany',   78.00, 'Arburg Allrounder 370'),
('IM Machine 100T', 'Plastics',          'France',    68.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Plastics',          'W. Europe', 70.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Plastics',          'E. Europe', 33.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Plastics',          'China',     17.00, 'Haitian Mars II 100T'),
('IM Machine 100T', 'Plastics',          'India',     10.00, 'Haitian / Ferromatic 100T'),
('IM Machine 100T', 'Plastics',          'Vietnam',   14.00, 'Haitian Mars II 100T'),
('IM Machine 100T', 'Plastics',          'Mexico',    27.00, 'Arburg Allrounder 370'),

('IM Machine 100T', 'Plastic & Rubber',  'USA',       73.00, 'Arburg Allrounder 370'),
('IM Machine 100T', 'Plastic & Rubber',  'UK',        65.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Plastic & Rubber',  'Germany',   78.00, 'Arburg Allrounder 370'),
('IM Machine 100T', 'Plastic & Rubber',  'France',    68.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Plastic & Rubber',  'W. Europe', 70.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Plastic & Rubber',  'E. Europe', 33.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Plastic & Rubber',  'China',     17.00, 'Haitian Mars II 100T'),
('IM Machine 100T', 'Plastic & Rubber',  'India',     10.00, 'Haitian / Ferromatic 100T'),
('IM Machine 100T', 'Plastic & Rubber',  'Vietnam',   14.00, 'Haitian Mars II 100T'),
('IM Machine 100T', 'Plastic & Rubber',  'Mexico',    27.00, 'Arburg Allrounder 370'),

-- IM 250T — Arburg Allrounder 570 / Engel e-victory 250
-- Purchase: ~$280 K landed; 10 yr; 38 kW avg
('IM Machine 250T', 'Injection Molding', 'USA',      105.00, 'Arburg Allrounder 570'),
('IM Machine 250T', 'Injection Molding', 'UK',        92.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Injection Molding', 'Germany',  110.00, 'Arburg Allrounder 570'),
('IM Machine 250T', 'Injection Molding', 'France',    98.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Injection Molding', 'W. Europe',100.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Injection Molding', 'E. Europe', 48.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Injection Molding', 'China',     25.00, 'Haitian Jupiter II 250T'),
('IM Machine 250T', 'Injection Molding', 'India',     14.00, 'Haitian / Netstal 250T'),
('IM Machine 250T', 'Injection Molding', 'Vietnam',   19.00, 'Haitian Jupiter II 250T'),
('IM Machine 250T', 'Injection Molding', 'Mexico',    38.00, 'Arburg Allrounder 570'),

('IM Machine 250T', 'Plastics',          'USA',      105.00, 'Arburg Allrounder 570'),
('IM Machine 250T', 'Plastics',          'UK',        92.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Plastics',          'Germany',  110.00, 'Arburg Allrounder 570'),
('IM Machine 250T', 'Plastics',          'France',    98.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Plastics',          'W. Europe',100.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Plastics',          'E. Europe', 48.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Plastics',          'China',     25.00, 'Haitian Jupiter II 250T'),
('IM Machine 250T', 'Plastics',          'India',     14.00, 'Haitian / Netstal 250T'),
('IM Machine 250T', 'Plastics',          'Vietnam',   19.00, 'Haitian Jupiter II 250T'),
('IM Machine 250T', 'Plastics',          'Mexico',    38.00, 'Arburg Allrounder 570'),

('IM Machine 250T', 'Plastic & Rubber',  'USA',      105.00, 'Arburg Allrounder 570'),
('IM Machine 250T', 'Plastic & Rubber',  'UK',        92.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Plastic & Rubber',  'Germany',  110.00, 'Arburg Allrounder 570'),
('IM Machine 250T', 'Plastic & Rubber',  'France',    98.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Plastic & Rubber',  'W. Europe',100.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Plastic & Rubber',  'E. Europe', 48.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Plastic & Rubber',  'China',     25.00, 'Haitian Jupiter II 250T'),
('IM Machine 250T', 'Plastic & Rubber',  'India',     14.00, 'Haitian / Netstal 250T'),
('IM Machine 250T', 'Plastic & Rubber',  'Vietnam',   19.00, 'Haitian Jupiter II 250T'),
('IM Machine 250T', 'Plastic & Rubber',  'Mexico',    38.00, 'Arburg Allrounder 570'),

-- IM 500T — Engel duo 500 / Krauss-Maffei KM500
-- Purchase: ~$550 K landed; 12 yr; 72 kW avg
('IM Machine 500T', 'Injection Molding', 'USA',      142.00, 'Engel duo 500'),
('IM Machine 500T', 'Injection Molding', 'UK',       124.00, 'Engel duo 500'),
('IM Machine 500T', 'Injection Molding', 'Germany',  149.00, 'Krauss-Maffei KM500'),
('IM Machine 500T', 'Injection Molding', 'France',   132.00, 'Engel duo 500'),
('IM Machine 500T', 'Injection Molding', 'W. Europe',136.00, 'Engel duo 500'),
('IM Machine 500T', 'Injection Molding', 'E. Europe', 64.00, 'Engel duo 500'),
('IM Machine 500T', 'Injection Molding', 'China',     36.00, 'Haitian Jupiter III 500T'),
('IM Machine 500T', 'Injection Molding', 'India',     20.00, 'Engel duo 500 / local'),
('IM Machine 500T', 'Injection Molding', 'Vietnam',   27.00, 'Haitian Jupiter III 500T'),
('IM Machine 500T', 'Injection Molding', 'Mexico',    52.00, 'Engel duo 500'),

('IM Machine 500T', 'Plastics',          'USA',      142.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastics',          'UK',       124.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastics',          'Germany',  149.00, 'Krauss-Maffei KM500'),
('IM Machine 500T', 'Plastics',          'France',   132.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastics',          'W. Europe',136.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastics',          'E. Europe', 64.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastics',          'China',     36.00, 'Haitian Jupiter III 500T'),
('IM Machine 500T', 'Plastics',          'India',     20.00, 'Engel duo 500 / local'),
('IM Machine 500T', 'Plastics',          'Vietnam',   27.00, 'Haitian Jupiter III 500T'),
('IM Machine 500T', 'Plastics',          'Mexico',    52.00, 'Engel duo 500'),

('IM Machine 500T', 'Plastic & Rubber',  'USA',      142.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastic & Rubber',  'UK',       124.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastic & Rubber',  'Germany',  149.00, 'Krauss-Maffei KM500'),
('IM Machine 500T', 'Plastic & Rubber',  'France',   132.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastic & Rubber',  'W. Europe',136.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastic & Rubber',  'E. Europe', 64.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastic & Rubber',  'China',     36.00, 'Haitian Jupiter III 500T'),
('IM Machine 500T', 'Plastic & Rubber',  'India',     20.00, 'Engel duo 500 / local'),
('IM Machine 500T', 'Plastic & Rubber',  'Vietnam',   27.00, 'Haitian Jupiter III 500T'),
('IM Machine 500T', 'Plastic & Rubber',  'Mexico',    52.00, 'Engel duo 500'),

-- ════════════════════════════════════════════════════════════════════════════════
-- SEED: Quality / Inspection machines
-- ════════════════════════════════════════════════════════════════════════════════

-- CMM — Zeiss Contura / Hexagon Global Classic
-- Purchase: ~$180 K; 10 yr; 3 kW; climate-controlled cell included
('CMM Machine',          'Quality', 'USA',       65.00, 'Zeiss Contura G2'),
('CMM Machine',          'Quality', 'UK',        57.00, 'Hexagon Global Classic'),
('CMM Machine',          'Quality', 'Germany',   70.00, 'Zeiss Contura G2'),
('CMM Machine',          'Quality', 'France',    60.00, 'Hexagon Global Classic'),
('CMM Machine',          'Quality', 'W. Europe', 62.00, 'Hexagon Global Classic'),
('CMM Machine',          'Quality', 'E. Europe', 28.00, 'Hexagon Global Classic'),
('CMM Machine',          'Quality', 'China',     13.00, 'Zeiss Contura / local'),
('CMM Machine',          'Quality', 'India',      8.00, 'Hexagon Global Classic'),
('CMM Machine',          'Quality', 'Vietnam',   10.00, 'Hexagon Global Classic'),
('CMM Machine',          'Quality', 'Mexico',    18.00, 'Zeiss Contura G2'),

-- Manual Inspection Bench (light fixtures, gauges, comparators)
('Manual Inspection Bench', 'Quality', 'USA',    40.00, 'Gauge bench + optical comparator'),
('Manual Inspection Bench', 'Quality', 'UK',     35.00, 'Gauge bench + optical comparator'),
('Manual Inspection Bench', 'Quality', 'Germany',43.00, 'Gauge bench + optical comparator'),
('Manual Inspection Bench', 'Quality', 'France', 38.00, 'Gauge bench + optical comparator'),
('Manual Inspection Bench', 'Quality', 'W. Europe', 39.00, 'Gauge bench + optical comparator'),
('Manual Inspection Bench', 'Quality', 'E. Europe', 17.00, 'Gauge bench + optical comparator'),
('Manual Inspection Bench', 'Quality', 'China',   7.00, 'Gauge bench'),
('Manual Inspection Bench', 'Quality', 'India',   5.00, 'Gauge bench'),
('Manual Inspection Bench', 'Quality', 'Vietnam', 6.00, 'Gauge bench'),
('Manual Inspection Bench', 'Quality', 'Mexico', 12.00, 'Gauge bench + optical comparator'),

-- ════════════════════════════════════════════════════════════════════════════════
-- SEED: Assembly / General
-- ════════════════════════════════════════════════════════════════════════════════
('Manual Assembly Bench', 'Assembly', 'USA',       36.00, 'Ergonomic assembly station'),
('Manual Assembly Bench', 'Assembly', 'UK',        30.00, 'Ergonomic assembly station'),
('Manual Assembly Bench', 'Assembly', 'Germany',   38.00, 'Ergonomic assembly station'),
('Manual Assembly Bench', 'Assembly', 'France',    36.00, 'Ergonomic assembly station'),
('Manual Assembly Bench', 'Assembly', 'W. Europe', 33.00, 'Ergonomic assembly station'),
('Manual Assembly Bench', 'Assembly', 'E. Europe', 15.00, 'Ergonomic assembly station'),
('Manual Assembly Bench', 'Assembly', 'China',      7.00, 'Assembly station'),
('Manual Assembly Bench', 'Assembly', 'India',      4.00, 'Assembly station'),
('Manual Assembly Bench', 'Assembly', 'Vietnam',    5.00, 'Assembly station'),
('Manual Assembly Bench', 'Assembly', 'Mexico',    10.00, 'Ergonomic assembly station')

ON CONFLICT (machine_name, process_group, location) DO UPDATE SET
  mhr_usd      = EXCLUDED.mhr_usd,
  machine_ref  = EXCLUDED.machine_ref,
  updated_at   = now();

-- ════════════════════════════════════════════════════════════════════════════════
-- UPDATE lhr_benchmark_rates with accurate 2026 all-in direct labour rates (USD/hr)
-- ════════════════════════════════════════════════════════════════════════════════
-- Basis: base wage + statutory social charges/burden, all converted to USD effective
--   USA:      BLS NAICS 33 mfg avg hourly + 30 % benefits burden
--   UK:       ONS ASHE engineering + 25 % NI/employer pension loading → GBP×1.27
--   Germany:  IG Metall Entgelttarifvertrag + 30 % social charges → EUR×1.09
--   France:   Convention collective métallurgie + 45 % charges patronales → EUR×1.09
--   W.Europe: Benelux/Scandinavia weighted avg + 32 % loading → EUR×1.09
--   E.Europe: Poland/Czech/Romania avg + 28 % ZUS/social → EUR×1.09
--   China:    Guangdong/Shanghai mfg avg + 25 % social insurance → CNY×0.138
--   India:    ESIC/EPF-covered skilled worker + 18 % statutory → INR×0.012
--   Vietnam:  SHUI-covered skilled + 21 % social → USD direct
--   Mexico:   IMSS + 35 % aportaciones patronales → MXN×0.057
INSERT INTO lhr_benchmark_rates
  (labour_code, labour_type, description, lhr, location, process_group, currency, currency_symbol, lhr_usd_effective)
VALUES
-- ── USA (USD) ──────────────────────────────────────────────────────────────────
('BM-US-SM',  'Sheet Metal Fabricator',  '2026 all-in LHR — USA / Sheet Metal',   40.00, 'USA', 'Sheet Metal',   'USD', '$',  40.00),
('BM-US-CNC', 'CNC Machinist',           '2026 all-in LHR — USA / CNC Machining', 48.00, 'USA', 'CNC Machining', 'USD', '$',  48.00),
('BM-US-PL',  'IM / Plastics Operator',  '2026 all-in LHR — USA / Plastics',      33.00, 'USA', 'Plastics',      'USD', '$',  33.00),
('BM-US-QA',  'Quality Inspector',       '2026 all-in LHR — USA / Quality',       36.00, 'USA', 'Quality',       'USD', '$',  36.00),
-- ── UK (GBP → USD @1.27) ───────────────────────────────────────────────────────
('BM-UK-SM',  'Sheet Metal Fabricator',  '2026 all-in LHR — UK / Sheet Metal',    36.00, 'UK',  'Sheet Metal',   'GBP', '£',  36.00),
('BM-UK-CNC', 'CNC Machinist',           '2026 all-in LHR — UK / CNC Machining',  40.00, 'UK',  'CNC Machining', 'GBP', '£',  40.00),
('BM-UK-PL',  'IM / Plastics Operator',  '2026 all-in LHR — UK / Plastics',       30.00, 'UK',  'Plastics',      'GBP', '£',  30.00),
('BM-UK-QA',  'Quality Inspector',       '2026 all-in LHR — UK / Quality',        32.00, 'UK',  'Quality',       'GBP', '£',  32.00),
-- ── Germany (EUR → USD @1.09) ──────────────────────────────────────────────────
('BM-DE-SM',  'Sheet Metal Fabricator',  '2026 all-in LHR — Germany / Sheet Metal',   42.00, 'Germany', 'Sheet Metal',   'EUR', '€', 42.00),
('BM-DE-CNC', 'CNC Machinist',           '2026 all-in LHR — Germany / CNC Machining', 47.00, 'Germany', 'CNC Machining', 'EUR', '€', 47.00),
('BM-DE-PL',  'IM / Plastics Operator',  '2026 all-in LHR — Germany / Plastics',      36.00, 'Germany', 'Plastics',      'EUR', '€', 36.00),
('BM-DE-QA',  'Quality Inspector',       '2026 all-in LHR — Germany / Quality',       39.00, 'Germany', 'Quality',       'EUR', '€', 39.00),
-- ── France (EUR → USD @1.09) ───────────────────────────────────────────────────
('BM-FR-SM',  'Sheet Metal Fabricator',  '2026 all-in LHR — France / Sheet Metal',    43.00, 'France', 'Sheet Metal',   'EUR', '€', 43.00),
('BM-FR-CNC', 'CNC Machinist',           '2026 all-in LHR — France / CNC Machining',  48.00, 'France', 'CNC Machining', 'EUR', '€', 48.00),
('BM-FR-PL',  'IM / Plastics Operator',  '2026 all-in LHR — France / Plastics',       37.00, 'France', 'Plastics',      'EUR', '€', 37.00),
('BM-FR-QA',  'Quality Inspector',       '2026 all-in LHR — France / Quality',        40.00, 'France', 'Quality',       'EUR', '€', 40.00),
-- ── W. Europe / Benelux (EUR → USD @1.09) ─────────────────────────────────────
('BM-WE-SM',  'Sheet Metal Fabricator',  '2026 all-in LHR — W. Europe / Sheet Metal',   36.00, 'W. Europe', 'Sheet Metal',   'EUR', '€', 36.00),
('BM-WE-CNC', 'CNC Machinist',           '2026 all-in LHR — W. Europe / CNC Machining', 40.00, 'W. Europe', 'CNC Machining', 'EUR', '€', 40.00),
('BM-WE-PL',  'IM / Plastics Operator',  '2026 all-in LHR — W. Europe / Plastics',      31.00, 'W. Europe', 'Plastics',      'EUR', '€', 31.00),
('BM-WE-QA',  'Quality Inspector',       '2026 all-in LHR — W. Europe / Quality',       33.00, 'W. Europe', 'Quality',       'EUR', '€', 33.00),
-- ── E. Europe / Poland-Czech (EUR → USD @1.09) ────────────────────────────────
('BM-EE-SM',  'Sheet Metal Fabricator',  '2026 all-in LHR — E. Europe / Sheet Metal',   20.00, 'E. Europe', 'Sheet Metal',   'EUR', '€', 20.00),
('BM-EE-CNC', 'CNC Machinist',           '2026 all-in LHR — E. Europe / CNC Machining', 23.00, 'E. Europe', 'CNC Machining', 'EUR', '€', 23.00),
('BM-EE-PL',  'IM / Plastics Operator',  '2026 all-in LHR — E. Europe / Plastics',      17.00, 'E. Europe', 'Plastics',      'EUR', '€', 17.00),
('BM-EE-QA',  'Quality Inspector',       '2026 all-in LHR — E. Europe / Quality',       18.00, 'E. Europe', 'Quality',       'EUR', '€', 18.00),
-- ── China / Guangdong-Shanghai (CNY → USD @0.138) ─────────────────────────────
('BM-CN-SM',  'Sheet Metal Operator',    '2026 all-in LHR — China / Sheet Metal',    7.00, 'China', 'Sheet Metal',   'CNY', '¥', 7.00),
('BM-CN-CNC', 'CNC Machinist',           '2026 all-in LHR — China / CNC Machining',  8.50, 'China', 'CNC Machining', 'CNY', '¥', 8.50),
('BM-CN-PL',  'IM / Plastics Operator',  '2026 all-in LHR — China / Plastics',       6.00, 'China', 'Plastics',      'CNY', '¥', 6.00),
('BM-CN-QA',  'Quality Inspector',       '2026 all-in LHR — China / Quality',        6.00, 'China', 'Quality',       'CNY', '¥', 6.00),
-- ── India (INR → USD @0.012) ───────────────────────────────────────────────────
('BM-IN-SM',  'Sheet Metal Operator',    '2026 all-in LHR — India / Sheet Metal',    5.00, 'India', 'Sheet Metal',   'INR', '₹', 5.00),
('BM-IN-CNC', 'CNC Machinist',           '2026 all-in LHR — India / CNC Machining',  6.50, 'India', 'CNC Machining', 'INR', '₹', 6.50),
('BM-IN-PL',  'IM / Plastics Operator',  '2026 all-in LHR — India / Plastics',       4.00, 'India', 'Plastics',      'INR', '₹', 4.00),
('BM-IN-QA',  'Quality Inspector',       '2026 all-in LHR — India / Quality',        5.00, 'India', 'Quality',       'INR', '₹', 5.00),
-- ── Vietnam (USD direct) ───────────────────────────────────────────────────────
('BM-VN-SM',  'Sheet Metal Operator',    '2026 all-in LHR — Vietnam / Sheet Metal',   4.00, 'Vietnam', 'Sheet Metal',   'USD', '$', 4.00),
('BM-VN-CNC', 'CNC Machinist',           '2026 all-in LHR — Vietnam / CNC Machining', 5.00, 'Vietnam', 'CNC Machining', 'USD', '$', 5.00),
('BM-VN-PL',  'IM / Plastics Operator',  '2026 all-in LHR — Vietnam / Plastics',      3.50, 'Vietnam', 'Plastics',      'USD', '$', 3.50),
('BM-VN-QA',  'Quality Inspector',       '2026 all-in LHR — Vietnam / Quality',       3.80, 'Vietnam', 'Quality',       'USD', '$', 3.80),
-- ── Mexico (MXN → USD @0.057) ──────────────────────────────────────────────────
('BM-MX-SM',  'Sheet Metal Fabricator',  '2026 all-in LHR — Mexico / Sheet Metal',   13.00, 'Mexico', 'Sheet Metal',   'MXN', 'MX$', 13.00),
('BM-MX-CNC', 'CNC Machinist',           '2026 all-in LHR — Mexico / CNC Machining', 15.00, 'Mexico', 'CNC Machining', 'MXN', 'MX$', 15.00),
('BM-MX-PL',  'IM / Plastics Operator',  '2026 all-in LHR — Mexico / Plastics',      11.00, 'Mexico', 'Plastics',      'MXN', 'MX$', 11.00),
('BM-MX-QA',  'Quality Inspector',       '2026 all-in LHR — Mexico / Quality',       11.00, 'Mexico', 'Quality',       'MXN', 'MX$', 11.00)

ON CONFLICT (location, process_group) DO UPDATE SET
  labour_code       = EXCLUDED.labour_code,
  labour_type       = EXCLUDED.labour_type,
  description       = EXCLUDED.description,
  lhr               = EXCLUDED.lhr,
  currency          = EXCLUDED.currency,
  currency_symbol   = EXCLUDED.currency_symbol,
  lhr_usd_effective = EXCLUDED.lhr_usd_effective,
  updated_at        = now();
