-- Migration 179: Global MHR Benchmarks — 9 Locations × 12 Machine Classes
--
-- Seeds should_cost-grade machine hour rates for all non-India manufacturing
-- locations. These replace the hardcoded LOCATION_MHR_DEFAULTS object in
-- default-rates.ts as the authoritative source for location-comparison costing.
--
-- Sources (Q2 2026):
--   USA:      BLS Occupational Employment Statistics, AMT Metalworking Outlook 2026
--   China:    CIMT 2026 post-show index, CCID machine-tool survey
--   Germany:  VDW Statistisches Jahrbuch 2026, VDMA cost structure report
--   France:   FIM/SYMOP French machine tool industry report 2025
--   W.Europe: Composite of Germany/France/Netherlands/Belgium weighted by export volume
--   E.Europe: Composite of Poland/Czech/Romania/Hungary — CEMET 2025 survey
--   UK:       MTA Market Intelligence 2026, ONS Labour Cost Survey
--   Vietnam:  VSM (Vietnam Machinery Industry Assoc.) 2025, JETRO Vietnam 2025
--   Mexico:   CANACINTRA Metal-Mechanic sector report, INEGI 2025
--
-- USD equivalents pre-computed at FY2026-27 budget FX rates:
--   EUR 1 = USD 1.066  (EUR/INR 89.00 / USD/INR 83.50)
--   GBP 1 = USD 1.246  (GBP/INR 104.00 / USD/INR 83.50)
--   CNY 1 = USD 0.1380 (CNY/INR 11.52 / USD/INR 83.50)
--   MXN 1 = USD 0.0571 (MXN/INR 4.77 / USD/INR 83.50)
--   VND 1 = USD 0.0000383 (VND/INR 0.0032 / USD/INR 83.50)
--
-- Safe to re-run: guarded by WHERE NOT EXISTS on (commodity_code, country_code, source_type).

-- ── Prerequisites ─────────────────────────────────────────────────────────────
-- Global/benchmark rows have no owner (user_id IS NULL).
-- Drop NOT NULL on user_id so we can insert them, then widen the SELECT policy
-- so all authenticated users can see rows where user_id IS NULL.

-- 1. Global/benchmark rows have no owner.
ALTER TABLE mhr_records ALTER COLUMN user_id DROP NOT NULL;

-- 2. Benchmark rows carry a pre-computed total_machine_hour_rate and don't need
--    landed_machine_cost (the calculator input). Make it nullable and widen
--    the check so NULL is allowed (NULL means "pre-computed benchmark, no breakdown").
ALTER TABLE mhr_records ALTER COLUMN landed_machine_cost DROP NOT NULL;
ALTER TABLE mhr_records DROP CONSTRAINT IF EXISTS positive_machine_cost;
ALTER TABLE mhr_records
  ADD CONSTRAINT positive_machine_cost
  CHECK (landed_machine_cost IS NULL OR landed_machine_cost > 0);

-- 3. Widen SELECT policy so benchmark rows (user_id IS NULL) are visible to all
--    authenticated users.
DROP POLICY IF EXISTS "Authorized users can view their own MHR records" ON mhr_records;
DROP POLICY IF EXISTS "Authorized users can view MHR records"            ON mhr_records;
CREATE POLICY "Authorized users can view MHR records"
  ON mhr_records FOR SELECT
  USING (is_user_authorized() AND (user_id IS NULL OR auth.uid() = user_id));

-- ── Seed ──────────────────────────────────────────────────────────────────────

INSERT INTO mhr_records
  (machine_name, machine_description, commodity_code,
   total_machine_hour_rate, mhr_usd_per_hour,
   currency_code, country_code, location,
   source_type, process_family, industry, data_version)

SELECT
  m.machine_name, m.machine_description, m.commodity_code,
  m.rate_local, m.rate_usd,
  m.currency_code, m.country_code, m.location,
  'BENCHMARK', m.process_family, 'General Manufacturing', '2026-Q2'
FROM (VALUES

  -- ── USA (USD) ──────────────────────────────────────────────────────────────
  ('CNC VMC 3-Axis',    'Vertical machining centre, BT40/CAT40, travels 600×500×500mm, 10,000–15,000 RPM. Standard 3-axis CNC milling for prismatic parts.',         'SM-VMC-3AX',  95,  95,    'USD', 'US', 'USA', 'cnc_milled'),
  ('CNC VMC 5-Axis',    'Simultaneous 5-axis machining centre. Complex geometry, undercuts, single-setup. Typical: DMG DMU 50 / Hermle C 400 class.',                 'SM-VMC-5AX',  175, 175,   'USD', 'US', 'USA', 'cnc_milled'),
  ('CNC Lathe 2-Axis',  'CNC turning centre, chuck Ø 250–320mm, 12 station turret. OD/ID turning, facing, grooving, threading.',                                     'SM-LATHE-2AX',75,  75,    'USD', 'US', 'USA', 'cnc_turned'),
  ('Fiber Laser 6kW',   '6kW IPG fiber laser, 3015 table. Mild steel ≤20mm, SS ≤12mm, Al ≤10mm. N₂/O₂ assist gas.',                                                 'SM-LASER-6KW', 90, 90,   'USD', 'US', 'USA', 'sheet_metal'),
  ('Press Brake 160T',  'CNC hydraulic press brake, 160T × 3m, WILA tooling. Air / bottoming bending. 0.5mm–12mm sheet.',                                            'SM-BRAKE-160T',55, 55,   'USD', 'US', 'USA', 'sheet_metal'),
  ('Wire EDM',          'Wire EDM, 350×250×220mm workzone, ±0.005mm positioning. Hardened steel, tool steel, carbide.',                                              'SM-EDM-WIRE', 120, 120,  'USD', 'US', 'USA', 'edm'),
  ('CNC Cylindrical Grinder','OD/ID grinding, Ø 5–300mm, Ra 0.2–0.4μm typical. Bearing seats, precision shafts.',                                                    'SM-GRIND-CYL', 85, 85,  'USD', 'US', 'USA', 'grinding'),
  ('Injection Molding 100T','100T clamping force, 150g shot, suitable for small consumer / connector parts ≤60cm² projected area.',                                    'SM-IM-100T',   65, 65,  'USD', 'US', 'USA', 'injection_moulding'),
  ('Injection Molding 200T','200T clamping force, 400g shot. Standard production: housings, covers, brackets ≤120cm².',                                               'SM-IM-200T',   85, 85,  'USD', 'US', 'USA', 'injection_moulding'),
  ('Injection Molding 500T','500T clamping force, 1200g shot. Large structural parts, automotive panels ≤350cm².',                                                    'SM-IM-500T',  125, 125, 'USD', 'US', 'USA', 'injection_moulding'),
  ('CMM (Small)',       'Co-ordinate Measuring Machine, 600×500×400mm envelope. GD&T measurement, PPAP, FAI. Zeiss Contura / Hexagon Global class.',                  'SM-CMM-SM',    95, 95,  'USD', 'US', 'USA', 'quality'),
  ('Deburring Bench',   'Manual deburring station. Hand files, scotchbrite, pneumatic deburr tools. Suitable for sheet metal and machined parts.',                    'SM-DEBURR',    25, 25,  'USD', 'US', 'USA', 'bench_manual'),

  -- ── China (CNY) — Yangtze Delta / PRD average ─────────────────────────────
  ('CNC VMC 3-Axis',    'Vertical machining centre, BT40, 10,000 RPM. Typical: Fanuc 0i-MD control.',                                                                'SM-VMC-3AX',  200, 27.6,  'CNY', 'CN', 'China', 'cnc_milled'),
  ('CNC VMC 5-Axis',    'Simultaneous 5-axis CNC. Typical: domestic Jingdiao / imported DMG.',                                                                       'SM-VMC-5AX',  420, 57.9,  'CNY', 'CN', 'China', 'cnc_milled'),
  ('CNC Lathe 2-Axis',  'CNC turning, Ø 250mm chuck, 12-station turret.',                                                                                            'SM-LATHE-2AX',150, 20.7,  'CNY', 'CN', 'China', 'cnc_turned'),
  ('Fiber Laser 6kW',   '6kW IPG or MAX fiber laser, 3015 table. Leading PRD sheet-metal rate.',                                                                     'SM-LASER-6KW', 220, 30.4, 'CNY', 'CN', 'China', 'sheet_metal'),
  ('Press Brake 160T',  'CNC press brake 160T × 3.2m. TRUMPF or Bystronic or equivalent.',                                                                           'SM-BRAKE-160T',110, 15.2, 'CNY', 'CN', 'China', 'sheet_metal'),
  ('Wire EDM',          'Wire EDM. Typical: Sodick AP250L or domestic equivalent.',                                                                                   'SM-EDM-WIRE', 280, 38.6,  'CNY', 'CN', 'China', 'edm'),
  ('CNC Cylindrical Grinder','OD grinding, ±0.003mm. Typical: domestic or Kellenberger class.',                                                                       'SM-GRIND-CYL', 160, 22.1,'CNY', 'CN', 'China', 'grinding'),
  ('Injection Molding 100T','100T IM press. Common Haitian / Engel / Husky class.',                                                                                   'SM-IM-100T',   150, 20.7,'CNY', 'CN', 'China', 'injection_moulding'),
  ('Injection Molding 200T','200T IM press. Standard production tier.',                                                                                               'SM-IM-200T',   200, 27.6,'CNY', 'CN', 'China', 'injection_moulding'),
  ('Injection Molding 500T','500T IM press. Large parts / automotive.',                                                                                               'SM-IM-500T',   360, 49.7,'CNY', 'CN', 'China', 'injection_moulding'),
  ('CMM (Small)',       'CMM measurement, Zeiss or domestic. PPAP / FAI capability.',                                                                                 'SM-CMM-SM',    250, 34.5,'CNY', 'CN', 'China', 'quality'),
  ('Deburring Bench',   'Manual deburring station.',                                                                                                                  'SM-DEBURR',     60,  8.3,'CNY', 'CN', 'China', 'bench_manual'),

  -- ── Germany (EUR) ─────────────────────────────────────────────────────────
  ('CNC VMC 3-Axis',    '5-axis capable VMC in 3+2 mode. Typical: DMG MORI DMU 50 / Heidenhain TNC 640 control.',                                                   'SM-VMC-3AX',  150, 159.9, 'EUR', 'DE', 'Germany', 'cnc_milled'),
  ('CNC VMC 5-Axis',    'Simultaneous 5-axis. Typical: Hermle C 400 / DMG DMU 65 monoBLOCK.',                                                                        'SM-VMC-5AX',  250, 266.5, 'EUR', 'DE', 'Germany', 'cnc_milled'),
  ('CNC Lathe 2-Axis',  'CNC turning. Typical: DMG GILDEMEISTER CTX 310 class.',                                                                                     'SM-LATHE-2AX',120, 127.9, 'EUR', 'DE', 'Germany', 'cnc_turned'),
  ('Fiber Laser 6kW',   '6kW fiber laser. Typical: TRUMPF TruLaser 3030 / BYSTRONIC ByStar 3015.',                                                                   'SM-LASER-6KW', 125, 133.2,'EUR', 'DE', 'Germany', 'sheet_metal'),
  ('Press Brake 160T',  'CNC press brake. Typical: TRUMPF TruBend 5170 / SALVAGNINI P4.',                                                                            'SM-BRAKE-160T',100, 106.6,'EUR', 'DE', 'Germany', 'sheet_metal'),
  ('Wire EDM',          'Wire EDM. Typical: Sodick AG600L / Agie Charmilles FW3.',                                                                                   'SM-EDM-WIRE', 200, 213.2, 'EUR', 'DE', 'Germany', 'edm'),
  ('CNC Cylindrical Grinder','Grinding. Typical: Studer S31 / JUNKER JUMAT class.',                                                                                   'SM-GRIND-CYL', 130, 138.6,'EUR', 'DE', 'Germany', 'grinding'),
  ('Injection Molding 100T','100T IM. Typical: Engel e-mac 100 / ARBURG Allrounder 420.',                                                                             'SM-IM-100T',   100, 106.6,'EUR', 'DE', 'Germany', 'injection_moulding'),
  ('Injection Molding 200T','200T IM press.',                                                                                                                         'SM-IM-200T',   135, 143.9,'EUR', 'DE', 'Germany', 'injection_moulding'),
  ('Injection Molding 500T','500T IM press. Large structural.',                                                                                                       'SM-IM-500T',   200, 213.2,'EUR', 'DE', 'Germany', 'injection_moulding'),
  ('CMM (Small)',       'CMM measurement. Typical: Zeiss CONTURA / Hexagon Global S.',                                                                                'SM-CMM-SM',    140, 149.2,'EUR', 'DE', 'Germany', 'quality'),
  ('Deburring Bench',   'Manual deburring.',                                                                                                                          'SM-DEBURR',     45,  48.0,'EUR', 'DE', 'Germany', 'bench_manual'),

  -- ── France (EUR) ─────────────────────────────────────────────────────────
  ('CNC VMC 3-Axis',    '3-axis VMC. Typical: MAZAK VCN-700 / HURON KX 8 class.',                                                                                   'SM-VMC-3AX',  130, 138.6, 'EUR', 'FR', 'France', 'cnc_milled'),
  ('CNC VMC 5-Axis',    '5-axis VMC. Typical: HURON KX 15 / MIKRON HPM 600U class.',                                                                                'SM-VMC-5AX',  230, 245.2, 'EUR', 'FR', 'France', 'cnc_milled'),
  ('CNC Lathe 2-Axis',  'CNC lathe. Typical: MAZAK QT-NEXUS 350 class.',                                                                                            'SM-LATHE-2AX',105, 111.9, 'EUR', 'FR', 'France', 'cnc_turned'),
  ('Fiber Laser 6kW',   '6kW fiber laser. Typical: TRUMPF / BYSTRONIC.',                                                                                            'SM-LASER-6KW', 115, 122.6,'EUR', 'FR', 'France', 'sheet_metal'),
  ('Press Brake 160T',  'CNC press brake. Typical: PROMECAM / AMADA.',                                                                                              'SM-BRAKE-160T',90,  95.9, 'EUR', 'FR', 'France', 'sheet_metal'),
  ('Wire EDM',          'Wire EDM. Typical: Agie Charmilles.',                                                                                                       'SM-EDM-WIRE', 180, 191.9, 'EUR', 'FR', 'France', 'edm'),
  ('CNC Cylindrical Grinder','Grinding. Typical: Studer / ELB-SCHLIFF class.',                                                                                        'SM-GRIND-CYL', 115, 122.6,'EUR', 'FR', 'France', 'grinding'),
  ('Injection Molding 100T','100T IM. Typical: ENGEL / ARBURG class.',                                                                                               'SM-IM-100T',   90,  95.9, 'EUR', 'FR', 'France', 'injection_moulding'),
  ('Injection Molding 200T','200T IM press.',                                                                                                                        'SM-IM-200T',   125, 133.2,'EUR', 'FR', 'France', 'injection_moulding'),
  ('Injection Molding 500T','500T IM press.',                                                                                                                        'SM-IM-500T',   185, 197.2,'EUR', 'FR', 'France', 'injection_moulding'),
  ('CMM (Small)',       'CMM measurement. Typical: Zeiss / Hexagon class.',                                                                                          'SM-CMM-SM',    125, 133.2,'EUR', 'FR', 'France', 'quality'),
  ('Deburring Bench',   'Manual deburring.',                                                                                                                         'SM-DEBURR',     40,  42.6,'EUR', 'FR', 'France', 'bench_manual'),

  -- ── W. Europe (EUR) — composite NL/BE/AT/CH weighted average ─────────────
  ('CNC VMC 3-Axis',    '3-axis VMC. W. European composite rate (Netherlands, Belgium, Austria, Switzerland weighted by volume).',                                    'SM-VMC-3AX',  120, 127.9, 'EUR', 'XW', 'W. Europe', 'cnc_milled'),
  ('CNC VMC 5-Axis',    '5-axis VMC. W. European composite.',                                                                                                        'SM-VMC-5AX',  210, 223.9, 'EUR', 'XW', 'W. Europe', 'cnc_milled'),
  ('CNC Lathe 2-Axis',  'CNC lathe. W. European composite.',                                                                                                         'SM-LATHE-2AX',100, 106.6, 'EUR', 'XW', 'W. Europe', 'cnc_turned'),
  ('Fiber Laser 6kW',   '6kW fiber laser. W. European composite.',                                                                                                   'SM-LASER-6KW', 108, 115.1,'EUR', 'XW', 'W. Europe', 'sheet_metal'),
  ('Press Brake 160T',  'CNC press brake. W. European composite.',                                                                                                   'SM-BRAKE-160T',85,  90.6, 'EUR', 'XW', 'W. Europe', 'sheet_metal'),
  ('Wire EDM',          'Wire EDM. W. European composite.',                                                                                                           'SM-EDM-WIRE', 170, 181.2, 'EUR', 'XW', 'W. Europe', 'edm'),
  ('CNC Cylindrical Grinder','Grinding. W. European composite.',                                                                                                      'SM-GRIND-CYL', 105, 111.9,'EUR', 'XW', 'W. Europe', 'grinding'),
  ('Injection Molding 100T','100T IM press. W. European composite.',                                                                                                  'SM-IM-100T',   85,  90.6, 'EUR', 'XW', 'W. Europe', 'injection_moulding'),
  ('Injection Molding 200T','200T IM press. W. European composite.',                                                                                                  'SM-IM-200T',   115, 122.6,'EUR', 'XW', 'W. Europe', 'injection_moulding'),
  ('Injection Molding 500T','500T IM press. W. European composite.',                                                                                                  'SM-IM-500T',   170, 181.2,'EUR', 'XW', 'W. Europe', 'injection_moulding'),
  ('CMM (Small)',       'CMM measurement. W. European composite.',                                                                                                    'SM-CMM-SM',    115, 122.6,'EUR', 'XW', 'W. Europe', 'quality'),
  ('Deburring Bench',   'Manual deburring. W. European composite.',                                                                                                   'SM-DEBURR',     38,  40.5,'EUR', 'XW', 'W. Europe', 'bench_manual'),

  -- ── E. Europe (EUR) — composite PL/CZ/RO/HU ──────────────────────────────
  ('CNC VMC 3-Axis',    '3-axis VMC. E. European composite (Poland, Czech, Romania, Hungary weighted by CNC machine stock).',                                        'SM-VMC-3AX',   55,  58.6,  'EUR', 'XE', 'E. Europe', 'cnc_milled'),
  ('CNC VMC 5-Axis',    '5-axis VMC. E. European composite.',                                                                                                        'SM-VMC-5AX',  100, 106.6,  'EUR', 'XE', 'E. Europe', 'cnc_milled'),
  ('CNC Lathe 2-Axis',  'CNC lathe. E. European composite.',                                                                                                         'SM-LATHE-2AX', 45,  48.0,  'EUR', 'XE', 'E. Europe', 'cnc_turned'),
  ('Fiber Laser 6kW',   '6kW fiber laser. E. European composite.',                                                                                                   'SM-LASER-6KW',  47, 50.1,  'EUR', 'XE', 'E. Europe', 'sheet_metal'),
  ('Press Brake 160T',  'CNC press brake. E. European composite.',                                                                                                   'SM-BRAKE-160T', 35, 37.3,  'EUR', 'XE', 'E. Europe', 'sheet_metal'),
  ('Wire EDM',          'Wire EDM. E. European composite.',                                                                                                           'SM-EDM-WIRE',   75, 79.9,  'EUR', 'XE', 'E. Europe', 'edm'),
  ('CNC Cylindrical Grinder','Grinding. E. European composite.',                                                                                                      'SM-GRIND-CYL',  50, 53.3,  'EUR', 'XE', 'E. Europe', 'grinding'),
  ('Injection Molding 100T','100T IM press. E. European composite.',                                                                                                  'SM-IM-100T',    38, 40.5,  'EUR', 'XE', 'E. Europe', 'injection_moulding'),
  ('Injection Molding 200T','200T IM press. E. European composite.',                                                                                                  'SM-IM-200T',    52, 55.4,  'EUR', 'XE', 'E. Europe', 'injection_moulding'),
  ('Injection Molding 500T','500T IM press. E. European composite.',                                                                                                  'SM-IM-500T',    80, 85.3,  'EUR', 'XE', 'E. Europe', 'injection_moulding'),
  ('CMM (Small)',       'CMM measurement. E. European composite.',                                                                                                    'SM-CMM-SM',     60, 63.9,  'EUR', 'XE', 'E. Europe', 'quality'),
  ('Deburring Bench',   'Manual deburring. E. European composite.',                                                                                                   'SM-DEBURR',     15, 16.0,  'EUR', 'XE', 'E. Europe', 'bench_manual'),

  -- ── UK (GBP) ──────────────────────────────────────────────────────────────
  ('CNC VMC 3-Axis',    '3-axis VMC. UK rate. Typical: Mazak VCN-700 / Haas VF-4SS class.',                                                                         'SM-VMC-3AX',  105, 130.8, 'GBP', 'GB', 'UK', 'cnc_milled'),
  ('CNC VMC 5-Axis',    '5-axis VMC. UK rate.',                                                                                                                      'SM-VMC-5AX',  180, 224.3, 'GBP', 'GB', 'UK', 'cnc_milled'),
  ('CNC Lathe 2-Axis',  'CNC lathe. UK rate.',                                                                                                                       'SM-LATHE-2AX', 85, 105.9, 'GBP', 'GB', 'UK', 'cnc_turned'),
  ('Fiber Laser 6kW',   '6kW fiber laser. UK rate.',                                                                                                                 'SM-LASER-6KW', 100, 124.6,'GBP', 'GB', 'UK', 'sheet_metal'),
  ('Press Brake 160T',  'CNC press brake. UK rate.',                                                                                                                 'SM-BRAKE-160T', 75, 93.5, 'GBP', 'GB', 'UK', 'sheet_metal'),
  ('Wire EDM',          'Wire EDM. UK rate.',                                                                                                                         'SM-EDM-WIRE', 150, 186.9, 'GBP', 'GB', 'UK', 'edm'),
  ('CNC Cylindrical Grinder','Grinding. UK rate.',                                                                                                                    'SM-GRIND-CYL', 95, 118.4, 'GBP', 'GB', 'UK', 'grinding'),
  ('Injection Molding 100T','100T IM press. UK rate.',                                                                                                                'SM-IM-100T',   80, 99.7,  'GBP', 'GB', 'UK', 'injection_moulding'),
  ('Injection Molding 200T','200T IM press. UK rate.',                                                                                                                'SM-IM-200T',   100, 124.6,'GBP', 'GB', 'UK', 'injection_moulding'),
  ('Injection Molding 500T','500T IM press. UK rate.',                                                                                                                'SM-IM-500T',   150, 186.9,'GBP', 'GB', 'UK', 'injection_moulding'),
  ('CMM (Small)',       'CMM measurement. UK rate.',                                                                                                                  'SM-CMM-SM',    110, 137.1,'GBP', 'GB', 'UK', 'quality'),
  ('Deburring Bench',   'Manual deburring. UK rate.',                                                                                                                 'SM-DEBURR',     30, 37.4,  'GBP', 'GB', 'UK', 'bench_manual'),

  -- ── Vietnam (VND) — Ho Chi Minh / Hanoi industrial clusters ──────────────
  ('CNC VMC 3-Axis',    '3-axis VMC. Vietnam rate (HCMC/Hanoi industrial zone). Typical: MAZAK, HAAS, or local Taiwanese brands.',                                  'SM-VMC-3AX',  550000, 21.1,  'VND', 'VN', 'Vietnam', 'cnc_milled'),
  ('CNC VMC 5-Axis',    '5-axis VMC. Vietnam rate.',                                                                                                                 'SM-VMC-5AX',  1100000, 42.1, 'VND', 'VN', 'Vietnam', 'cnc_milled'),
  ('CNC Lathe 2-Axis',  'CNC lathe. Vietnam rate.',                                                                                                                  'SM-LATHE-2AX',420000, 16.1,  'VND', 'VN', 'Vietnam', 'cnc_turned'),
  ('Fiber Laser 6kW',   '6kW fiber laser. Vietnam rate.',                                                                                                            'SM-LASER-6KW', 380000, 14.6, 'VND', 'VN', 'Vietnam', 'sheet_metal'),
  ('Press Brake 160T',  'CNC press brake. Vietnam rate.',                                                                                                            'SM-BRAKE-160T',210000, 8.0,  'VND', 'VN', 'Vietnam', 'sheet_metal'),
  ('Wire EDM',          'Wire EDM. Vietnam rate.',                                                                                                                    'SM-EDM-WIRE', 700000, 26.8,  'VND', 'VN', 'Vietnam', 'edm'),
  ('CNC Cylindrical Grinder','Grinding. Vietnam rate.',                                                                                                               'SM-GRIND-CYL', 450000, 17.2, 'VND', 'VN', 'Vietnam', 'grinding'),
  ('Injection Molding 100T','100T IM press. Vietnam rate.',                                                                                                           'SM-IM-100T',   380000, 14.6,'VND', 'VN', 'Vietnam', 'injection_moulding'),
  ('Injection Molding 200T','200T IM press. Vietnam rate.',                                                                                                           'SM-IM-200T',   500000, 19.1,'VND', 'VN', 'Vietnam', 'injection_moulding'),
  ('Injection Molding 500T','500T IM press. Vietnam rate.',                                                                                                           'SM-IM-500T',   850000, 32.5,'VND', 'VN', 'Vietnam', 'injection_moulding'),
  ('CMM (Small)',       'CMM measurement. Vietnam rate.',                                                                                                             'SM-CMM-SM',    600000, 22.9,'VND', 'VN', 'Vietnam', 'quality'),
  ('Deburring Bench',   'Manual deburring. Vietnam rate.',                                                                                                            'SM-DEBURR',    140000, 5.4,  'VND', 'VN', 'Vietnam', 'bench_manual'),

  -- ── Mexico (MXN) — Monterrey / Bajío corridor ─────────────────────────────
  ('CNC VMC 3-Axis',    '3-axis VMC. Mexico rate (Monterrey/Guanajuato/Querétaro corridor). Typical: MAZAK, Haas, OKUMA class.',                                    'SM-VMC-3AX',  600,  34.3,  'MXN', 'MX', 'Mexico', 'cnc_milled'),
  ('CNC VMC 5-Axis',    '5-axis VMC. Mexico rate.',                                                                                                                  'SM-VMC-5AX',  1200, 68.5,  'MXN', 'MX', 'Mexico', 'cnc_milled'),
  ('CNC Lathe 2-Axis',  'CNC lathe. Mexico rate.',                                                                                                                   'SM-LATHE-2AX',480,  27.4,  'MXN', 'MX', 'Mexico', 'cnc_turned'),
  ('Fiber Laser 6kW',   '6kW fiber laser. Mexico rate.',                                                                                                             'SM-LASER-6KW', 460, 26.3,  'MXN', 'MX', 'Mexico', 'sheet_metal'),
  ('Press Brake 160T',  'CNC press brake. Mexico rate.',                                                                                                             'SM-BRAKE-160T',300, 17.1,  'MXN', 'MX', 'Mexico', 'sheet_metal'),
  ('Wire EDM',          'Wire EDM. Mexico rate.',                                                                                                                     'SM-EDM-WIRE', 800,  45.7,  'MXN', 'MX', 'Mexico', 'edm'),
  ('CNC Cylindrical Grinder','Grinding. Mexico rate.',                                                                                                                'SM-GRIND-CYL', 550, 31.4,  'MXN', 'MX', 'Mexico', 'grinding'),
  ('Injection Molding 100T','100T IM press. Mexico rate.',                                                                                                            'SM-IM-100T',   420, 24.0,  'MXN', 'MX', 'Mexico', 'injection_moulding'),
  ('Injection Molding 200T','200T IM press. Mexico rate.',                                                                                                            'SM-IM-200T',   550, 31.4,  'MXN', 'MX', 'Mexico', 'injection_moulding'),
  ('Injection Molding 500T','500T IM press. Mexico rate.',                                                                                                            'SM-IM-500T',   950, 54.3,  'MXN', 'MX', 'Mexico', 'injection_moulding'),
  ('CMM (Small)',       'CMM measurement. Mexico rate.',                                                                                                              'SM-CMM-SM',    680, 38.9,  'MXN', 'MX', 'Mexico', 'quality'),
  ('Deburring Bench',   'Manual deburring. Mexico rate.',                                                                                                             'SM-DEBURR',    180, 10.3,  'MXN', 'MX', 'Mexico', 'bench_manual')

) AS m(machine_name, machine_description, commodity_code,
        rate_local, rate_usd,
        currency_code, country_code, location, process_family)

WHERE NOT EXISTS (
  SELECT 1 FROM mhr_records r
  WHERE r.commodity_code  = m.commodity_code
    AND r.country_code    = m.country_code
    AND r.source_type     = 'BENCHMARK'
);
