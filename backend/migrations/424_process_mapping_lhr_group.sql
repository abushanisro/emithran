-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 424: Real, DB-driven machine-class → LHR billing skill-group (2026-08-07)
--
-- process_calculator_mappings.process_group serves the ProcessCostDialog
-- hierarchy picker's domain grouping ('Sheet Metal', 'Machining', ...) — correct
-- for most machine classes, whose real labour-skill tier happens to be the same
-- generalist tier as their hierarchy domain. But several machine classes are
-- billed at a genuinely DIFFERENT, more specific skill tier than their hierarchy
-- domain:
--   cmm              → 'Quality'          (not 'Sheet Metal'/'Post Processing'/'Injection Molding')
--   deburring        → 'Deburr'           (not 'Sheet Metal'/'Post Processing')
--   turret_punch     → 'Turret'           (not 'Sheet Metal')
--   cnc_3ax_vmc / cnc_4ax_vmc / cnc_5ax_mc / cnc_lathe / cnc_lathe_live /
--   cnc_mill_turn    → 'CNC Machining'    (not 'Machining')
--   injection_molding→ 'Plastic & Rubber' (not 'Injection Molding'/'Plastics')
--
-- bom-items.service.ts::resolveLHRRates already knew this via a hardcoded
-- LHR_GROUP TS object (real wage-tier sources: migrations 340/345/361 seed
-- 'Quality'/'Turret'/'Deburr' as their own distinct process_group rows;
-- migration 411's own note on Turret/Deburr being genuinely separate tiers
-- from 'Sheet Metal' for China/Mexico). ProcessCostDialog.tsx's Labour Type
-- dropdown had NO equivalent at all, so it silently defaulted to (and let an
-- engineer "confirm") the wrong labour type/rate for every one of these
-- classes — confirmed live for Inspection, where the dialog showed "Sheet
-- Metal Fabricator" while the actual cost line billed "Quality Inspector"
-- (only invisible because Germany's seed data happens to set both to the
-- identical 45.14/hr).
--
-- Root fix: make the mapping itself database-driven so backend and frontend
-- read the SAME value instead of maintaining separate/duplicated hardcoded
-- copies (one of which didn't exist at all). bom-items.service.ts's
-- resolveLHRRates and resolveProcessIdentities have been rewritten to read
-- this column (the hardcoded LHR_GROUP object has been deleted, not kept as
-- a fallback).
--
-- NULL means "same as process_group" — already correct for fiber_laser/
-- press_brake/waterjet/hole_forming (their hierarchy domain IS their real
-- labour tier) and for tapping (whose correct tier is genuinely
-- family-dependent — migration 392 already gives each family its own mapping
-- row with the right process_group, e.g. 'Sheet Metal'/'Drilling'/'Tapping'
-- vs 'Machining'/'VMC'/'Tapping' — resolveProcessIdentities's existing
-- applicable_families-aware row selection, via NULL fallback here, reproduces
-- that per-family resolution with no special-case code needed).
-- ════════════════════════════════════════════════════════════════════════════════

ALTER TABLE process_calculator_mappings
  ADD COLUMN IF NOT EXISTS lhr_process_group VARCHAR(50);

COMMENT ON COLUMN process_calculator_mappings.lhr_process_group IS
  'Real lhr_records/lhr_benchmark_rates process_group this machine class is billed against. NULL = same as process_group (the hierarchy domain already IS the correct labour tier for that class).';

-- Scoped by machine_class only (not process_group) — every mapping row for a
-- given class bills the same real skill tier regardless of which hierarchy
-- domain nests it (e.g. 'cmm' under Sheet Metal, Post Processing, AND
-- Injection Molding all bill 'Quality' — the tier is a property of the
-- equipment/skill, not of what's being inspected).
UPDATE process_calculator_mappings SET lhr_process_group = 'Quality'
  WHERE machine_class = 'cmm';

UPDATE process_calculator_mappings SET lhr_process_group = 'Deburr'
  WHERE machine_class = 'deburring';

UPDATE process_calculator_mappings SET lhr_process_group = 'Turret'
  WHERE machine_class = 'turret_punch';

UPDATE process_calculator_mappings SET lhr_process_group = 'CNC Machining'
  WHERE machine_class IN ('cnc_3ax_vmc', 'cnc_4ax_vmc', 'cnc_5ax_mc', 'cnc_lathe', 'cnc_lathe_live', 'cnc_mill_turn');

UPDATE process_calculator_mappings SET lhr_process_group = 'Plastic & Rubber'
  WHERE machine_class = 'injection_molding';

-- ── Verification (informational) ───────────────────────────────────────────────
-- SELECT machine_class, process_group, lhr_process_group FROM process_calculator_mappings
--   WHERE machine_class IS NOT NULL ORDER BY machine_class, process_group;
