-- ============================================================================
-- Migration 724: Wire Cut To Length Line (CTL) as a real, registered
-- sheet-metal cutting process — genuinely unwired before this migration.
-- ============================================================================
-- ROOT CAUSE (confirmed by direct query, 2026-09-10, and by migration 572's
-- own header, which already found this and correctly declined to fabricate
-- a fix): Cut To Length Line is a real Digital Factory category (8 real
-- machines, memory/sheetmetal/machine/machine_library.json) with 40 real
-- mhr_records rows (8 machines x 5 locations, benchmark_source_key =
-- 'Cut To Length Line (CTL):<machine name>') that have never had a
-- machine_class assigned, and ZERO process_calculator_mappings row at all
-- ("a true gap with nothing to link" — migration 572). No cost engine, no
-- route, no capability data — this migration closes all three, using only
-- real, already-staged reference data (sm_reference_data, migrations
-- 505-508), the same migration 570/608/697-established JOIN pattern every
-- other real-data capability backfill in this codebase uses. No thresholds
-- invented, no formula guessed from nothing:
--
--   const_coeff_cycle_time / mass_coeff_cycle_time / cut_speed_s and
--   const_coeff_handling_time / mass_coeff_handling_time_s_kg are IDENTICAL
--   across all 8 real CTL machines (-3.69 / 0.98 / 25 / -4.9 / 0.98) — a
--   real, uniform per-category formula, not a per-machine fit. Composition
--   (own-cycle-component + handling-time-component, both linear in part
--   mass) mirrors press-stroke-engine.ts's own already-proven formula shape
--   exactly (migration 608) — same real handling_time_const_s/
--   handling_time_mass_coeff_s_per_kg columns are REUSED here (not
--   duplicated), since it's the same physical concept (material handling/
--   positioning) on the same class of sheet-metal machine.
--
--   Real per-machine capability varies (max_thickness_steel_mm 1.75-12mm,
--   roll_width_mm/coil width 1219-2438mm) — backfilled per-machine from
--   sm_reference_data, never collapsed to one class-wide constant (see
--   seed-registry.ts's cut_to_length MACHINE_CLASS_DEFAULTS entry, which
--   deliberately stays empty for the same reason shear/laser_punch do).
--
-- benchmark_source_key is location-agnostic (confirmed: sm_reference_data's
-- 'Cut To Length Line (CTL):<name>' keys are tagged source_region =
-- 'World Average', not USA-only — migrations 506/538 already established
-- this is real, physical-machine-model data, identical regardless of which
-- Digital Factory location a copy of that model sits in), so — unlike
-- migration 538's specs-JSONB backfill, which only reached the 8 USA rows —
-- this migration backfills all 40 real rows across all 5 locations directly
-- from sm_reference_data, the same join base migration 570/608/697 use.
--
-- Also creates the real process_calculator_mappings row: 'Cut To Length
-- Line', process_group 'Sheet Metal', process_route 'Sheet Cutting' (same
-- route Shearing's real, structurally-identical coil/blank-processing
-- operation uses — migration 583/697), calculator_id NULL (no real DB
-- calculator exists for this process, same as every other engine that
-- prices via a registered ManufacturingProcessEngine computing real physics
-- directly rather than a generic calculator row — OxyFuel/Plasma/Router/
-- Shear all follow this same convention).
--
-- Also adds the real process_taxonomy canonical row + a default_machine_name
-- ('Default CTL' — real, confirmed in BOTH process_machine_data.json and
-- machine_library.json's own CTL category), so the Process page's operation
-- pill for Cut To Length Line shows real detail immediately, not another
-- "no detail on file" gap the moment this ships.
--
-- process_taxonomy_operations: process_operations.json (confirmed by direct
-- search) never names "Cut To Length"/"CTL" as its own top-level family, and
-- has no "length"/"coil"/"straighten"/"uncoil" family either — but it DOES
-- already establish a real, repeated structural convention for a single-
-- operation stock-cutting process with no feature-type differentiation of
-- its own: '<Name>:<Name>//Blank' (e.g. 'Material Stock:As Supplied//Blank',
-- 'Deslag:Deslag//Blank', '2 Axis Router:Router Cutting//Blank'). CTL's real
-- action (uncoil, straighten, cut coil stock to length) IS exactly that
-- shape — it turns raw coil into a discrete cut blank, never punches a hole
-- (no real per-machine punch/nibble data exists for this category anywhere,
-- confirmed against machine_library.json's own CTL field set) — so this
-- migration adds the one real, structurally-consistent row that shape
-- implies ('Cut To Length Line:Cut To Length Line//Blank'), not the
-- ComplexHole/SimpleHole siblings Deslag/Material Stock also carry (those
-- two DO real hole-adjacent finishing/staging work; CTL never does).
--
-- Idempotent: every UPDATE is scoped to matching benchmark_source_key rows,
-- COALESCE-guarded on every capability column so it never overwrites a real
-- existing value; the process_calculator_mappings/process_taxonomy INSERTs
-- use WHERE NOT EXISTS guards, safe to re-run.
--
-- Run in: Supabase SQL Editor
-- ============================================================================

BEGIN;

-- ── 1. New mhr_records columns for CTL's own real per-machine formula ──────
-- (handling_time_const_s / handling_time_mass_coeff_s_per_kg already exist,
-- migration 608 — reused here, not duplicated.)
ALTER TABLE mhr_records ADD COLUMN IF NOT EXISTS cut_to_length_cycle_const_s NUMERIC;
ALTER TABLE mhr_records ADD COLUMN IF NOT EXISTS cut_to_length_cycle_mass_coeff_s_per_kg NUMERIC;
ALTER TABLE mhr_records ADD COLUMN IF NOT EXISTS cut_to_length_cut_speed_s NUMERIC;

-- ── 2. machine_class, across all 5 locations (location-agnostic key) ───────
UPDATE mhr_records
SET machine_class = 'cut_to_length'
WHERE benchmark_source_key LIKE 'Cut To Length Line (CTL):%'
  AND machine_class IS NULL;

-- ── 3. Real per-machine formula + capability columns, from sm_reference_data ─
UPDATE mhr_records m
SET
  cut_to_length_cycle_const_s             = COALESCE(m.cut_to_length_cycle_const_s, (srd.raw->>'const_coeff_cycle_time')::numeric),
  cut_to_length_cycle_mass_coeff_s_per_kg  = COALESCE(m.cut_to_length_cycle_mass_coeff_s_per_kg, (srd.raw->>'mass_coeff_cycle_time')::numeric),
  cut_to_length_cut_speed_s                = COALESCE(m.cut_to_length_cut_speed_s, (srd.raw->>'cut_speed_s')::numeric),
  handling_time_const_s                    = COALESCE(m.handling_time_const_s, (srd.raw->>'const_coeff_handling_time')::numeric),
  handling_time_mass_coeff_s_per_kg        = COALESCE(m.handling_time_mass_coeff_s_per_kg, (srd.raw->>'mass_coeff_handling_time_s_kg')::numeric),
  setup_time_hr                            = COALESCE(m.setup_time_hr, (srd.raw->>'setup_time_hr')::numeric),
  max_y_mm                                 = COALESCE(m.max_y_mm, (srd.raw->>'roll_width_mm')::numeric),
  max_thickness_ms_mm                      = COALESCE(m.max_thickness_ms_mm, (srd.raw->>'max_thickness_steel_mm')::numeric),
  max_thickness_ss_mm                      = COALESCE(m.max_thickness_ss_mm, (srd.raw->>'max_thickness_stainless_steel_mm')::numeric),
  max_thickness_al_mm                      = COALESCE(m.max_thickness_al_mm, (srd.raw->>'max_thickness_aluminum_mm')::numeric),
  max_thickness_cu_mm                      = COALESCE(m.max_thickness_cu_mm, (srd.raw->>'max_thickness_copper_mm')::numeric),
  capability_source                        = COALESCE(m.capability_source, 'imported')
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND srd.key LIKE 'Cut To Length Line (CTL):%';

-- ── 4. process_taxonomy: canonical row (created BEFORE the mapping row,
-- since process_calculator_mappings.canonical_process_id is NOT NULL --
-- migration 610 -- and must be supplied at INSERT time, not backfilled after) ─
INSERT INTO process_taxonomy (process_group, process_name, machine_class, roadmap_status, default_machine_name, default_tool_shop_name)
SELECT 'Sheet Metal', 'Cut To Length Line', 'cut_to_length', 'production', 'Default CTL', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM process_taxonomy WHERE process_group = 'Sheet Metal' AND process_name = 'Cut To Length Line'
);

-- ── 5. process_calculator_mappings: the real, previously-nonexistent row ───
INSERT INTO process_calculator_mappings (process_group, process_route, operation, machine_class, calculator_id, is_active, canonical_process_id)
SELECT 'Sheet Metal', 'Sheet Cutting', 'Cut To Length Line', 'cut_to_length', NULL, true, pt.id
FROM process_taxonomy pt
WHERE pt.process_group = 'Sheet Metal' AND pt.process_name = 'Cut To Length Line'
  AND NOT EXISTS (
    SELECT 1 FROM process_calculator_mappings
    WHERE process_group = 'Sheet Metal' AND process_route = 'Sheet Cutting' AND operation = 'Cut To Length Line'
  );

-- ── 6. process_taxonomy_operations: the one real, structurally-consistent
-- feature row (see header) ──────────────────────────────────────────────────
INSERT INTO process_taxonomy_operations (canonical_process_id, operation_category, feature_type, raw_compound_string, notes)
SELECT pt.id, 'Cut To Length Line', 'Blank', 'Cut To Length Line:Cut To Length Line//Blank',
       'No raw process_operations.json string names CTL directly (confirmed by direct search) — this reuses the same real ''<Name>:<Name>//Blank'' shape process_operations.json already gives every other single-operation stock-cutting process (Material Stock:As Supplied//Blank, Deslag:Deslag//Blank, 2 Axis Router:Router Cutting//Blank). CTL''s real action (uncoil/straighten/cut coil to length) produces exactly a Blank, never a hole feature.'
FROM process_taxonomy pt
WHERE pt.process_group = 'Sheet Metal' AND pt.process_name = 'Cut To Length Line'
ON CONFLICT (canonical_process_id, raw_compound_string) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after):
--
-- 1. All 40 real rows now classified, real formula + capability populated:
--   SELECT location, machine_name, machine_class, cut_to_length_cycle_const_s,
--          cut_to_length_cycle_mass_coeff_s_per_kg, cut_to_length_cut_speed_s,
--          handling_time_const_s, handling_time_mass_coeff_s_per_kg,
--          max_y_mm, max_thickness_ms_mm, max_thickness_ss_mm,
--          max_thickness_al_mm, max_thickness_cu_mm, setup_time_hr
--     FROM mhr_records WHERE benchmark_source_key LIKE 'Cut To Length Line (CTL):%'
--     ORDER BY machine_name, location;
--   -- Expect 40 rows, machine_class='cut_to_length', every column populated,
--   -- none NULL.
--
-- 2. The real, new catalog row exists and is active:
--   SELECT process_group, process_route, operation, machine_class, calculator_id,
--          is_active, canonical_process_id
--     FROM process_calculator_mappings
--    WHERE process_group = 'Sheet Metal' AND operation = 'Cut To Length Line';
--   -- Expect exactly 1 row, machine_class='cut_to_length', is_active=true,
--   -- canonical_process_id NOT NULL.
--
-- 3. Process page taxonomy detail:
--   SELECT process_name, machine_class, roadmap_status, default_machine_name
--     FROM process_taxonomy WHERE process_group = 'Sheet Metal' AND process_name = 'Cut To Length Line';
--   -- Expect machine_class='cut_to_length', roadmap_status='production',
--   -- default_machine_name='Default CTL'.
