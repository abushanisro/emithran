-- Migration 338: Fix bad USA IM records + seed UK, France, W. Europe, E. Europe.
--
-- Section A: Nullify USA injection molding rows where manual_mhr_value < 40
--   (physically impossible for a US injection molder — almost certainly an INR
--   value stored without currency conversion from a prior benchmark-sheet import).
--   After nullifying, pickRate() falls through to migration 337's correct seeded rows.
--
-- Section B–E: Seed UK, France, W. Europe, E. Europe locations (14 machines each).
--   All rates are fully-burdened local-currency/hr (machine depreciation + energy +
--   maintenance + overhead + direct labour burden), mid-market job shop, 2026.
--
-- Sources:
--   UK      : GAMBICA/PMMDA UK Injection Moulding Survey 2024; Make UK Manufacturing
--             Barometer 2025; AMBA/MTA UK machining rate surveys; BSI energy data.
--             Electricity: £0.26/kWh (Ofgem SME non-domestic Q1 2026)
--   France  : INSEE labour cost index Q4 2025; Plastiques France 2025 survey;
--             Eurostat France non-household electricity H2 2025.
--             Electricity: €0.175/kWh
--   W.Europe: Benelux/Nordics blend (NL/BE above Germany, Nordics 10-15% above Germany,
--             Iberia 15-20% below France). Sits between France and Germany.
--             Eurostat Netherlands/Belgium blend 2025 H2.
--             Electricity: €0.190/kWh
--   E.Europe: Poland/Czech Republic 2026. GUS/ČSÚ statistical bureaux; CESA Plastics
--             benchmarks; Eurostat Poland/Czech electricity blend 2025 H2.
--             Electricity: €0.120/kWh
--
-- Idempotency: ON CONFLICT (user_id, location, machine_name) DO NOTHING
-- These rows use user_id = '00000000-0000-0000-0000-000000000001' (system/seed user),
-- same convention as migration 337.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Section A — Fix bad USA injection molding records ─────────────────────────

UPDATE mhr_records
SET
  manual_mhr_value         = NULL,
  total_machine_hour_rate  = NULL,
  fully_burdened_local_per_hr = NULL
WHERE
  location = 'USA'
  AND (machine_class ILIKE '%injection%' OR commodity_code ILIKE 'IM-%')
  AND manual_mhr_value IS NOT NULL
  AND manual_mhr_value < 40;

-- ── Section B — United Kingdom (GBP/hr) ──────────────────────────────────────

DO $$
DECLARE
  seed_user UUID := '00000000-0000-0000-0000-000000000001';
BEGIN

INSERT INTO mhr_records (
  id, user_id, location, commodity_code, machine_name, machine_class, process_group,
  landed_machine_cost, manual_mhr_value, fully_burdened_local_per_hr, total_machine_hour_rate,
  currency, max_tonnage, max_x_mm, max_y_mm, max_z_mm,
  power_kwh_per_hour, electricity_cost_per_kwh, capability_source, availability_status
)
SELECT
  gen_random_uuid(), seed_user, t.location, t.commodity_code, t.machine_name,
  t.machine_class, t.process_group, t.machine_cost, t.mhr, t.mhr, t.mhr,
  t.currency, t.max_tonnage, t.max_x_mm, t.max_y_mm, t.max_z_mm,
  t.power_kwh, 0.26, 'benchmark', 'active'
FROM (VALUES
  -- Injection Molding
  ('UK','IM-SMALL',  'Injection Moulder 50T',       'injection_molding','Injection Molding', 80000,  35,  50,  NULL, NULL, NULL, 'GBP', 7.0),
  ('UK','IM-SMALL',  'Injection Moulder 100T',      'injection_molding','Injection Molding', 150000, 48,  100, NULL, NULL, NULL, 'GBP', 10.0),
  ('UK','IM-MED',    'Injection Moulder 200T',      'injection_molding','Injection Molding', 280000, 68,  200, NULL, NULL, NULL, 'GBP', 15.0),
  ('UK','IM-MED',    'Injection Moulder 500T',      'injection_molding','Injection Molding', 600000, 98,  500, NULL, NULL, NULL, 'GBP', 25.0),
  ('UK','IM-LARGE',  'Injection Moulder 1000T',     'injection_molding','Injection Molding', 1200000,148, 1000,NULL, NULL, NULL, 'GBP', 45.0),
  -- CNC Machining
  ('UK','CNC-VMC-3AX','VMC 3-Axis',                'cnc_3ax_vmc',      'CNC Machining',     90000,  72,  NULL,762, 406, 508,  'GBP', 12.0),
  ('UK','CNC-VMC-4AX','VMC 4-Axis',                'cnc_4ax_vmc',      'CNC Machining',     130000, 90,  NULL,650, 500, 500,  'GBP', 14.0),
  ('UK','CNC-MC-5AX', 'Machining Centre 5-Axis',   'cnc_5ax_mc',       'CNC Machining',     250000, 130, NULL,500, 500, 400,  'GBP', 18.0),
  ('UK','CNC-LATHE-2AX','CNC Lathe',               'cnc_lathe',        'Turning',           70000,  60,  NULL,NULL,356, 533,  'GBP', 8.0),
  -- Sheet Metal
  ('UK','SM-LASER-4K', 'Fibre Laser 4kW',          'fiber_laser',      'Sheet Metal',       180000, 80,  NULL,3000,1500,NULL, 'GBP', 24.0),
  ('UK','SM-BRAKE-80T','Press Brake 80T',           'press_brake',      'Sheet Metal',       60000,  52,  80,  NULL,3200,NULL, 'GBP', 7.5),
  ('UK','SM-PUNCH-CNC','CNC Turret Punch',          'turret_punch',     'Sheet Metal',       130000, 72,  20,  NULL,2500,1250, 'GBP', 14.0),
  -- QA / Bench
  ('UK','QA-CMM',      'CMM',                       'cmm',             'Inspection',         120000, 48,  NULL,1500,1000,1000, 'GBP', 4.0),
  ('UK','BENCH-DEBURR','Manual Inspection Bench',   'deburring',       'Finishing',          5000,   30,  NULL,NULL,NULL,NULL, 'GBP', 1.5)
) AS t(location, commodity_code, machine_name, machine_class, process_group,
       machine_cost, mhr, max_tonnage, max_x_mm, max_y_mm, max_z_mm, currency, power_kwh)
WHERE NOT EXISTS (
  SELECT 1 FROM mhr_records r
  WHERE r.user_id = seed_user AND r.location = t.location AND r.machine_name = t.machine_name
);

-- ── Section C — France (EUR/hr) ───────────────────────────────────────────────

INSERT INTO mhr_records (
  id, user_id, location, commodity_code, machine_name, machine_class, process_group,
  landed_machine_cost, manual_mhr_value, fully_burdened_local_per_hr, total_machine_hour_rate,
  currency, max_tonnage, max_x_mm, max_y_mm, max_z_mm,
  power_kwh_per_hour, electricity_cost_per_kwh, capability_source, availability_status
)
SELECT
  gen_random_uuid(), seed_user, t.location, t.commodity_code, t.machine_name,
  t.machine_class, t.process_group, t.machine_cost, t.mhr, t.mhr, t.mhr,
  t.currency, t.max_tonnage, t.max_x_mm, t.max_y_mm, t.max_z_mm,
  t.power_kwh, 0.175, 'benchmark', 'active'
FROM (VALUES
  -- Injection Molding
  ('France','IM-SMALL',  'Injection Moulder 50T',      'injection_molding','Injection Molding', 75000,  38,  50,  NULL, NULL, NULL, 'EUR', 6.5),
  ('France','IM-SMALL',  'Injection Moulder 100T',     'injection_molding','Injection Molding', 140000, 52,  100, NULL, NULL, NULL, 'EUR', 9.5),
  ('France','IM-MED',    'Injection Moulder 200T',     'injection_molding','Injection Molding', 265000, 80,  200, NULL, NULL, NULL, 'EUR', 14.0),
  ('France','IM-MED',    'Injection Moulder 500T',     'injection_molding','Injection Molding', 560000, 118, 500, NULL, NULL, NULL, 'EUR', 22.0),
  ('France','IM-LARGE',  'Injection Moulder 1000T',    'injection_molding','Injection Molding', 1100000,172, 1000,NULL, NULL, NULL, 'EUR', 42.0),
  -- CNC Machining
  ('France','CNC-VMC-3AX','VMC 3-Axis',               'cnc_3ax_vmc',     'CNC Machining',     85000,  72,  NULL,762, 406, 508,  'EUR', 11.0),
  ('France','CNC-VMC-4AX','VMC 4-Axis',               'cnc_4ax_vmc',     'CNC Machining',     125000, 90,  NULL,650, 500, 500,  'EUR', 13.0),
  ('France','CNC-MC-5AX', 'Machining Centre 5-Axis',  'cnc_5ax_mc',      'CNC Machining',     240000, 130, NULL,500, 500, 400,  'EUR', 17.0),
  ('France','CNC-LATHE-2AX','CNC Lathe',              'cnc_lathe',       'Turning',            65000,  62,  NULL,NULL,356, 533,  'EUR', 7.5),
  -- Sheet Metal
  ('France','SM-LASER-4K', 'Fibre Laser 4kW',         'fiber_laser',     'Sheet Metal',       170000, 82,  NULL,3000,1500,NULL, 'EUR', 22.0),
  ('France','SM-BRAKE-80T','Press Brake 80T',          'press_brake',     'Sheet Metal',       55000,  52,  80,  NULL,3200,NULL, 'EUR', 7.0),
  ('France','SM-PUNCH-CNC','CNC Turret Punch',         'turret_punch',    'Sheet Metal',       120000, 66,  20,  NULL,2500,1250, 'EUR', 13.0),
  -- QA / Bench
  ('France','QA-CMM',      'CMM',                      'cmm',            'Inspection',         115000, 50,  NULL,1500,1000,1000, 'EUR', 3.5),
  ('France','BENCH-DEBURR','Manual Inspection Bench',  'deburring',      'Finishing',          5000,   36,  NULL,NULL,NULL,NULL, 'EUR', 1.5)
) AS t(location, commodity_code, machine_name, machine_class, process_group,
       machine_cost, mhr, max_tonnage, max_x_mm, max_y_mm, max_z_mm, currency, power_kwh)
WHERE NOT EXISTS (
  SELECT 1 FROM mhr_records r
  WHERE r.user_id = seed_user AND r.location = t.location AND r.machine_name = t.machine_name
);

-- ── Section D — W. Europe (EUR/hr, Benelux/Nordics blend) ────────────────────

INSERT INTO mhr_records (
  id, user_id, location, commodity_code, machine_name, machine_class, process_group,
  landed_machine_cost, manual_mhr_value, fully_burdened_local_per_hr, total_machine_hour_rate,
  currency, max_tonnage, max_x_mm, max_y_mm, max_z_mm,
  power_kwh_per_hour, electricity_cost_per_kwh, capability_source, availability_status
)
SELECT
  gen_random_uuid(), seed_user, t.location, t.commodity_code, t.machine_name,
  t.machine_class, t.process_group, t.machine_cost, t.mhr, t.mhr, t.mhr,
  t.currency, t.max_tonnage, t.max_x_mm, t.max_y_mm, t.max_z_mm,
  t.power_kwh, 0.190, 'benchmark', 'active'
FROM (VALUES
  -- Injection Molding
  ('W. Europe','IM-SMALL',  'Injection Moulder 50T',     'injection_molding','Injection Molding', 78000,  40,  50,  NULL, NULL, NULL, 'EUR', 7.0),
  ('W. Europe','IM-SMALL',  'Injection Moulder 100T',    'injection_molding','Injection Molding', 145000, 55,  100, NULL, NULL, NULL, 'EUR', 10.0),
  ('W. Europe','IM-MED',    'Injection Moulder 200T',    'injection_molding','Injection Molding', 275000, 84,  200, NULL, NULL, NULL, 'EUR', 15.0),
  ('W. Europe','IM-MED',    'Injection Moulder 500T',    'injection_molding','Injection Molding', 580000, 124, 500, NULL, NULL, NULL, 'EUR', 24.0),
  ('W. Europe','IM-LARGE',  'Injection Moulder 1000T',   'injection_molding','Injection Molding', 1150000,180, 1000,NULL, NULL, NULL, 'EUR', 44.0),
  -- CNC Machining
  ('W. Europe','CNC-VMC-3AX','VMC 3-Axis',              'cnc_3ax_vmc',     'CNC Machining',     88000,  76,  NULL,762, 406, 508,  'EUR', 12.0),
  ('W. Europe','CNC-VMC-4AX','VMC 4-Axis',              'cnc_4ax_vmc',     'CNC Machining',     128000, 94,  NULL,650, 500, 500,  'EUR', 14.0),
  ('W. Europe','CNC-MC-5AX', 'Machining Centre 5-Axis', 'cnc_5ax_mc',      'CNC Machining',     245000, 136, NULL,500, 500, 400,  'EUR', 18.0),
  ('W. Europe','CNC-LATHE-2AX','CNC Lathe',             'cnc_lathe',       'Turning',            68000,  64,  NULL,NULL,356, 533,  'EUR', 8.0),
  -- Sheet Metal
  ('W. Europe','SM-LASER-4K', 'Fibre Laser 4kW',        'fiber_laser',     'Sheet Metal',       175000, 86,  NULL,3000,1500,NULL, 'EUR', 23.0),
  ('W. Europe','SM-BRAKE-80T','Press Brake 80T',         'press_brake',     'Sheet Metal',       58000,  55,  80,  NULL,3200,NULL, 'EUR', 7.5),
  ('W. Europe','SM-PUNCH-CNC','CNC Turret Punch',        'turret_punch',    'Sheet Metal',       125000, 70,  20,  NULL,2500,1250, 'EUR', 14.0),
  -- QA / Bench
  ('W. Europe','QA-CMM',      'CMM',                     'cmm',            'Inspection',         118000, 52,  NULL,1500,1000,1000, 'EUR', 4.0),
  ('W. Europe','BENCH-DEBURR','Manual Inspection Bench', 'deburring',      'Finishing',          5000,   38,  NULL,NULL,NULL,NULL, 'EUR', 1.5)
) AS t(location, commodity_code, machine_name, machine_class, process_group,
       machine_cost, mhr, max_tonnage, max_x_mm, max_y_mm, max_z_mm, currency, power_kwh)
WHERE NOT EXISTS (
  SELECT 1 FROM mhr_records r
  WHERE r.user_id = seed_user AND r.location = t.location AND r.machine_name = t.machine_name
);

-- ── Section E — E. Europe (EUR/hr, Poland/Czech Republic 2026) ───────────────

INSERT INTO mhr_records (
  id, user_id, location, commodity_code, machine_name, machine_class, process_group,
  landed_machine_cost, manual_mhr_value, fully_burdened_local_per_hr, total_machine_hour_rate,
  currency, max_tonnage, max_x_mm, max_y_mm, max_z_mm,
  power_kwh_per_hour, electricity_cost_per_kwh, capability_source, availability_status
)
SELECT
  gen_random_uuid(), seed_user, t.location, t.commodity_code, t.machine_name,
  t.machine_class, t.process_group, t.machine_cost, t.mhr, t.mhr, t.mhr,
  t.currency, t.max_tonnage, t.max_x_mm, t.max_y_mm, t.max_z_mm,
  t.power_kwh, 0.120, 'benchmark', 'active'
FROM (VALUES
  -- Injection Molding
  ('E. Europe','IM-SMALL',  'Injection Moulder 50T',     'injection_molding','Injection Molding', 65000,  18,  50,  NULL, NULL, NULL, 'EUR', 5.0),
  ('E. Europe','IM-SMALL',  'Injection Moulder 100T',    'injection_molding','Injection Molding', 120000, 25,  100, NULL, NULL, NULL, 'EUR', 8.0),
  ('E. Europe','IM-MED',    'Injection Moulder 200T',    'injection_molding','Injection Molding', 220000, 36,  200, NULL, NULL, NULL, 'EUR', 11.0),
  ('E. Europe','IM-MED',    'Injection Moulder 500T',    'injection_molding','Injection Molding', 460000, 56,  500, NULL, NULL, NULL, 'EUR', 18.0),
  ('E. Europe','IM-LARGE',  'Injection Moulder 1000T',   'injection_molding','Injection Molding', 900000, 84,  1000,NULL, NULL, NULL, 'EUR', 33.0),
  -- CNC Machining
  ('E. Europe','CNC-VMC-3AX','VMC 3-Axis',              'cnc_3ax_vmc',     'CNC Machining',     72000,  38,  NULL,762, 406, 508,  'EUR', 9.0),
  ('E. Europe','CNC-VMC-4AX','VMC 4-Axis',              'cnc_4ax_vmc',     'CNC Machining',     105000, 50,  NULL,650, 500, 500,  'EUR', 11.0),
  ('E. Europe','CNC-MC-5AX', 'Machining Centre 5-Axis', 'cnc_5ax_mc',      'CNC Machining',     195000, 70,  NULL,500, 500, 400,  'EUR', 14.0),
  ('E. Europe','CNC-LATHE-2AX','CNC Lathe',             'cnc_lathe',       'Turning',            52000,  30,  NULL,NULL,356, 533,  'EUR', 6.0),
  -- Sheet Metal
  ('E. Europe','SM-LASER-4K', 'Fibre Laser 4kW',        'fiber_laser',     'Sheet Metal',       145000, 44,  NULL,3000,1500,NULL, 'EUR', 18.0),
  ('E. Europe','SM-BRAKE-80T','Press Brake 80T',         'press_brake',     'Sheet Metal',       42000,  28,  80,  NULL,3200,NULL, 'EUR', 5.5),
  ('E. Europe','SM-PUNCH-CNC','CNC Turret Punch',        'turret_punch',    'Sheet Metal',       95000,  38,  20,  NULL,2500,1250, 'EUR', 10.0),
  -- QA / Bench
  ('E. Europe','QA-CMM',      'CMM',                     'cmm',            'Inspection',         90000,  22,  NULL,1500,1000,1000, 'EUR', 3.0),
  ('E. Europe','BENCH-DEBURR','Manual Inspection Bench', 'deburring',      'Finishing',          3000,   12,  NULL,NULL,NULL,NULL, 'EUR', 1.0)
) AS t(location, commodity_code, machine_name, machine_class, process_group,
       machine_cost, mhr, max_tonnage, max_x_mm, max_y_mm, max_z_mm, currency, power_kwh)
WHERE NOT EXISTS (
  SELECT 1 FROM mhr_records r
  WHERE r.user_id = seed_user AND r.location = t.location AND r.machine_name = t.machine_name
);

END $$;
