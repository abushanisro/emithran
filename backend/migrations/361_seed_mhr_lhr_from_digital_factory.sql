-- Migration 361: mhr_benchmark_rates table + digital factory rates (self-contained)
-- Absorbs migration 345 (CREATE TABLE + industry seed) so this file runs cleanly
-- even if 345 was never deployed. Safe to re-run: IF NOT EXISTS / ON CONFLICT.
--
-- What this migration does:
--   1. Creates mhr_benchmark_rates table
--   2. Seeds industry-benchmark MHR rates (from migration 345)
--   3. Inserts/updates power-specific laser and press brake rates from the user's
--      digital factory Combined_All_Countries rate table (2026)
--   4. Updates lhr_benchmark_rates with actual digital factory labour rates
-- ════════════════════════════════════════════════════════════════════════════════

-- ── 1. Table definition ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mhr_benchmark_rates (
  id            BIGSERIAL     PRIMARY KEY,
  machine_name  TEXT          NOT NULL,
  process_group TEXT          NOT NULL,
  location      TEXT          NOT NULL,
  mhr_usd       NUMERIC(10,2) NOT NULL,
  machine_ref   TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT uq_mhr_bm_machine_group_loc UNIQUE (machine_name, process_group, location)
);

CREATE INDEX IF NOT EXISTS idx_mhr_bm_location      ON mhr_benchmark_rates(location);
CREATE INDEX IF NOT EXISTS idx_mhr_bm_process_group ON mhr_benchmark_rates(process_group);

-- ── 2. Industry benchmark seed (from migration 345) ───────────────────────────
-- eMithran-style fully-burdened MHR in USD/hr; machine costs only (no labour).
-- OEE assumption 70 %; depreciation 8–12 yr; includes energy + tooling consumables.

INSERT INTO mhr_benchmark_rates (machine_name, process_group, location, mhr_usd, machine_ref) VALUES

-- ── Sheet Metal ───────────────────────────────────────────────────────────────
('Fiber Laser Cutter', 'Sheet Metal', 'USA',        95.00, 'Trumpf TruLaser 5030 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'UK',         82.00, 'Bystronic ByStar 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'Germany',   102.00, 'Trumpf TruLaser 5030 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'France',     88.00, 'Trumpf TruLaser 3030 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'W. Europe',  92.00, 'Bystronic ByStar 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'E. Europe',  45.00, 'Bystronic ByStar 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'China',      24.00, 'Han''s Laser 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'India',      13.00, 'Trumpf/HGTECH 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'Vietnam',    19.00, 'Han''s Laser 6kW'),
('Fiber Laser Cutter', 'Sheet Metal', 'Mexico',     36.00, 'Bystronic ByStar 4kW'),

('Press Brake',        'Sheet Metal', 'USA',        74.00, 'Trumpf TruBend 5130'),
('Press Brake',        'Sheet Metal', 'UK',         64.00, 'Amada HFE 100-3'),
('Press Brake',        'Sheet Metal', 'Germany',    78.00, 'Trumpf TruBend 5130'),
('Press Brake',        'Sheet Metal', 'France',     70.00, 'Amada HFE 100-3'),
('Press Brake',        'Sheet Metal', 'W. Europe',  72.00, 'Amada HFE 100-3'),
('Press Brake',        'Sheet Metal', 'E. Europe',  34.00, 'Amada HFE 100-3'),
('Press Brake',        'Sheet Metal', 'China',      18.00, 'Durma AD-S 100'),
('Press Brake',        'Sheet Metal', 'India',      10.00, 'Durma / Delem 100T'),
('Press Brake',        'Sheet Metal', 'Vietnam',    15.00, 'Amada HFE 80T'),
('Press Brake',        'Sheet Metal', 'Mexico',     28.00, 'Amada HFE 100-3'),

('CNC Turret Punch',   'Sheet Metal', 'USA',        84.00, 'Amada EM-3612 NT'),
('CNC Turret Punch',   'Sheet Metal', 'UK',         73.00, 'Trumpf TruPunch 3000'),
('CNC Turret Punch',   'Sheet Metal', 'Germany',    88.00, 'Trumpf TruPunch 5000'),
('CNC Turret Punch',   'Sheet Metal', 'France',     78.00, 'Amada EM-3612 NT'),
('CNC Turret Punch',   'Sheet Metal', 'W. Europe',  80.00, 'Amada EM-3612 NT'),
('CNC Turret Punch',   'Sheet Metal', 'E. Europe',  38.00, 'Trumpf TruPunch 3000'),
('CNC Turret Punch',   'Sheet Metal', 'China',      20.00, 'Amada EM-2510'),
('CNC Turret Punch',   'Sheet Metal', 'India',      11.00, 'Amada EM-2510'),
('CNC Turret Punch',   'Sheet Metal', 'Vietnam',    16.00, 'Amada EM-2510'),
('CNC Turret Punch',   'Sheet Metal', 'Mexico',     30.00, 'Trumpf TruPunch 3000'),

('Waterjet Cutter',    'Sheet Metal', 'USA',        78.00, 'Flow Mach 4c 3020'),
('Waterjet Cutter',    'Sheet Metal', 'UK',         70.00, 'Flow Mach 4c 3020'),
('Waterjet Cutter',    'Sheet Metal', 'Germany',    84.00, 'Flow Mach 4c 3020'),
('Waterjet Cutter',    'Sheet Metal', 'France',     74.00, 'OMAX 80160'),
('Waterjet Cutter',    'Sheet Metal', 'W. Europe',  76.00, 'Flow Mach 4c 3020'),
('Waterjet Cutter',    'Sheet Metal', 'E. Europe',  36.00, 'OMAX 80160'),
('Waterjet Cutter',    'Sheet Metal', 'China',      19.00, 'Shenyang CNC Waterjet'),
('Waterjet Cutter',    'Sheet Metal', 'India',      10.00, 'OMAX 55100'),
('Waterjet Cutter',    'Sheet Metal', 'Vietnam',    15.00, 'OMAX 55100'),
('Waterjet Cutter',    'Sheet Metal', 'Mexico',     28.00, 'Flow Mach 4c'),

('Spot Welder',        'Sheet Metal', 'USA',        52.00, 'Lincoln Electric IDEALARC'),
('Spot Welder',        'Sheet Metal', 'UK',         46.00, 'Lincoln Electric IDEALARC'),
('Spot Welder',        'Sheet Metal', 'Germany',    55.00, 'NIMAK spot welder'),
('Spot Welder',        'Sheet Metal', 'France',     50.00, 'Lincoln Electric IDEALARC'),
('Spot Welder',        'Sheet Metal', 'W. Europe',  52.00, 'NIMAK spot welder'),
('Spot Welder',        'Sheet Metal', 'E. Europe',  24.00, 'Lincoln Electric IDEALARC'),
('Spot Welder',        'Sheet Metal', 'China',      11.00, 'Panasonic TIG/MIG spot'),
('Spot Welder',        'Sheet Metal', 'India',       6.00, 'Lincoln Electric IDEALARC'),
('Spot Welder',        'Sheet Metal', 'Vietnam',     9.00, 'Lincoln Electric IDEALARC'),
('Spot Welder',        'Sheet Metal', 'Mexico',     18.00, 'Lincoln Electric IDEALARC'),

-- ── CNC Machining (stored under both 'Machining' and 'CNC Machining') ────────
('CNC Lathe',          'Machining',     'USA',      100.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'Machining',     'UK',        88.00, 'DMG NLX 2500'),
('CNC Lathe',          'Machining',     'Germany',  108.00, 'DMG NLX 2500'),
('CNC Lathe',          'Machining',     'France',    96.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'Machining',     'W. Europe', 98.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'Machining',     'E. Europe', 46.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'Machining',     'China',     25.00, 'Mazak Quick Turn 200'),
('CNC Lathe',          'Machining',     'India',     15.00, 'Mazak Quick Turn 200'),
('CNC Lathe',          'Machining',     'Vietnam',   19.00, 'Mazak Quick Turn 200'),
('CNC Lathe',          'Machining',     'Mexico',    38.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'CNC Machining', 'USA',      100.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'CNC Machining', 'UK',        88.00, 'DMG NLX 2500'),
('CNC Lathe',          'CNC Machining', 'Germany',  108.00, 'DMG NLX 2500'),
('CNC Lathe',          'CNC Machining', 'France',    96.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'CNC Machining', 'W. Europe', 98.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'CNC Machining', 'E. Europe', 46.00, 'Mazak Quick Turn 250'),
('CNC Lathe',          'CNC Machining', 'China',     25.00, 'Mazak Quick Turn 200'),
('CNC Lathe',          'CNC Machining', 'India',     15.00, 'Mazak Quick Turn 200'),
('CNC Lathe',          'CNC Machining', 'Vietnam',   19.00, 'Mazak Quick Turn 200'),
('CNC Lathe',          'CNC Machining', 'Mexico',    38.00, 'Mazak Quick Turn 250'),

('CNC Mill 3-Axis',    'Machining',     'USA',      115.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'Machining',     'UK',       100.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'Machining',     'Germany',  120.00, 'DMG DMU 50'),
('CNC Mill 3-Axis',    'Machining',     'France',   108.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'Machining',     'W. Europe',110.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'Machining',     'E. Europe', 52.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'Machining',     'China',     28.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'Machining',     'India',     16.00, 'Haas VF-2 / BFW'),
('CNC Mill 3-Axis',    'Machining',     'Vietnam',   22.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'Machining',     'Mexico',    42.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'CNC Machining', 'USA',      115.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'CNC Machining', 'UK',       100.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'CNC Machining', 'Germany',  120.00, 'DMG DMU 50'),
('CNC Mill 3-Axis',    'CNC Machining', 'France',   108.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'CNC Machining', 'W. Europe',110.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'CNC Machining', 'E. Europe', 52.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'CNC Machining', 'China',     28.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'CNC Machining', 'India',     16.00, 'Haas VF-2 / BFW'),
('CNC Mill 3-Axis',    'CNC Machining', 'Vietnam',   22.00, 'Haas VF-2'),
('CNC Mill 3-Axis',    'CNC Machining', 'Mexico',    42.00, 'Haas VF-2'),

('CNC Mill 5-Axis',    'Machining',     'USA',      160.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'Machining',     'UK',       140.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'Machining',     'Germany',  172.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'Machining',     'France',   152.00, 'Makino D200Z'),
('CNC Mill 5-Axis',    'Machining',     'W. Europe',156.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'Machining',     'E. Europe', 75.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'Machining',     'China',     40.00, 'DMG DMU 50 / local'),
('CNC Mill 5-Axis',    'Machining',     'India',     24.00, 'DMG DMU 50'),
('CNC Mill 5-Axis',    'Machining',     'Vietnam',   32.00, 'DMG DMU 50'),
('CNC Mill 5-Axis',    'Machining',     'Mexico',    62.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'CNC Machining', 'USA',      160.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'CNC Machining', 'UK',       140.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'CNC Machining', 'Germany',  172.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'CNC Machining', 'France',   152.00, 'Makino D200Z'),
('CNC Mill 5-Axis',    'CNC Machining', 'W. Europe',156.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'CNC Machining', 'E. Europe', 75.00, 'DMG DMU 60 eVo'),
('CNC Mill 5-Axis',    'CNC Machining', 'China',     40.00, 'DMG DMU 50 / local'),
('CNC Mill 5-Axis',    'CNC Machining', 'India',     24.00, 'DMG DMU 50'),
('CNC Mill 5-Axis',    'CNC Machining', 'Vietnam',   32.00, 'DMG DMU 50'),
('CNC Mill 5-Axis',    'CNC Machining', 'Mexico',    62.00, 'DMG DMU 60 eVo'),

('Surface Grinder',    'Machining',     'USA',       88.00, 'Studer S33'),
('Surface Grinder',    'Machining',     'UK',        77.00, 'Jones & Shipman 540X'),
('Surface Grinder',    'Machining',     'Germany',   94.00, 'Studer S33'),
('Surface Grinder',    'Machining',     'France',    82.00, 'Studer S33'),
('Surface Grinder',    'Machining',     'W. Europe', 85.00, 'Studer S33'),
('Surface Grinder',    'Machining',     'E. Europe', 40.00, 'Studer S33'),
('Surface Grinder',    'Machining',     'China',     22.00, 'Studer S11 / local'),
('Surface Grinder',    'Machining',     'India',     12.00, 'Bharat Fritz Werner'),
('Surface Grinder',    'Machining',     'Vietnam',   17.00, 'Studer S11'),
('Surface Grinder',    'Machining',     'Mexico',    32.00, 'Studer S33'),
('Surface Grinder',    'CNC Machining', 'USA',       88.00, 'Studer S33'),
('Surface Grinder',    'CNC Machining', 'UK',        77.00, 'Jones & Shipman 540X'),
('Surface Grinder',    'CNC Machining', 'Germany',   94.00, 'Studer S33'),
('Surface Grinder',    'CNC Machining', 'France',    82.00, 'Studer S33'),
('Surface Grinder',    'CNC Machining', 'W. Europe', 85.00, 'Studer S33'),
('Surface Grinder',    'CNC Machining', 'E. Europe', 40.00, 'Studer S33'),
('Surface Grinder',    'CNC Machining', 'China',     22.00, 'Studer S11 / local'),
('Surface Grinder',    'CNC Machining', 'India',     12.00, 'Bharat Fritz Werner'),
('Surface Grinder',    'CNC Machining', 'Vietnam',   17.00, 'Studer S11'),
('Surface Grinder',    'CNC Machining', 'Mexico',    32.00, 'Studer S33'),

('Drill Press',        'Machining',     'USA',       58.00, 'Chiron DZ 12 W'),
('Drill Press',        'Machining',     'UK',        52.00, 'Chiron DZ 12 W'),
('Drill Press',        'Machining',     'Germany',   62.00, 'Chiron DZ 12 W'),
('Drill Press',        'Machining',     'France',    56.00, 'Chiron DZ 12 W'),
('Drill Press',        'Machining',     'W. Europe', 58.00, 'Chiron DZ 12 W'),
('Drill Press',        'Machining',     'E. Europe', 27.00, 'Chiron DZ 12 W'),
('Drill Press',        'Machining',     'China',     13.00, 'Chiron DZ / local'),
('Drill Press',        'Machining',     'India',      7.00, 'HMT / local CNC drill'),
('Drill Press',        'Machining',     'Vietnam',   11.00, 'Chiron DZ'),
('Drill Press',        'Machining',     'Mexico',    20.00, 'Chiron DZ 12 W'),
('Drill Press',        'CNC Machining', 'USA',       58.00, 'Chiron DZ 12 W'),
('Drill Press',        'CNC Machining', 'UK',        52.00, 'Chiron DZ 12 W'),
('Drill Press',        'CNC Machining', 'Germany',   62.00, 'Chiron DZ 12 W'),
('Drill Press',        'CNC Machining', 'France',    56.00, 'Chiron DZ 12 W'),
('Drill Press',        'CNC Machining', 'W. Europe', 58.00, 'Chiron DZ 12 W'),
('Drill Press',        'CNC Machining', 'E. Europe', 27.00, 'Chiron DZ 12 W'),
('Drill Press',        'CNC Machining', 'China',     13.00, 'Chiron DZ / local'),
('Drill Press',        'CNC Machining', 'India',      7.00, 'HMT / local CNC drill'),
('Drill Press',        'CNC Machining', 'Vietnam',   11.00, 'Chiron DZ'),
('Drill Press',        'CNC Machining', 'Mexico',    20.00, 'Chiron DZ 12 W'),

-- ── Injection Molding (under 'Injection Molding', 'Plastics', 'Plastic & Rubber') ──
('IM Machine 100T', 'Injection Molding', 'USA',        73.00, 'Arburg Allrounder 370'),
('IM Machine 100T', 'Injection Molding', 'UK',         65.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Injection Molding', 'Germany',    78.00, 'Arburg Allrounder 370'),
('IM Machine 100T', 'Injection Molding', 'France',     68.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Injection Molding', 'W. Europe',  70.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Injection Molding', 'E. Europe',  33.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Injection Molding', 'China',      17.00, 'Haitian Mars II 100T'),
('IM Machine 100T', 'Injection Molding', 'India',      10.00, 'Haitian / Ferromatic 100T'),
('IM Machine 100T', 'Injection Molding', 'Vietnam',    14.00, 'Haitian Mars II 100T'),
('IM Machine 100T', 'Injection Molding', 'Mexico',     27.00, 'Arburg Allrounder 370'),
('IM Machine 100T', 'Plastics',          'USA',        73.00, 'Arburg Allrounder 370'),
('IM Machine 100T', 'Plastics',          'UK',         65.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Plastics',          'Germany',    78.00, 'Arburg Allrounder 370'),
('IM Machine 100T', 'Plastics',          'France',     68.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Plastics',          'W. Europe',  70.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Plastics',          'E. Europe',  33.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Plastics',          'China',      17.00, 'Haitian Mars II 100T'),
('IM Machine 100T', 'Plastics',          'India',      10.00, 'Haitian / Ferromatic 100T'),
('IM Machine 100T', 'Plastics',          'Vietnam',    14.00, 'Haitian Mars II 100T'),
('IM Machine 100T', 'Plastics',          'Mexico',     27.00, 'Arburg Allrounder 370'),
('IM Machine 100T', 'Plastic & Rubber',  'USA',        73.00, 'Arburg Allrounder 370'),
('IM Machine 100T', 'Plastic & Rubber',  'UK',         65.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Plastic & Rubber',  'Germany',    78.00, 'Arburg Allrounder 370'),
('IM Machine 100T', 'Plastic & Rubber',  'France',     68.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Plastic & Rubber',  'W. Europe',  70.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Plastic & Rubber',  'E. Europe',  33.00, 'Engel e-victory 100'),
('IM Machine 100T', 'Plastic & Rubber',  'China',      17.00, 'Haitian Mars II 100T'),
('IM Machine 100T', 'Plastic & Rubber',  'India',      10.00, 'Haitian / Ferromatic 100T'),
('IM Machine 100T', 'Plastic & Rubber',  'Vietnam',    14.00, 'Haitian Mars II 100T'),
('IM Machine 100T', 'Plastic & Rubber',  'Mexico',     27.00, 'Arburg Allrounder 370'),

('IM Machine 250T', 'Injection Molding', 'USA',       105.00, 'Arburg Allrounder 570'),
('IM Machine 250T', 'Injection Molding', 'UK',         92.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Injection Molding', 'Germany',   110.00, 'Arburg Allrounder 570'),
('IM Machine 250T', 'Injection Molding', 'France',     98.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Injection Molding', 'W. Europe', 100.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Injection Molding', 'E. Europe',  48.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Injection Molding', 'China',      25.00, 'Haitian Jupiter II 250T'),
('IM Machine 250T', 'Injection Molding', 'India',      14.00, 'Haitian / Netstal 250T'),
('IM Machine 250T', 'Injection Molding', 'Vietnam',    19.00, 'Haitian Jupiter II 250T'),
('IM Machine 250T', 'Injection Molding', 'Mexico',     38.00, 'Arburg Allrounder 570'),
('IM Machine 250T', 'Plastics',          'USA',       105.00, 'Arburg Allrounder 570'),
('IM Machine 250T', 'Plastics',          'UK',         92.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Plastics',          'Germany',   110.00, 'Arburg Allrounder 570'),
('IM Machine 250T', 'Plastics',          'France',     98.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Plastics',          'W. Europe', 100.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Plastics',          'E. Europe',  48.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Plastics',          'China',      25.00, 'Haitian Jupiter II 250T'),
('IM Machine 250T', 'Plastics',          'India',      14.00, 'Haitian / Netstal 250T'),
('IM Machine 250T', 'Plastics',          'Vietnam',    19.00, 'Haitian Jupiter II 250T'),
('IM Machine 250T', 'Plastics',          'Mexico',     38.00, 'Arburg Allrounder 570'),
('IM Machine 250T', 'Plastic & Rubber',  'USA',       105.00, 'Arburg Allrounder 570'),
('IM Machine 250T', 'Plastic & Rubber',  'UK',         92.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Plastic & Rubber',  'Germany',   110.00, 'Arburg Allrounder 570'),
('IM Machine 250T', 'Plastic & Rubber',  'France',     98.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Plastic & Rubber',  'W. Europe', 100.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Plastic & Rubber',  'E. Europe',  48.00, 'Engel e-victory 250'),
('IM Machine 250T', 'Plastic & Rubber',  'China',      25.00, 'Haitian Jupiter II 250T'),
('IM Machine 250T', 'Plastic & Rubber',  'India',      14.00, 'Haitian / Netstal 250T'),
('IM Machine 250T', 'Plastic & Rubber',  'Vietnam',    19.00, 'Haitian Jupiter II 250T'),
('IM Machine 250T', 'Plastic & Rubber',  'Mexico',     38.00, 'Arburg Allrounder 570'),

('IM Machine 500T', 'Injection Molding', 'USA',       142.00, 'Engel duo 500'),
('IM Machine 500T', 'Injection Molding', 'UK',        124.00, 'Engel duo 500'),
('IM Machine 500T', 'Injection Molding', 'Germany',   149.00, 'Krauss-Maffei KM500'),
('IM Machine 500T', 'Injection Molding', 'France',    132.00, 'Engel duo 500'),
('IM Machine 500T', 'Injection Molding', 'W. Europe', 136.00, 'Engel duo 500'),
('IM Machine 500T', 'Injection Molding', 'E. Europe',  64.00, 'Engel duo 500'),
('IM Machine 500T', 'Injection Molding', 'China',      36.00, 'Haitian Jupiter III 500T'),
('IM Machine 500T', 'Injection Molding', 'India',      20.00, 'Engel duo 500 / local'),
('IM Machine 500T', 'Injection Molding', 'Vietnam',    27.00, 'Haitian Jupiter III 500T'),
('IM Machine 500T', 'Injection Molding', 'Mexico',     52.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastics',          'USA',       142.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastics',          'UK',        124.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastics',          'Germany',   149.00, 'Krauss-Maffei KM500'),
('IM Machine 500T', 'Plastics',          'France',    132.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastics',          'W. Europe', 136.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastics',          'E. Europe',  64.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastics',          'China',      36.00, 'Haitian Jupiter III 500T'),
('IM Machine 500T', 'Plastics',          'India',      20.00, 'Engel duo 500 / local'),
('IM Machine 500T', 'Plastics',          'Vietnam',    27.00, 'Haitian Jupiter III 500T'),
('IM Machine 500T', 'Plastics',          'Mexico',     52.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastic & Rubber',  'USA',       142.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastic & Rubber',  'UK',        124.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastic & Rubber',  'Germany',   149.00, 'Krauss-Maffei KM500'),
('IM Machine 500T', 'Plastic & Rubber',  'France',    132.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastic & Rubber',  'W. Europe', 136.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastic & Rubber',  'E. Europe',  64.00, 'Engel duo 500'),
('IM Machine 500T', 'Plastic & Rubber',  'China',      36.00, 'Haitian Jupiter III 500T'),
('IM Machine 500T', 'Plastic & Rubber',  'India',      20.00, 'Engel duo 500 / local'),
('IM Machine 500T', 'Plastic & Rubber',  'Vietnam',    27.00, 'Haitian Jupiter III 500T'),
('IM Machine 500T', 'Plastic & Rubber',  'Mexico',     52.00, 'Engel duo 500'),

-- ── Quality / Inspection ─────────────────────────────────────────────────────
('CMM Machine',             'Quality', 'USA',        65.00, 'Zeiss Contura G2'),
('CMM Machine',             'Quality', 'UK',         57.00, 'Hexagon Global Classic'),
('CMM Machine',             'Quality', 'Germany',    70.00, 'Zeiss Contura G2'),
('CMM Machine',             'Quality', 'France',     60.00, 'Hexagon Global Classic'),
('CMM Machine',             'Quality', 'W. Europe',  62.00, 'Hexagon Global Classic'),
('CMM Machine',             'Quality', 'E. Europe',  28.00, 'Hexagon Global Classic'),
('CMM Machine',             'Quality', 'China',      13.00, 'Zeiss Contura / local'),
('CMM Machine',             'Quality', 'India',       8.00, 'Hexagon Global Classic'),
('CMM Machine',             'Quality', 'Vietnam',    10.00, 'Hexagon Global Classic'),
('CMM Machine',             'Quality', 'Mexico',     18.00, 'Zeiss Contura G2'),

('Manual Inspection Bench', 'Quality', 'USA',        40.00, 'Gauge bench + optical comparator'),
('Manual Inspection Bench', 'Quality', 'UK',         35.00, 'Gauge bench + optical comparator'),
('Manual Inspection Bench', 'Quality', 'Germany',    43.00, 'Gauge bench + optical comparator'),
('Manual Inspection Bench', 'Quality', 'France',     38.00, 'Gauge bench + optical comparator'),
('Manual Inspection Bench', 'Quality', 'W. Europe',  39.00, 'Gauge bench + optical comparator'),
('Manual Inspection Bench', 'Quality', 'E. Europe',  17.00, 'Gauge bench + optical comparator'),
('Manual Inspection Bench', 'Quality', 'China',       7.00, 'Gauge bench'),
('Manual Inspection Bench', 'Quality', 'India',       5.00, 'Gauge bench'),
('Manual Inspection Bench', 'Quality', 'Vietnam',     6.00, 'Gauge bench'),
('Manual Inspection Bench', 'Quality', 'Mexico',     12.00, 'Gauge bench + optical comparator'),

-- ── Assembly ──────────────────────────────────────────────────────────────────
('Manual Assembly Bench', 'Assembly', 'USA',         36.00, 'Ergonomic assembly station'),
('Manual Assembly Bench', 'Assembly', 'UK',          30.00, 'Ergonomic assembly station'),
('Manual Assembly Bench', 'Assembly', 'Germany',     38.00, 'Ergonomic assembly station'),
('Manual Assembly Bench', 'Assembly', 'France',      36.00, 'Ergonomic assembly station'),
('Manual Assembly Bench', 'Assembly', 'W. Europe',   33.00, 'Ergonomic assembly station'),
('Manual Assembly Bench', 'Assembly', 'E. Europe',   15.00, 'Ergonomic assembly station'),
('Manual Assembly Bench', 'Assembly', 'China',        7.00, 'Assembly station'),
('Manual Assembly Bench', 'Assembly', 'India',        4.00, 'Assembly station'),
('Manual Assembly Bench', 'Assembly', 'Vietnam',      5.00, 'Assembly station'),
('Manual Assembly Bench', 'Assembly', 'Mexico',      10.00, 'Ergonomic assembly station'),

-- ── 3. Digital factory rates (from user Combined_All_Countries 2026) ──────────
-- Power-specific fiber lasers and tonnage-specific press brakes so the
-- resolver can match the actual machine in the factory (not just a 6kW generic).
-- Also includes deburring benches and surface treatment equipment per location.

-- USA
('Fiber Laser 2kW',    'Sheet Metal',       'USA',    38.46, 'Salvagnini L3-30 2kW'),
('Fiber Laser 3kW',    'Sheet Metal',       'USA',    48.09, 'Salvagnini L3-40 3kW'),
('Fiber Laser 4kW',    'Sheet Metal',       'USA',    54.45, 'Generic 4kW Fiber Laser'),
('Fiber Laser 6kW',    'Sheet Metal',       'USA',    60.88, 'Generic 6kW Fiber Laser'),
('Fiber Laser 8kW',    'Sheet Metal',       'USA',    67.71, 'Generic 8kW Fiber Laser'),
('Fiber Laser 10kW',   'Sheet Metal',       'USA',    80.58, 'Generic 10kW Fiber Laser'),
('Press Brake 800kN',  'Sheet Metal',       'USA',    20.51, 'Press Brake 80T class'),
('Press Brake 1500kN', 'Sheet Metal',       'USA',    23.05, 'Press Brake 160T class'),
('Press Brake 2500kN', 'Sheet Metal',       'USA',    25.51, 'Press Brake 250T class'),
('Deburring Cell',     'Sheet Metal',       'USA',    14.13, 'Manual Deburr bench'),
('CMM Machine',        'Post Processing',   'USA',    16.89, 'Bridge CMM'),
('Anodize Line',       'Surface Treatment', 'USA',    48.69, 'Anodize Type I Line (large)'),
('Powder Coat Booth',  'Surface Treatment', 'USA',    14.63, 'Powder Coat Booth'),

-- Mexico
('Fiber Laser 2kW',    'Sheet Metal',       'Mexico',  25.19, 'Generic 2kW Fiber Laser'),
('Fiber Laser 3kW',    'Sheet Metal',       'Mexico',  34.76, 'Generic 3kW Fiber Laser'),
('Fiber Laser 4kW',    'Sheet Metal',       'Mexico',  40.76, 'Generic 4kW Fiber Laser'),
('Fiber Laser 6kW',    'Sheet Metal',       'Mexico',  47.14, 'Generic 6kW Fiber Laser'),
('Fiber Laser 8kW',    'Sheet Metal',       'Mexico',  54.13, 'Generic 8kW Fiber Laser'),
('Fiber Laser 10kW',   'Sheet Metal',       'Mexico',  66.93, 'Generic 10kW Fiber Laser'),
('Press Brake 800kN',  'Sheet Metal',       'Mexico',   8.60, 'Press Brake 80T class'),
('Press Brake 1500kN', 'Sheet Metal',       'Mexico',  10.94, 'Press Brake 160T class'),
('Press Brake 2500kN', 'Sheet Metal',       'Mexico',  12.93, 'Press Brake 250T class'),
('Deburring Cell',     'Sheet Metal',       'Mexico',   2.63, 'Manual Deburr bench'),
('Anodize Line',       'Surface Treatment', 'Mexico',  35.79, 'Anodize Type I Line'),

-- Germany
('Fiber Laser 2kW',    'Sheet Metal',       'Germany',  38.77, 'Generic 2kW Fiber Laser'),
('Fiber Laser 3kW',    'Sheet Metal',       'Germany',  48.15, 'Generic 3kW Fiber Laser'),
('Fiber Laser 4kW',    'Sheet Metal',       'Germany',  55.74, 'Generic 4kW Fiber Laser'),
('Fiber Laser 6kW',    'Sheet Metal',       'Germany',  62.00, 'Generic 6kW Fiber Laser'),
('Fiber Laser 8kW',    'Sheet Metal',       'Germany',  69.07, 'Generic 8kW Fiber Laser'),
('Fiber Laser 10kW',   'Sheet Metal',       'Germany',  81.63, 'Generic 10kW Fiber Laser'),
('Press Brake 800kN',  'Sheet Metal',       'Germany',  20.43, 'Press Brake 80T class'),
('Press Brake 1500kN', 'Sheet Metal',       'Germany',  23.40, 'Press Brake 160T class'),
('Press Brake 2500kN', 'Sheet Metal',       'Germany',  26.01, 'Press Brake 250T class'),
('Deburring Cell',     'Sheet Metal',       'Germany',  13.89, 'Manual Deburr bench'),
('Anodize Line',       'Surface Treatment', 'Germany',  57.93, 'Anodize Type I Line'),
('Powder Coat Booth',  'Surface Treatment', 'Germany',  14.38, 'Powder Coat Booth'),

-- China
('Fiber Laser 2kW',    'Sheet Metal',       'China',  21.26, 'Generic 2kW Fiber Laser'),
('Fiber Laser 3kW',    'Sheet Metal',       'China',  28.50, 'Generic 3kW Fiber Laser'),
('Fiber Laser 4kW',    'Sheet Metal',       'China',  32.79, 'Generic 4kW Fiber Laser'),
('Fiber Laser 6kW',    'Sheet Metal',       'China',  37.72, 'Generic 6kW Fiber Laser'),
('Fiber Laser 8kW',    'Sheet Metal',       'China',  42.77, 'Generic 8kW Fiber Laser'),
('Fiber Laser 10kW',   'Sheet Metal',       'China',  52.45, 'Generic 10kW Fiber Laser'),
('Press Brake 800kN',  'Sheet Metal',       'China',   8.59, 'Press Brake 80T class'),
('Press Brake 1500kN', 'Sheet Metal',       'China',  10.29, 'Press Brake 160T class'),
('Press Brake 2500kN', 'Sheet Metal',       'China',  11.87, 'Press Brake 250T class'),
('Deburring Cell',     'Sheet Metal',       'China',   4.07, 'Manual Deburr bench'),
('Anodize Line',       'Surface Treatment', 'China',  25.94, 'Anodize Type I Line'),
('Powder Coat Booth',  'Surface Treatment', 'China',   4.36, 'Powder Coat Booth'),

-- India
('Fiber Laser 2kW',    'Sheet Metal',       'India',  19.00, 'Salvagnini L3-30 2kW'),
('Fiber Laser 3kW',    'Sheet Metal',       'India',  26.77, 'Salvagnini L3-40 3kW'),
('Fiber Laser 4kW',    'Sheet Metal',       'India',  31.17, 'Generic 4kW Fiber Laser'),
('Fiber Laser 6kW',    'Sheet Metal',       'India',  36.36, 'Generic 6kW Fiber Laser'),
('Fiber Laser 8kW',    'Sheet Metal',       'India',  41.90, 'Generic 8kW Fiber Laser'),
('Fiber Laser 10kW',   'Sheet Metal',       'India',  52.28, 'Generic 10kW Fiber Laser'),
('Press Brake 800kN',  'Sheet Metal',       'India',   5.83, 'Press Brake 80T class'),
('Press Brake 1500kN', 'Sheet Metal',       'India',   7.55, 'Press Brake 160T class'),
('Press Brake 2500kN', 'Sheet Metal',       'India',   9.10, 'Press Brake 250T class'),
('Deburring Cell',     'Sheet Metal',       'India',   1.09, 'Manual Deburr bench'),
('Anodize Line',       'Surface Treatment', 'India',   9.52, 'Anodize Line (800 INR/hr ÷ 84)'),
('Powder Coat Booth',  'Surface Treatment', 'India',   5.95, 'Powder Coat Booth (500 INR/hr ÷ 84)')

ON CONFLICT (machine_name, process_group, location) DO UPDATE SET
  mhr_usd     = EXCLUDED.mhr_usd,
  machine_ref = EXCLUDED.machine_ref,
  updated_at  = now();

-- ── 4. LHR benchmark rates ────────────────────────────────────────────────────
-- Self-contained: creates lhr_benchmark_rates if it doesn't exist (absorbs the
-- lsr_benchmark_rates→lhr_benchmark_rates rename in src/database/migrations/342
-- which may not have been deployed). IF NOT EXISTS makes this a no-op when the
-- table already exists from migration 342 + earlier lsr_benchmark_rates creation.

CREATE TABLE IF NOT EXISTS lhr_benchmark_rates (
  id                BIGSERIAL    PRIMARY KEY,
  labour_code       TEXT         NOT NULL,
  labour_type       TEXT         NOT NULL,
  description       TEXT,
  lhr               NUMERIC(10,2) NOT NULL,
  location          TEXT         NOT NULL,
  process_group     TEXT         NOT NULL,
  currency          TEXT         NOT NULL DEFAULT 'INR',
  currency_symbol   TEXT         NOT NULL DEFAULT '₹',
  lhr_usd_effective NUMERIC(10,4),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_lhr_bm_location_group UNIQUE (location, process_group)
);

CREATE INDEX IF NOT EXISTS idx_lhr_bm_location      ON lhr_benchmark_rates(location);
CREATE INDEX IF NOT EXISTS idx_lhr_bm_process_group ON lhr_benchmark_rates(process_group);

-- Enable public read (benchmark data is not user-specific)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'lhr_benchmark_rates'
      AND policyname = 'Public read for lhr_benchmark_rates'
  ) THEN
    ALTER TABLE lhr_benchmark_rates ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Public read for lhr_benchmark_rates"
      ON lhr_benchmark_rates FOR SELECT
      USING (true);
  END IF;
END $$;

-- Seed all-in direct labour rates (USD/hr) from digital factory 2026.
-- lhr = local currency/hr; lhr_usd_effective = USD equivalent.

INSERT INTO lhr_benchmark_rates
  (labour_code, labour_type, description, lhr, location, process_group, currency, currency_symbol, lhr_usd_effective)
VALUES
-- USA
('BM-US-SM',  'Sheet Metal Fabricator', '2026 all-in LHR — USA / Sheet Metal',    46.67, 'USA', 'Sheet Metal',   'USD', '$',  46.67),
('BM-US-MC',  'CNC Machinist',          '2026 all-in LHR — USA / Machining',       46.67, 'USA', 'Machining',     'USD', '$',  46.67),
('BM-US-CNC', 'CNC Machinist',          '2026 all-in LHR — USA / CNC Machining',   46.67, 'USA', 'CNC Machining', 'USD', '$',  46.67),
('BM-US-PL',  'IM / Plastics Operator', '2026 all-in LHR — USA / Plastics',        39.21, 'USA', 'Plastics',      'USD', '$',  39.21),
('BM-US-PR',  'IM / Plastics Operator', '2026 all-in LHR — USA / Plastic & Rubber',39.21, 'USA', 'Plastic & Rubber','USD','$', 39.21),
('BM-US-QA',  'Quality Inspector',      '2026 all-in LHR — USA / Quality',         46.67, 'USA', 'Quality',       'USD', '$',  46.67),
('BM-US-PP',  'Post-process Operator',  '2026 all-in LHR — USA / Post Processing',  36.00, 'USA', 'Post Processing','USD','$', 36.00),
-- UK
('BM-UK-SM',  'Sheet Metal Fabricator', '2026 all-in LHR — UK / Sheet Metal',      36.00, 'UK',  'Sheet Metal',   'GBP', '£',  36.00),
('BM-UK-CNC', 'CNC Machinist',          '2026 all-in LHR — UK / CNC Machining',    40.00, 'UK',  'CNC Machining', 'GBP', '£',  40.00),
('BM-UK-MC',  'CNC Machinist',          '2026 all-in LHR — UK / Machining',        40.00, 'UK',  'Machining',     'GBP', '£',  40.00),
('BM-UK-PL',  'IM / Plastics Operator', '2026 all-in LHR — UK / Plastics',         30.00, 'UK',  'Plastics',      'GBP', '£',  30.00),
('BM-UK-QA',  'Quality Inspector',      '2026 all-in LHR — UK / Quality',          32.00, 'UK',  'Quality',       'GBP', '£',  32.00),
-- Germany
('BM-DE-SM',  'Sheet Metal Fabricator', '2026 all-in LHR — Germany / Sheet Metal',    45.14, 'Germany', 'Sheet Metal',   'EUR', '€', 45.14),
('BM-DE-MC',  'CNC Machinist',          '2026 all-in LHR — Germany / Machining',       45.14, 'Germany', 'Machining',     'EUR', '€', 45.14),
('BM-DE-CNC', 'CNC Machinist',          '2026 all-in LHR — Germany / CNC Machining',   45.14, 'Germany', 'CNC Machining', 'EUR', '€', 45.14),
('BM-DE-PL',  'IM / Plastics Operator', '2026 all-in LHR — Germany / Plastics',        36.00, 'Germany', 'Plastics',      'EUR', '€', 36.00),
('BM-DE-QA',  'Quality Inspector',      '2026 all-in LHR — Germany / Quality',         45.14, 'Germany', 'Quality',       'EUR', '€', 45.14),
-- France
('BM-FR-SM',  'Sheet Metal Fabricator', '2026 all-in LHR — France / Sheet Metal',    43.00, 'France', 'Sheet Metal',   'EUR', '€', 43.00),
('BM-FR-MC',  'CNC Machinist',          '2026 all-in LHR — France / Machining',       48.00, 'France', 'Machining',     'EUR', '€', 48.00),
('BM-FR-CNC', 'CNC Machinist',          '2026 all-in LHR — France / CNC Machining',   48.00, 'France', 'CNC Machining', 'EUR', '€', 48.00),
('BM-FR-PL',  'IM / Plastics Operator', '2026 all-in LHR — France / Plastics',        37.00, 'France', 'Plastics',      'EUR', '€', 37.00),
('BM-FR-QA',  'Quality Inspector',      '2026 all-in LHR — France / Quality',         40.00, 'France', 'Quality',       'EUR', '€', 40.00),
-- W. Europe
('BM-WE-SM',  'Sheet Metal Fabricator', '2026 all-in LHR — W. Europe / Sheet Metal',   36.00, 'W. Europe', 'Sheet Metal',   'EUR', '€', 36.00),
('BM-WE-CNC', 'CNC Machinist',          '2026 all-in LHR — W. Europe / CNC Machining', 40.00, 'W. Europe', 'CNC Machining', 'EUR', '€', 40.00),
('BM-WE-MC',  'CNC Machinist',          '2026 all-in LHR — W. Europe / Machining',     40.00, 'W. Europe', 'Machining',     'EUR', '€', 40.00),
('BM-WE-PL',  'IM / Plastics Operator', '2026 all-in LHR — W. Europe / Plastics',      31.00, 'W. Europe', 'Plastics',      'EUR', '€', 31.00),
('BM-WE-QA',  'Quality Inspector',      '2026 all-in LHR — W. Europe / Quality',       33.00, 'W. Europe', 'Quality',       'EUR', '€', 33.00),
-- E. Europe
('BM-EE-SM',  'Sheet Metal Fabricator', '2026 all-in LHR — E. Europe / Sheet Metal',   20.00, 'E. Europe', 'Sheet Metal',   'EUR', '€', 20.00),
('BM-EE-CNC', 'CNC Machinist',          '2026 all-in LHR — E. Europe / CNC Machining', 23.00, 'E. Europe', 'CNC Machining', 'EUR', '€', 23.00),
('BM-EE-MC',  'CNC Machinist',          '2026 all-in LHR — E. Europe / Machining',     23.00, 'E. Europe', 'Machining',     'EUR', '€', 23.00),
('BM-EE-PL',  'IM / Plastics Operator', '2026 all-in LHR — E. Europe / Plastics',      17.00, 'E. Europe', 'Plastics',      'EUR', '€', 17.00),
('BM-EE-QA',  'Quality Inspector',      '2026 all-in LHR — E. Europe / Quality',       18.00, 'E. Europe', 'Quality',       'EUR', '€', 18.00),
-- China
('BM-CN-SM',  'Sheet Metal Operator',   '2026 all-in LHR — China / Sheet Metal',    11.27, 'China', 'Sheet Metal',   'CNY', '¥', 11.27),
('BM-CN-CNC', 'CNC Machinist',          '2026 all-in LHR — China / CNC Machining',  11.27, 'China', 'CNC Machining', 'CNY', '¥', 11.27),
('BM-CN-MC',  'CNC Machinist',          '2026 all-in LHR — China / Machining',      11.27, 'China', 'Machining',     'CNY', '¥', 11.27),
('BM-CN-PL',  'IM / Plastics Operator', '2026 all-in LHR — China / Plastics',        6.00, 'China', 'Plastics',      'CNY', '¥',  6.00),
('BM-CN-QA',  'Quality Inspector',      '2026 all-in LHR — China / Quality',        13.41, 'China', 'Quality',       'CNY', '¥', 13.41),
-- India
('BM-IN-SM',  'Sheet Metal Operator',   '2026 all-in LHR — India / Sheet Metal',    1.73, 'India', 'Sheet Metal',   'INR', '₹', 1.73),
('BM-IN-CNC', 'CNC Machinist',          '2026 all-in LHR — India / CNC Machining',  2.75, 'India', 'CNC Machining', 'INR', '₹', 2.75),
('BM-IN-MC',  'CNC Machinist',          '2026 all-in LHR — India / Machining',      2.75, 'India', 'Machining',     'INR', '₹', 2.75),
('BM-IN-PL',  'IM / Plastics Operator', '2026 all-in LHR — India / Plastics',       1.73, 'India', 'Plastics',      'INR', '₹', 1.73),
('BM-IN-PR',  'IM / Plastics Operator', '2026 all-in LHR — India / Plastic & Rubber',1.73,'India', 'Plastic & Rubber','INR','₹',1.73),
('BM-IN-QA',  'Quality Inspector',      '2026 all-in LHR — India / Quality',        1.65, 'India', 'Quality',       'INR', '₹', 1.65),
-- Vietnam
('BM-VN-SM',  'Sheet Metal Operator',   '2026 all-in LHR — Vietnam / Sheet Metal',   4.00, 'Vietnam', 'Sheet Metal',   'USD', '$', 4.00),
('BM-VN-CNC', 'CNC Machinist',          '2026 all-in LHR — Vietnam / CNC Machining', 5.00, 'Vietnam', 'CNC Machining', 'USD', '$', 5.00),
('BM-VN-MC',  'CNC Machinist',          '2026 all-in LHR — Vietnam / Machining',     5.00, 'Vietnam', 'Machining',     'USD', '$', 5.00),
('BM-VN-PL',  'IM / Plastics Operator', '2026 all-in LHR — Vietnam / Plastics',      3.50, 'Vietnam', 'Plastics',      'USD', '$', 3.50),
('BM-VN-QA',  'Quality Inspector',      '2026 all-in LHR — Vietnam / Quality',       3.80, 'Vietnam', 'Quality',       'USD', '$', 3.80),
-- Mexico
('BM-MX-SM',  'Sheet Metal Fabricator', '2026 all-in LHR — Mexico / Sheet Metal',    8.34, 'Mexico', 'Sheet Metal',   'MXN', 'MX$',  8.34),
('BM-MX-CNC', 'CNC Machinist',          '2026 all-in LHR — Mexico / CNC Machining',  9.94, 'Mexico', 'CNC Machining', 'MXN', 'MX$',  9.94),
('BM-MX-MC',  'CNC Machinist',          '2026 all-in LHR — Mexico / Machining',      9.94, 'Mexico', 'Machining',     'MXN', 'MX$',  9.94),
('BM-MX-PL',  'IM / Plastics Operator', '2026 all-in LHR — Mexico / Plastics',      11.00, 'Mexico', 'Plastics',      'MXN', 'MX$', 11.00),
('BM-MX-QA',  'Quality Inspector',      '2026 all-in LHR — Mexico / Quality',        9.94, 'Mexico', 'Quality',       'MXN', 'MX$',  9.94)

ON CONFLICT (location, process_group) DO UPDATE SET
  labour_code       = EXCLUDED.labour_code,
  labour_type       = EXCLUDED.labour_type,
  description       = EXCLUDED.description,
  lhr               = EXCLUDED.lhr,
  currency          = EXCLUDED.currency,
  currency_symbol   = EXCLUDED.currency_symbol,
  lhr_usd_effective = EXCLUDED.lhr_usd_effective,
  updated_at        = now();
