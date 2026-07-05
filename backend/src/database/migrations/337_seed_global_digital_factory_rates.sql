-- Migration 337: Benchmark MHR rates for 6 Digital Factory locations.
--
-- ── Data Sources ──────────────────────────────────────────────────────────────
-- USA    : AMBA Benchmarking Survey 2024; CNCCookbook machine rate calculator;
--          Plastics Technology hourly rate survey (47 molders); BLS manufacturing
--          compensation data 2025; average industrial electricity $0.085/kWh (EIA)
-- India  : Validated against MHR_LHR_India_2026.json (production-confirmed: ₹3,000/hr
--          for 200T IMM = $35.9/hr @ 83.5 INR/USD, confirmed in live system Jul 2025);
--          CMIE manufacturing wage data; industrial electricity ₹7.5/kWh
-- China  : China-Briefing.com industrial cost guide 2025; Haizol CNC machining cost
--          benchmarks; average industrial electricity ¥0.64/kWh (NDRC 2025)
-- Mexico : Tetakawi Manufacturing Benchmark Guide 2025–2026; American Industries Group
--          fully-burdened cost data; CONASAMI minimum wage 278.80 MXN/day (Jan 2025).
--          RATE BASIS: Monterrey / Nuevo León industrial-zone cluster benchmark.
--          City-level variation is significant ($2.50–$7.27/hr operator fully burdened
--          across Monterrey/Tijuana/CDMX); these rows are COUNTRY BENCHMARK tier, not
--          plant-specific. Adjust per Digital Factory city before using for final quotes.
--          Electricity: MXN 1.35/kWh (CFE industrial T-2 tariff, Monterrey zone, 2025)
-- Germany: VDW/VDMA cost structure surveys; German Federal Statistical Office labor cost
--          tables. ELECTRICITY NOTE — Germany has two distinct industrial tariffs:
--          (a) General industry (non-intensive): ~€0.20/kWh (Eurostat H2-2024 avg
--              €0.1837/kWh, rising to ~€0.30/kWh incl. all levies and network charges)
--          (b) Energy-intensive firms (§ 9c EnWG exemption): ~€0.10/kWh (10.04 ct/kWh
--              new Strompreispaket rate effective Jan 2026 per Gleiss Lutz 2025)
--          Rows use €0.20/kWh (assumption: general SME machine shop, non-intensive).
--          The MHR delta between €0.166 and €0.20 is ≤€0.82/hr on a 24 kW machine
--          and is already absorbed into the benchmark MHR figure; elec_kwh is reference.
-- Vietnam: Vietnam Supply Chain Insider manufacturing cost data 2025; terra-plat.vn
--          wage benchmarks; Talentnet compensation survey; electricity $0.085/kWh
--
-- ── Exchange Rates (July 2025 mid-market) ────────────────────────────────────
-- 1 USD = 83.5 INR | 7.25 CNY | 17.2 MXN | 0.917 EUR | 25,400 VND
-- Rates are stored in LOCAL CURRENCY to match LOCATION_MHR_DEFAULTS convention.
-- USA and Vietnam use USD directly (USD is the quoting currency in those markets).
-- The cost engine converts to USD via the location FX rate for display and comparison.
--
-- ── Rate Classification ───────────────────────────────────────────────────────
-- Each location row is labelled by confidence tier:
--   PRODUCTION-VALIDATED : live system confirmed value (India 200T IMM ₹3,000/hr)
--   COUNTRY BENCHMARK    : credible survey average; ±15–25% real plant variation
--   CITY/CLUSTER BENCHMARK: Monterrey (Mexico) — more reliable than national avg
-- Do NOT use COUNTRY BENCHMARK rows as final quote inputs without a site-level
-- sanity check. They set the digital-factory baseline for route comparison and
-- should be overridden per factory once actual MHR data is available.
--
-- ── Scope ─────────────────────────────────────────────────────────────────────
-- 14 machine classes × 6 locations = 84 rows.
-- Injection molding (IM-SMALL / IM-MED / IM-LARGE) and sheet metal / CNC / QA.
-- max_tonnage, max_x_mm/y/z, max_diameter_mm and max_length_mm filled for the
-- clamp-tonnage and envelope capability gates in the machine selector.
-- manual_mhr_value overrides all calculated rates (top priority in pickRate()).
--
-- ── Idempotent ────────────────────────────────────────────────────────────────
-- Guarded by NOT EXISTS on (user_id, location, machine_name).
-- Re-running is a safe no-op; existing overridden rates are not touched.

DO $$
DECLARE
  uid uuid;
BEGIN
  SELECT id INTO uid
  FROM auth.users
  WHERE email = 'abushan.isro@gmail.com'
  LIMIT 1;

  IF uid IS NULL THEN
    RAISE EXCEPTION 'User not found: abushan.isro@gmail.com — update the email and re-run.';
  END IF;

  -- ── Common INSERT helper ────────────────────────────────────────────────────
  -- Columns: (user_id already resolved into uid above)
  --   location, commodity_code, machine_name, machine_class, process_group,
  --   landed_machine_cost (USD for all — reference only, rate driven by manual_mhr_value),
  --   manual_mhr_value (LOCAL CURRENCY), fully_burdened_local_per_hr, total_machine_hour_rate,
  --   capacity_utilization_rate,
  --   max_tonnage, max_x_mm, max_y_mm, max_z_mm, max_diameter_mm, max_length_mm,
  --   capability_source, availability_status,
  --   shifts_per_day, hours_per_shift, working_days_per_year,
  --   planned_maintenance_hours_per_year, accessories_cost_percentage,
  --   installation_cost_percentage, payback_period_years, interest_rate_percentage,
  --   insurance_rate_percentage, machine_footprint_sqm, rent_per_sqm_per_month,
  --   maintenance_cost_percentage, power_kwh_per_hour, electricity_cost_per_kwh,
  --   admin_overhead_percentage, profit_margin_percentage

  INSERT INTO mhr_records (
    user_id, location, commodity_code, machine_name, machine_class, process_group,
    landed_machine_cost, manual_mhr_value, fully_burdened_local_per_hr, total_machine_hour_rate,
    capacity_utilization_rate,
    max_tonnage, max_x_mm, max_y_mm, max_z_mm, max_diameter_mm, max_length_mm,
    capability_source, availability_status,
    shifts_per_day, hours_per_shift, working_days_per_year, planned_maintenance_hours_per_year,
    accessories_cost_percentage, installation_cost_percentage, payback_period_years,
    interest_rate_percentage, insurance_rate_percentage, machine_footprint_sqm,
    rent_per_sqm_per_month, maintenance_cost_percentage, power_kwh_per_hour,
    electricity_cost_per_kwh, admin_overhead_percentage, profit_margin_percentage
  )
  SELECT
    uid,
    v.location, v.commodity_code, v.machine_name, v.machine_class, v.process_group,
    v.landed_usd, v.local_mhr, v.local_mhr, v.local_mhr,
    85,
    v.max_ton, v.max_x, v.max_y, v.max_z, v.max_dia, v.max_len,
    'benchmark', 'available',
    3, 8, 260, 0,
    6, 20, 10, 8, 1, 0, 0, 6,
    v.power_kw, v.elec_kwh, 0, 0
  FROM (VALUES

    -- ══════════════════════════════════════════════════════════════════════════
    -- USA — rates in USD/hr
    -- Source: AMBA survey (molding); CNCCookbook (machining); BLS 2025 (labor)
    -- Electricity: $0.085/kWh (EIA industrial average 2025)
    -- ══════════════════════════════════════════════════════════════════════════
    -- location | commodity_code | machine_name | machine_class | process_group
    -- | landed_usd | local_mhr | max_ton | max_x | max_y | max_z | max_dia | max_len | power_kw | elec_kwh
    ('USA','IM-SMALL',  'Injection Molder 50T (500kN)',      'injection_molding','Injection Molding',  35000,  45, 50,  NULL, NULL, NULL, NULL, NULL, 7,   0.085),
    ('USA','IM-SMALL',  'Injection Molder 100T (1000kN)',    'injection_molding','Injection Molding',  65000,  65, 100, NULL, NULL, NULL, NULL, NULL, 13,  0.085),
    ('USA','IM-MED',    'Injection Molder 200T (2000kN)',    'injection_molding','Injection Molding', 120000,  85, 200, NULL, NULL, NULL, NULL, NULL, 24,  0.085),
    ('USA','IM-MED',    'Injection Molder 500T (5000kN)',    'injection_molding','Injection Molding', 260000, 120, 500, NULL, NULL, NULL, NULL, NULL, 52,  0.085),
    ('USA','IM-LARGE',  'Injection Molder 1000T (10000kN)',  'injection_molding','Injection Molding', 520000, 180,1000, NULL, NULL, NULL, NULL, NULL,105,  0.085),
    ('USA','CNC-VMC-3AX','VMC 3-Axis (762×406×508mm)',       'cnc_3ax_vmc',      'CNC Machining',      75000,  85, NULL, 762, 406, 508, NULL, NULL, 18,  0.085),
    ('USA','CNC-VMC-4AX','VMC 4-Axis (650×500×500mm)',       'cnc_4ax_vmc',      'CNC Machining',     120000, 105, NULL, 650, 500, 500, NULL, NULL, 22,  0.085),
    ('USA','CNC-MC-5AX', 'Machining Center 5-Axis',          'cnc_5ax_mc',       'CNC Machining',     250000, 145, NULL, 500, 500, 400, NULL, NULL, 35,  0.085),
    ('USA','CNC-LATHE-2AX','CNC Lathe (Ø356×533mm)',         'cnc_lathe',        'Turning',            60000,  70, NULL, NULL,NULL,NULL,  356,  533, 15,  0.085),
    ('USA','SM-LASER-4K',  'Fiber Laser 4kW (3000×1500mm)',  'fiber_laser',      'Sheet Metal',        85000,  95, NULL,3000,1500,NULL, NULL, NULL, 38,  0.085),
    ('USA','SM-BRAKE-80T', 'Press Brake 80T (2500mm)',       'press_brake',      'Sheet Metal',        55000,  60,  80, NULL,NULL,NULL, NULL, 2500, 15,  0.085),
    ('USA','SM-PUNCH-CNC', 'CNC Turret Punch',               'turret_punch',     'Sheet Metal',        65000,  85,  20, 2500,1250,NULL, NULL, NULL, 22,  0.085),
    ('USA','QA-CMM',       'CMM (X1500×Y1000×Z1000)',        'cmm',              'Inspection',         80000,  55, NULL,1500,1000,1000, NULL, NULL,  3,  0.085),
    ('USA','BENCH-DEBURR', 'Manual Inspection Bench',        'deburring',        'Inspection',          5000,  35, NULL, NULL,NULL,NULL, NULL, NULL,  0.5, 0.085),

    -- ══════════════════════════════════════════════════════════════════════════
    -- INDIA — rates in INR/hr  (1 USD = 83.5 INR)
    -- USD equivalent in parentheses for reference only.
    -- Source: MHR_LHR_India_2026.json (production-validated); CMIE wage data;
    --         ₹3,000/hr for 200T IMM confirmed in live system (Jul 2025 = $35.9/hr)
    -- Electricity: ₹7.50/kWh (CERC industrial tariff 2024–25, T&D charges incl.)
    -- ══════════════════════════════════════════════════════════════════════════
    -- local_mhr in INR; USD equiv: divide by 83.5
    ('India','IM-SMALL',  'Injection Molder 50T (500kN)',     'injection_molding','Injection Molding',  12000, 1250,  50, NULL,NULL,NULL,NULL,NULL,  7, 7.50),  -- ~$15/hr
    ('India','IM-SMALL',  'Injection Molder 100T (1000kN)',   'injection_molding','Injection Molding',  25000, 2100, 100, NULL,NULL,NULL,NULL,NULL, 13, 7.50),  -- ~$25/hr
    ('India','IM-MED',    'Injection Molder 200T (2000kN)',   'injection_molding','Injection Molding',  50000, 3000, 200, NULL,NULL,NULL,NULL,NULL, 24, 7.50),  -- $35.9/hr (production-confirmed)
    ('India','IM-MED',    'Injection Molder 500T (5000kN)',   'injection_molding','Injection Molding', 100000, 5200, 500, NULL,NULL,NULL,NULL,NULL, 52, 7.50),  -- ~$62/hr
    ('India','IM-LARGE',  'Injection Molder 1000T (10000kN)','injection_molding','Injection Molding', 200000, 8800,1000, NULL,NULL,NULL,NULL,NULL,105, 7.50),  -- ~$105/hr
    ('India','CNC-VMC-3AX','VMC 3-Axis (600×400×400mm)',      'cnc_3ax_vmc',     'CNC Machining',      30000, 1050, NULL, 600,400,400,NULL,NULL, 18, 7.50),  -- ~$13/hr
    ('India','CNC-VMC-4AX','VMC 4-Axis (500×400×400mm)',      'cnc_4ax_vmc',     'CNC Machining',      48000, 1575, NULL, 500,400,400,NULL,NULL, 22, 7.50),  -- ~$19/hr
    ('India','CNC-MC-5AX', 'Machining Center 5-Axis',         'cnc_5ax_mc',      'CNC Machining',      96000, 2625, NULL, 500,400,350,NULL,NULL, 35, 7.50),  -- ~$31/hr
    ('India','CNC-LATHE-2AX','CNC Lathe (Ø300×500mm)',        'cnc_lathe',       'Turning',            18000,  840, NULL,NULL,NULL,NULL, 300, 500, 15, 7.50),  -- ~$10/hr
    ('India','SM-LASER-4K',  'Fiber Laser 4kW (3000×1500mm)','fiber_laser',      'Sheet Metal',        36000, 1260, NULL,3000,1500,NULL,NULL,NULL, 38, 7.50),  -- ~$15/hr
    ('India','SM-BRAKE-80T', 'Press Brake 80T (2500mm)',      'press_brake',      'Sheet Metal',        18000,  735,  80,NULL,NULL,NULL,NULL,2500, 15, 7.50),  -- ~$9/hr
    ('India','SM-PUNCH-CNC', 'CNC Turret Punch',              'turret_punch',     'Sheet Metal',        22000,  920,  20,2500,1250,NULL,NULL,NULL, 22, 7.50),  -- ~$11/hr
    ('India','QA-CMM',       'CMM (X1000×Y750×Z650mm)',       'cmm',              'Inspection',         30000,  630, NULL,1000, 750, 650,NULL,NULL,  3, 7.50),  -- ~$8/hr
    ('India','BENCH-DEBURR', 'Manual Inspection Bench',       'deburring',        'Inspection',          3000,  375, NULL,NULL,NULL,NULL,NULL,NULL,  0.5,7.50),  -- ~$4/hr

    -- ══════════════════════════════════════════════════════════════════════════
    -- CHINA — rates in CNY/hr  (1 USD = 7.25 CNY)
    -- Source: China-Briefing.com industrial cost guide 2025; Haizol CNC benchmarks
    -- Labor: factory worker ~¥25–35/hr (2025); skilled CNC ~¥50–80/hr
    -- Electricity: ¥0.64/kWh (NDRC industrial tariff; Guangdong/Jiangsu average 2025)
    -- ══════════════════════════════════════════════════════════════════════════
    -- local_mhr in CNY; USD equiv: divide by 7.25
    ('China','IM-SMALL',  'Injection Molder 50T (500kN)',     'injection_molding','Injection Molding',   8000,  140,  50,NULL,NULL,NULL,NULL,NULL,  7, 0.64),  -- ~$19/hr
    ('China','IM-SMALL',  'Injection Molder 100T (1000kN)',   'injection_molding','Injection Molding',  18000,  220, 100,NULL,NULL,NULL,NULL,NULL, 13, 0.64),  -- ~$30/hr
    ('China','IM-MED',    'Injection Molder 200T (2000kN)',   'injection_molding','Injection Molding',  34000,  325, 200,NULL,NULL,NULL,NULL,NULL, 24, 0.64),  -- ~$45/hr
    ('China','IM-MED',    'Injection Molder 500T (5000kN)',   'injection_molding','Injection Molding',  70000,  510, 500,NULL,NULL,NULL,NULL,NULL, 52, 0.64),  -- ~$70/hr
    ('China','IM-LARGE',  'Injection Molder 1000T (10000kN)','injection_molding','Injection Molding', 135000,  800,1000,NULL,NULL,NULL,NULL,NULL,105, 0.64),  -- ~$110/hr
    ('China','CNC-VMC-3AX','VMC 3-Axis (600×400×400mm)',      'cnc_3ax_vmc',     'CNC Machining',      20000,  225, NULL, 600,400,400,NULL,NULL, 18, 0.64),  -- ~$31/hr
    ('China','CNC-VMC-4AX','VMC 4-Axis (500×400×400mm)',      'cnc_4ax_vmc',     'CNC Machining',      30000,  310, NULL, 500,400,400,NULL,NULL, 22, 0.64),  -- ~$43/hr
    ('China','CNC-MC-5AX', 'Machining Center 5-Axis',         'cnc_5ax_mc',      'CNC Machining',      59000,  470, NULL, 500,400,350,NULL,NULL, 35, 0.64),  -- ~$65/hr
    ('China','CNC-LATHE-2AX','CNC Lathe (Ø300×500mm)',        'cnc_lathe',       'Turning',            15000,  180, NULL,NULL,NULL,NULL, 300, 500, 15, 0.64),  -- ~$25/hr
    ('China','SM-LASER-4K',  'Fiber Laser 4kW (3000×1500mm)','fiber_laser',      'Sheet Metal',        22000,  215, NULL,3000,1500,NULL,NULL,NULL, 38, 0.64),  -- ~$30/hr
    ('China','SM-BRAKE-80T', 'Press Brake 80T (2500mm)',      'press_brake',      'Sheet Metal',        14000,  145,  80,NULL,NULL,NULL,NULL,2500, 15, 0.64),  -- ~$20/hr
    ('China','SM-PUNCH-CNC', 'CNC Turret Punch',              'turret_punch',     'Sheet Metal',        18000,  185,  20,2500,1250,NULL,NULL,NULL, 22, 0.64),  -- ~$26/hr
    ('China','QA-CMM',       'CMM (X1000×Y750×Z650mm)',       'cmm',              'Inspection',         20000,  120, NULL,1000, 750, 650,NULL,NULL,  3, 0.64),  -- ~$17/hr
    ('China','BENCH-DEBURR', 'Manual Inspection Bench',       'deburring',        'Inspection',          2000,   80, NULL,NULL,NULL,NULL,NULL,NULL,  0.5,0.64),  -- ~$11/hr

    -- ══════════════════════════════════════════════════════════════════════════
    -- MEXICO — rates in MXN/hr  (1 USD = 17.2 MXN)
    -- Source: Tetakawi Manufacturing Benchmark Guide 2025–2026;
    --         American Industries Group fully-burdened cost data;
    --         CONASAMI minimum wage 278.80 MXN/day (Jan 2025, +12% YoY)
    -- Labor: fully-burdened operator MXN 45–80/hr; skilled CNC MXN 140–230/hr
    -- Electricity: MXN 1.35/kWh (CFE industrial T-2 tariff average 2025)
    -- ══════════════════════════════════════════════════════════════════════════
    -- local_mhr in MXN; USD equiv: divide by 17.2
    ('Mexico','IM-SMALL',  'Injection Molder 50T (500kN)',     'injection_molding','Injection Molding',  35000,  345,  50,NULL,NULL,NULL,NULL,NULL,  7, 1.35),  -- ~$20/hr
    ('Mexico','IM-SMALL',  'Injection Molder 100T (1000kN)',   'injection_molding','Injection Molding',  60000,  485, 100,NULL,NULL,NULL,NULL,NULL, 13, 1.35),  -- ~$28/hr
    ('Mexico','IM-MED',    'Injection Molder 200T (2000kN)',   'injection_molding','Injection Molding', 110000,  720, 200,NULL,NULL,NULL,NULL,NULL, 24, 1.35),  -- ~$42/hr
    ('Mexico','IM-MED',    'Injection Molder 500T (5000kN)',   'injection_molding','Injection Molding', 220000, 1120, 500,NULL,NULL,NULL,NULL,NULL, 52, 1.35),  -- ~$65/hr
    ('Mexico','IM-LARGE',  'Injection Molder 1000T (10000kN)','injection_molding','Injection Molding', 430000, 1635,1000,NULL,NULL,NULL,NULL,NULL,105, 1.35),  -- ~$95/hr
    ('Mexico','CNC-VMC-3AX','VMC 3-Axis (600×400×400mm)',      'cnc_3ax_vmc',     'CNC Machining',      70000,  690, NULL, 600,400,400,NULL,NULL, 18, 1.35),  -- ~$40/hr
    ('Mexico','CNC-VMC-4AX','VMC 4-Axis (500×400×400mm)',      'cnc_4ax_vmc',     'CNC Machining',     110000,  860, NULL, 500,400,400,NULL,NULL, 22, 1.35),  -- ~$50/hr
    ('Mexico','CNC-MC-5AX', 'Machining Center 5-Axis',         'cnc_5ax_mc',      'CNC Machining',     230000, 1204, NULL, 500,400,350,NULL,NULL, 35, 1.35),  -- ~$70/hr
    ('Mexico','CNC-LATHE-2AX','CNC Lathe (Ø300×500mm)',        'cnc_lathe',       'Turning',            55000,  550, NULL,NULL,NULL,NULL, 300, 500, 15, 1.35),  -- ~$32/hr
    ('Mexico','SM-LASER-4K',  'Fiber Laser 4kW (3000×1500mm)','fiber_laser',      'Sheet Metal',        80000,  688, NULL,3000,1500,NULL,NULL,NULL, 38, 1.35),  -- ~$40/hr
    ('Mexico','SM-BRAKE-80T', 'Press Brake 80T (2500mm)',      'press_brake',      'Sheet Metal',        53000,  480,  80,NULL,NULL,NULL,NULL,2500, 15, 1.35),  -- ~$28/hr
    ('Mexico','SM-PUNCH-CNC', 'CNC Turret Punch',              'turret_punch',     'Sheet Metal',        60000,  600,  20,2500,1250,NULL,NULL,NULL, 22, 1.35),  -- ~$35/hr
    ('Mexico','QA-CMM',       'CMM (X1000×Y750×Z650mm)',       'cmm',              'Inspection',         75000,  378, NULL,1000, 750, 650,NULL,NULL,  3, 1.35),  -- ~$22/hr
    ('Mexico','BENCH-DEBURR', 'Manual Inspection Bench',       'deburring',        'Inspection',          4500,  240, NULL,NULL,NULL,NULL,NULL,NULL,  0.5,1.35),  -- ~$14/hr

    -- ══════════════════════════════════════════════════════════════════════════
    -- GERMANY — rates in EUR/hr  (1 USD = 0.917 EUR → 1 EUR = $1.09)
    -- Source: VDW (machine tool) and VDMA (plant engineering) cost surveys;
    --         German Federal Statistical Office hourly compensation data 2025;
    --         Bundesnetzagentur industrial electricity Sep 2025: €0.100/kWh avg;
    --         general industry (non-energy-intensive) ~€0.166/kWh incl. levies
    -- Labor: manufacturing operator ~€32–40/hr fully burdened (incl. social charges)
    -- ══════════════════════════════════════════════════════════════════════════
    -- local_mhr in EUR; USD equiv: multiply by 1.09
    ('Germany','IM-SMALL',  'Injection Molder 50T (500kN)',     'injection_molding','Injection Molding',  42000,   42,  50,NULL,NULL,NULL,NULL,NULL,  7, 0.200),  -- ~$46/hr
    ('Germany','IM-SMALL',  'Injection Molder 100T (1000kN)',   'injection_molding','Injection Molding',  75000,   58, 100,NULL,NULL,NULL,NULL,NULL, 13, 0.200),  -- ~$63/hr
    ('Germany','IM-MED',    'Injection Molder 200T (2000kN)',   'injection_molding','Injection Molding', 145000,   88, 200,NULL,NULL,NULL,NULL,NULL, 24, 0.200),  -- ~$96/hr
    ('Germany','IM-MED',    'Injection Molder 500T (5000kN)',   'injection_molding','Injection Molding', 300000,  128, 500,NULL,NULL,NULL,NULL,NULL, 52, 0.200),  -- ~$139/hr
    ('Germany','IM-LARGE',  'Injection Molder 1000T (10000kN)','injection_molding','Injection Molding', 600000,  188,1000,NULL,NULL,NULL,NULL,NULL,105, 0.200),  -- ~$205/hr
    ('Germany','CNC-VMC-3AX','VMC 3-Axis (630×500×450mm)',      'cnc_3ax_vmc',     'CNC Machining',     110000,   78, NULL, 630,500,450,NULL,NULL, 18, 0.200),  -- ~$85/hr
    ('Germany','CNC-VMC-4AX','VMC 4-Axis (600×500×450mm)',      'cnc_4ax_vmc',     'CNC Machining',     170000,   97, NULL, 600,500,450,NULL,NULL, 22, 0.200),  -- ~$106/hr
    ('Germany','CNC-MC-5AX', 'Machining Center 5-Axis',         'cnc_5ax_mc',      'CNC Machining',     350000,  142, NULL, 500,450,400,NULL,NULL, 35, 0.200),  -- ~$155/hr
    ('Germany','CNC-LATHE-2AX','CNC Lathe (Ø350×500mm)',        'cnc_lathe',       'Turning',            85000,   68, NULL,NULL,NULL,NULL, 350, 500, 15, 0.200),  -- ~$74/hr
    ('Germany','SM-LASER-4K',  'Fiber Laser 4kW (3000×1500mm)','fiber_laser',      'Sheet Metal',       120000,   88, NULL,3000,1500,NULL,NULL,NULL, 38, 0.200),  -- ~$96/hr
    ('Germany','SM-BRAKE-80T', 'Press Brake 80T (2500mm)',      'press_brake',      'Sheet Metal',        70000,   58,  80,NULL,NULL,NULL,NULL,2500, 15, 0.200),  -- ~$63/hr
    ('Germany','SM-PUNCH-CNC', 'CNC Turret Punch',              'turret_punch',     'Sheet Metal',        80000,   72,  20,2500,1250,NULL,NULL,NULL, 22, 0.200),  -- ~$78/hr
    ('Germany','QA-CMM',       'CMM (X1500×Y1000×Z1000)',       'cmm',              'Inspection',        110000,   55, NULL,1500,1000,1000,NULL,NULL,  3, 0.200),  -- ~$60/hr
    ('Germany','BENCH-DEBURR', 'Manual Inspection Bench',       'deburring',        'Inspection',          6000,   40, NULL,NULL,NULL,NULL,NULL,NULL,  0.5,0.166),  -- ~$44/hr

    -- ══════════════════════════════════════════════════════════════════════════
    -- VIETNAM — rates in USD/hr (USD is the standard quoting currency for
    --           Vietnam export manufacturing; stored in USD to avoid VND rounding)
    -- Source: Vietnam Supply Chain Insider manufacturing cost data 2025;
    --         terra-plat.vn factory worker salary Q1 2025 (VND 7.7–8.4M/month);
    --         Talentnet Vietnam compensation survey 2025
    -- Labor: operator fully-burdened $1.85–2.50/hr; skilled CNC $3.00–4.50/hr
    -- Electricity: $0.085/kWh (EVN industrial tariff ~VND 2,160/kWh ÷ 25,400)
    -- ══════════════════════════════════════════════════════════════════════════
    ('Vietnam','IM-SMALL',  'Injection Molder 50T (500kN)',     'injection_molding','Injection Molding',  12000,  10,  50,NULL,NULL,NULL,NULL,NULL,  7, 0.085),
    ('Vietnam','IM-SMALL',  'Injection Molder 100T (1000kN)',   'injection_molding','Injection Molding',  22000,  15, 100,NULL,NULL,NULL,NULL,NULL, 13, 0.085),
    ('Vietnam','IM-MED',    'Injection Molder 200T (2000kN)',   'injection_molding','Injection Molding',  45000,  22, 200,NULL,NULL,NULL,NULL,NULL, 24, 0.085),
    ('Vietnam','IM-MED',    'Injection Molder 500T (5000kN)',   'injection_molding','Injection Molding',  90000,  35, 500,NULL,NULL,NULL,NULL,NULL, 52, 0.085),
    ('Vietnam','IM-LARGE',  'Injection Molder 1000T (10000kN)','injection_molding','Injection Molding', 180000,  52,1000,NULL,NULL,NULL,NULL,NULL,105, 0.085),
    ('Vietnam','CNC-VMC-3AX','VMC 3-Axis (600×400×400mm)',      'cnc_3ax_vmc',     'CNC Machining',      30000,  18, NULL, 600,400,400,NULL,NULL, 18, 0.085),
    ('Vietnam','CNC-VMC-4AX','VMC 4-Axis (500×400×400mm)',      'cnc_4ax_vmc',     'CNC Machining',      45000,  24, NULL, 500,400,400,NULL,NULL, 22, 0.085),
    ('Vietnam','CNC-MC-5AX', 'Machining Center 5-Axis',         'cnc_5ax_mc',      'CNC Machining',      95000,  32, NULL, 500,400,350,NULL,NULL, 35, 0.085),
    ('Vietnam','CNC-LATHE-2AX','CNC Lathe (Ø280×450mm)',        'cnc_lathe',       'Turning',            20000,  15, NULL,NULL,NULL,NULL, 280, 450, 15, 0.085),
    ('Vietnam','SM-LASER-4K',  'Fiber Laser 4kW (3000×1500mm)','fiber_laser',      'Sheet Metal',        35000,  20, NULL,3000,1500,NULL,NULL,NULL, 38, 0.085),
    ('Vietnam','SM-BRAKE-80T', 'Press Brake 80T (2500mm)',      'press_brake',      'Sheet Metal',        28000,  14,  80,NULL,NULL,NULL,NULL,2500, 15, 0.085),
    ('Vietnam','SM-PUNCH-CNC', 'CNC Turret Punch',              'turret_punch',     'Sheet Metal',        32000,  18,  20,2500,1250,NULL,NULL,NULL, 22, 0.085),
    ('Vietnam','QA-CMM',       'CMM (X1000×Y750×Z650mm)',       'cmm',              'Inspection',         40000,  12, NULL,1000, 750, 650,NULL,NULL,  3, 0.085),
    ('Vietnam','BENCH-DEBURR', 'Manual Inspection Bench',       'deburring',        'Inspection',          2500,   7, NULL,NULL,NULL,NULL,NULL,NULL,  0.5,0.085)

  ) AS v(
    location, commodity_code, machine_name, machine_class, process_group,
    landed_usd, local_mhr,
    max_ton, max_x, max_y, max_z, max_dia, max_len,
    power_kw, elec_kwh
  )
  WHERE NOT EXISTS (
    SELECT 1 FROM mhr_records mr
    WHERE mr.user_id = uid
      AND mr.location = v.location
      AND mr.machine_name = v.machine_name
  );

  RAISE NOTICE 'Migration 337 complete: % rows inserted.',
    (SELECT count(*) FROM mhr_records WHERE user_id = uid AND capability_source = 'benchmark');

END $$;


-- ── Quick verification query ───────────────────────────────────────────────────
-- Run this after the migration to confirm counts and spot-check rates.
/*
SELECT
  location,
  count(*) AS machines,
  round(avg(manual_mhr_value), 0) AS avg_local_mhr,
  round(min(manual_mhr_value), 0) AS min_local_mhr,
  round(max(manual_mhr_value), 0) AS max_local_mhr
FROM mhr_records
WHERE capability_source = 'benchmark'
GROUP BY location
ORDER BY location;

-- Expected (local currency / local rates):
-- Germany :  14 rows | avg ~87  EUR/hr (=$95  USD)
-- India   :  14 rows | avg ~1920 INR/hr (=$23  USD)
-- China   :  14 rows | avg ~265 CNY/hr (=$37  USD)
-- Mexico  :  14 rows | avg ~690 MXN/hr (=$40  USD)
-- USA     :  14 rows | avg ~82  USD/hr
-- Vietnam :  14 rows | avg ~21  USD/hr
*/


-- ── LHR reference rates (run in lsr_records after confirming schema) ──────────
-- Labour Standard Rates to pair with the machine rates above.
-- These are unskilled/semi-skilled OPERATOR rates (not machine rates).
-- Rates in local currency per hour, fully burdened (base + statutory benefits).
--
-- USA     : $32/hr  operator | $42/hr CNC operator | $55/hr process engineer
-- India   : ₹250/hr operator | ₹350/hr CNC operator | ₹550/hr engineer  (=$3–7/hr)
-- China   : ¥28/hr  operator | ¥45/hr  CNC operator | ¥90/hr  engineer  (=$4–12/hr)
-- Mexico  : MXN 70/hr operator | MXN 145/hr CNC | MXN 230/hr engineer   (=$4–13/hr)
-- Germany : €32/hr  operator | €50/hr  CNC operator | €72/hr  engineer   (=$35–79/hr)
-- Vietnam : $2.20/hr operator | $3.50/hr CNC operator | $5.50/hr engineer
--
-- Sources:
-- USA:     BLS Occupational Employment Statistics (May 2025); Ziprecruiter CNC salary
-- India:   SalaryExpert IM operator ₹172/hr base → ~₹250/hr fully burdened;
--          CNC operator ₹272/hr base → ~₹350/hr burdened (30% statutory benefits)
-- China:   Haizol; China-Briefing labor cost guide 2025 ($3.50–8/hr range)
-- Mexico:  Tetakawi fully-burdened: operator $4.00/hr = MXN 68.8/hr;
--          CNC machinist $12/hr = MXN 206/hr (fully burdened incl. IMSS/INFONAVIT)
-- Germany: German Federal Statistical Office; VDW survey (€35–55/hr total comp)
-- Vietnam: terra-plat.vn VND 32,000–50,000/hr ≈ $1.25–$1.95 base; ~2× burdened
