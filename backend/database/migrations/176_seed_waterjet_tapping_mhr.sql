-- Migration 176: Seed Waterjet and CNC Tapping MHR records
--
-- Context: resolveMHRRates() was rewritten in this sprint to use exact
-- commodity_code matching via MACHINE_REGISTRY. Two machine classes had
-- no DB records and permanently fell back to hardcoded defaults, making
-- them invisible to the HR Rates UI:
--
--   SM-WATERJET  — Waterjet Cutting Machine (60,000 PSI)
--   SM-TAP-CNC   — CNC Tapping Centre
--
-- After this migration, all six machine classes in MACHINE_REGISTRY have
-- at least one DB record. Rates entered via the HR Rates UI will now be
-- picked up by the cost engine for both processes.
--
-- Rates are India 2026 BENCHMARK values. Customers override via the UI.
-- Safe to re-run: guarded by WHERE NOT EXISTS on (commodity_code, source_type).

INSERT INTO mhr_records
  (machine_name, machine_description, commodity_code,
   landed_machine_cost, total_machine_hour_rate,
   currency_code, country_code, location,
   source_type, process_family, industry, data_version)

SELECT
  m.machine_name, m.machine_description, m.commodity_code,
  m.landed_machine_cost, m.total_machine_hour_rate,
  m.currency_code, m.country_code, m.location,
  m.source_type, m.process_family, m.industry, m.data_version
FROM (VALUES

  ('Waterjet Cutting Machine (60,000 PSI)',
   'Abrasive waterjet cutter. Cold-cutting — no heat-affected zone. '
   'Mild steel up to 50mm, stainless, aluminium, composites, glass. '
   'Garnet abrasive at 0.5 kg/min charged separately from machine rate.',
   'SM-WATERJET',
   8500000, 1800,
   'INR', 'IN', 'India',
   'BENCHMARK', 'sheet_metal', 'General Manufacturing', 'FY2025-26'),

  ('CNC Tapping Centre',
   'Dedicated CNC rigid tapping machine. ISO 965-1 metric threads M2–M16. '
   'High-speed rigid tapping cycle; no float chuck required. '
   'Handles blind and through holes in mild steel, stainless and aluminium.',
   'SM-TAP-CNC',
   1200000, 400,
   'INR', 'IN', 'India',
   'BENCHMARK', 'sheet_metal', 'General Manufacturing', 'FY2025-26')

) AS m(machine_name, machine_description, commodity_code,
        landed_machine_cost, total_machine_hour_rate,
        currency_code, country_code, location,
        source_type, process_family, industry, data_version)

WHERE NOT EXISTS (
  SELECT 1 FROM mhr_records r
  WHERE r.commodity_code = m.commodity_code
    AND r.source_type    = 'BENCHMARK'
);
