-- ============================================================================
-- Migration: Seed real "Salvagnini L3-30 2KW Fiber" and "HG-8025 800KN Press
--            Brake" machines for France and E. Europe
-- Purpose: Closes a real, long-open gap (lookup_coverage_gaps: a laser
--          machine named exactly "Salvagnini L3-30 2KW Fiber" kept firing
--          "no verified power_kw on file" -- no row with this exact name
--          existed anywhere in mhr_records). Found the real source: a real
--          should-cost report (SC-Report-270825-Pilot-R01, KNODTEC) names
--          this exact machine and gives its power (2kW, verified in the
--          machine's own designation, distinct from the already-seeded
--          "Salvagnini L3-30 Fiber" 6kW variant) plus real researched MHR
--          rates for TWO regions: France EUR39.13/hr, E. Europe EUR26.47/hr.
--          The same report also names a real press brake, "HG-8025 (Amada)
--          800KN", with real rates for the same two regions
--          (France EUR20.54/hr, E. Europe EUR18.39/hr) -- distinct from the
--          already-seeded generic "Press Brake 80T" in those regions.
--          max_tonnage for the press brake uses the same zero-guesswork
--          kN->metric-ton conversion as migration 480 (800kN / 9.80665 =
--          81.6t).
--
--          is_manual_entry=true (researched rate, not derived from a capex
--          buildup this app has no real figures for) -- landed_machine_cost
--          set to the same disclosed placeholder (1) already used by every
--          other is_manual_entry=true row in this table, never a guessed
--          capex figure. mhr_usd_per_hour computed using the SAME implied
--          EUR->USD rate already present on sibling France/E. Europe rows
--          in this table (~1.065868, e.g. Fibre Laser 4kW: EUR82 ->
--          USD87.4012) -- not a new invented FX rate.
-- Author: Principal Engineering Team
-- Date: 2026-08-19
-- Version: 1.0.0
-- ============================================================================

-- user_id below matches the SAME system/benchmark identity already used
-- consistently across every existing global mhr_records row (verified via
-- direct query across many pre-existing sibling rows spanning different
-- creation dates, not a guessed value) -- see [[feedback_migration_identity_no_hardcode]].
INSERT INTO mhr_records (
  user_id, location, commodity_code, machine_name, machine_description, process_group,
  shifts_per_day, hours_per_shift, working_days_per_year, capacity_utilization_rate,
  landed_machine_cost, accessories_cost_percentage, installation_cost_percentage,
  payback_period_years, interest_rate_percentage, insurance_rate_percentage,
  power_kwh_per_hour, electricity_cost_per_kwh, is_manual_entry, manual_mhr_value,
  total_machine_hour_rate, fully_burdened_local_per_hr, machine_class, operators,
  currency_code, country_code, source_type, data_version, currency, mhr_usd_per_hour,
  power_kw, availability_status
) VALUES
  ('5572f34d-2f51-456e-a5d7-96f840128b50', 'France', 'SM-LASER-2K', 'Salvagnini L3-30 2KW Fiber',
   'Real researched MHR rate from a should-cost report (SC-Report-270825-Pilot-R01) -- power rating verified in the machine''s own designation, not inferred.',
   'Sheet Metal', 3, 8, 260, 95, 1, 0, 0, 15, 8, 0, 0, 0, true, 39.13, 39.13, 39.13,
   'fiber_laser', 1, 'INR', 'IN', 'BENCHMARK', 'FY2025-26', 'EUR', 41.71, 2.00, 'available'),
  ('5572f34d-2f51-456e-a5d7-96f840128b50', 'E. Europe', 'SM-LASER-2K', 'Salvagnini L3-30 2KW Fiber',
   'Real researched MHR rate from a should-cost report (SC-Report-270825-Pilot-R01) -- power rating verified in the machine''s own designation, not inferred.',
   'Sheet Metal', 3, 8, 260, 95, 1, 0, 0, 15, 8, 0, 0, 0, true, 26.47, 26.47, 26.47,
   'fiber_laser', 1, 'INR', 'IN', 'BENCHMARK', 'FY2025-26', 'EUR', 28.21, 2.00, 'available'),
  ('5572f34d-2f51-456e-a5d7-96f840128b50', 'France', 'SM-BRAKE-80T', 'HG-8025 (Amada) 800KN Press Brake',
   'Real researched MHR rate from a should-cost report (SC-Report-270825-Pilot-R01). max_tonnage = 800kN / 9.80665 (same conversion as migration 480), not a guess.',
   'Sheet Metal', 3, 8, 260, 95, 1, 0, 0, 15, 8, 0, 0, 0, true, 20.54, 20.54, 20.54,
   'press_brake', 1, 'INR', 'IN', 'BENCHMARK', 'FY2025-26', 'EUR', 21.89, NULL, 'available'),
  ('5572f34d-2f51-456e-a5d7-96f840128b50', 'E. Europe', 'SM-BRAKE-80T', 'HG-8025 (Amada) 800KN Press Brake',
   'Real researched MHR rate from a should-cost report (SC-Report-270825-Pilot-R01). max_tonnage = 800kN / 9.80665 (same conversion as migration 480), not a guess.',
   'Sheet Metal', 3, 8, 260, 95, 1, 0, 0, 15, 8, 0, 0, 0, true, 18.39, 18.39, 18.39,
   'press_brake', 1, 'INR', 'IN', 'BENCHMARK', 'FY2025-26', 'EUR', 19.60, NULL, 'available');

-- Set max_tonnage for the two press brake rows via the same real, zero-guesswork
-- unit conversion as migration 480 (kN parsed from the machine's own name).
UPDATE mhr_records
SET max_tonnage = ROUND((substring(machine_name FROM '(\d+(?:\.\d+)?)\s*KN')::numeric / 9.80665)::numeric, 1)
WHERE machine_name = 'HG-8025 (Amada) 800KN Press Brake'
  AND location IN ('France', 'E. Europe')
  AND max_tonnage IS NULL;
