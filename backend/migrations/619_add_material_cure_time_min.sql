-- ============================================================================
-- Migration 619: Add cure_time_min to raw_materials
-- ============================================================================
-- Injection Molding Phase 1 (materials data foundation, 2026-09-02).
--
-- Context: raw_materials already carries real, populated per-grade thermal
-- properties for 511/574 rows (melting_temp_c, mold_temp_c, specific_heat_melt,
-- thermal_conductivity_melt, eject_deflection_temp_c, clamping_pressure_mpa),
-- almost certainly imported from the same aPriori source as
-- memory/Injection/materials_final.json at some earlier point. That source
-- file also carries real cureTimeMin data for 35 real thermoset SMC/BMC
-- materials (Unsaturated Polyester / Vinyl Ester, real values 30-40 min) --
-- but this specific field was never imported. Cure time is a material
-- property (the material's own chemistry determines how long it takes to
-- cure under heat/pressure), not a machine property -- it belongs on
-- raw_materials alongside the other real thermal fields, not staged onto
-- mhr_records the way machine kinematics are.
--
-- Schema-only migration -- seeding is a separate, reviewable generator-script
-- pass (gen_619_seed_material_cure_time.js), same discipline as every other
-- gen_*.js seed in this codebase (migration 609's own header explains why).
-- ============================================================================

BEGIN;

ALTER TABLE raw_materials
  ADD COLUMN IF NOT EXISTS cure_time_min NUMERIC;

COMMENT ON COLUMN raw_materials.cure_time_min IS
  'Real thermoset cure time in minutes (memory/Injection/materials_final.json processingParameters.cureTimeMin). NULL for materials with no real cure-time data on file (e.g. all thermoplastics, and thermoset materials this source data does not cover) -- never fabricated, never defaulted.';

COMMIT;

-- Verification (run manually after):
-- SELECT count(*) FROM raw_materials WHERE cure_time_min IS NOT NULL; -- expect 0 until the seed script runs
