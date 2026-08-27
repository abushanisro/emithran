-- ============================================================================
-- Migration 573: Add the 11 machine_library.json fields that are genuinely
-- universal (present, real, non-zero on machines across all 15 Sheet Metal
-- categories) as real mhr_records columns, then backfill them for the 281
-- machine_library-imported rows via the same benchmark_source_key join
-- migrations 570/571 already used.
--
-- Context: a full field-by-field audit (2026-08-25) of machine_library.json
-- found 95 fields with no existing mhr_records column at all. Of those, 11
-- are truly universal (every one of the 15 categories has a real, non-zero
-- value) -- pure machine economics/lifecycle metadata with the identical
-- meaning regardless of process, so they need no per-category conditional
-- logic. The other 84 fields are category-specific (e.g. Roll Bending's
-- pass/diameter limits, Waterjet's nozzle physics, Turret/Punch tooling) and
-- are deliberately NOT part of this migration -- a separate, later migration
-- per category, same "prove the pattern once, then repeat" discipline this
-- session already used for Roll Bending's read-side wiring.
--
-- Two real naming collisions were resolved by explicit product decision
-- (not guessed):
--   machine_power_kw   -- the machine's generic total electrical draw. Kept
--                          SEPARATE from the existing power_kw column, which
--                          migration 571 populates from power_watts (a
--                          laser's specific optical/cutting power) -- same
--                          unit, different physical meaning; conflating them
--                          would silently corrupt laser cost-engine input.
--   machine_length_mm/
--   machine_width_mm   -- the machine's own physical footprint. Kept
--                          SEPARATE from the existing max_x_mm/max_y_mm
--                          columns (the work envelope/travel limits) and
--                          from bed_length_mm/bed_width_mm (a category-
--                          specific Tier 2 field, cutting/working bed size,
--                          not added here) -- three distinct real concepts.
-- ============================================================================

BEGIN;

ALTER TABLE mhr_records
  ADD COLUMN IF NOT EXISTS labor_time_standard numeric,
  ADD COLUMN IF NOT EXISTS avg_utilization numeric,
  ADD COLUMN IF NOT EXISTS good_part_yield numeric,
  ADD COLUMN IF NOT EXISTS machine_length_mm numeric,
  ADD COLUMN IF NOT EXISTS machine_width_mm numeric,
  ADD COLUMN IF NOT EXISTS machine_life_yr numeric,
  ADD COLUMN IF NOT EXISTS machine_power_kw numeric,
  ADD COLUMN IF NOT EXISTS machine_uptime_pct numeric,
  ADD COLUMN IF NOT EXISTS annual_maintenance_factor_pct numeric,
  ADD COLUMN IF NOT EXISTS footprint_allowance_factor numeric,
  ADD COLUMN IF NOT EXISTS installation_factor_pct numeric;

COMMENT ON COLUMN mhr_records.labor_time_standard IS 'machine_library.json labor_time_standard -- shop labor-time standard multiplier, universal across all 15 Sheet Metal categories.';
COMMENT ON COLUMN mhr_records.avg_utilization IS 'machine_library.json avg_utilization -- expected fractional machine utilization.';
COMMENT ON COLUMN mhr_records.good_part_yield IS 'machine_library.json good_part_yield -- expected first-pass yield fraction.';
COMMENT ON COLUMN mhr_records.machine_length_mm IS 'machine_library.json machine_length_mm -- the machine''s own physical footprint length. Distinct from max_x_mm (work envelope) and bed_length_mm (cutting bed size, not yet a column).';
COMMENT ON COLUMN mhr_records.machine_width_mm IS 'machine_library.json machine_width_mm -- the machine''s own physical footprint width. Distinct from max_y_mm (work envelope) and bed_width_mm (cutting bed size, not yet a column).';
COMMENT ON COLUMN mhr_records.machine_life_yr IS 'machine_library.json machine_life_yr -- expected depreciable machine life in years.';
COMMENT ON COLUMN mhr_records.machine_power_kw IS 'machine_library.json machine_power_kw -- generic total electrical draw. Distinct from power_kw, which holds a laser''s specific optical/cutting power (migration 571).';
COMMENT ON COLUMN mhr_records.machine_uptime_pct IS 'machine_library.json machine_uptime_pct -- expected mechanical uptime percentage.';
COMMENT ON COLUMN mhr_records.annual_maintenance_factor_pct IS 'machine_library.json annual_maintenance_factor_pct -- annual maintenance cost as a percentage of machine price.';
COMMENT ON COLUMN mhr_records.footprint_allowance_factor IS 'machine_library.json footprint_allowance_factor -- floor-space allowance multiplier applied over the machine''s own footprint.';
COMMENT ON COLUMN mhr_records.installation_factor_pct IS 'machine_library.json installation_factor_pct -- one-time installation cost as a percentage of machine price.';

UPDATE mhr_records m
SET
  labor_time_standard = COALESCE(m.labor_time_standard, (srd.raw->>'labor_time_standard')::numeric),
  avg_utilization = COALESCE(m.avg_utilization, (srd.raw->>'avg_utilization')::numeric),
  good_part_yield = COALESCE(m.good_part_yield, (srd.raw->>'good_part_yield')::numeric),
  machine_length_mm = COALESCE(m.machine_length_mm, (srd.raw->>'machine_length_mm')::numeric),
  machine_width_mm = COALESCE(m.machine_width_mm, (srd.raw->>'machine_width_mm')::numeric),
  machine_life_yr = COALESCE(m.machine_life_yr, (srd.raw->>'machine_life_yr')::numeric),
  machine_power_kw = COALESCE(m.machine_power_kw, (srd.raw->>'machine_power_kw')::numeric),
  machine_uptime_pct = COALESCE(m.machine_uptime_pct, (srd.raw->>'machine_uptime_pct')::numeric),
  annual_maintenance_factor_pct = COALESCE(m.annual_maintenance_factor_pct, (srd.raw->>'annual_maintenance_factor_pct')::numeric),
  footprint_allowance_factor = COALESCE(m.footprint_allowance_factor, (srd.raw->>'footprint_allowance_factor')::numeric),
  installation_factor_pct = COALESCE(m.installation_factor_pct, (srd.raw->>'installation_factor_pct')::numeric)
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine';

COMMIT;
