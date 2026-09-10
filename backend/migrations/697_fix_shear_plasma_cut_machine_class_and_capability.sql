-- ============================================================================
-- Migration 697: Fix machine_class + backfill real capability columns for
-- Shear and Plasma Cut (Machine Economics backlog, Part 1)
-- ============================================================================
-- ROOT CAUSE (found while extending machine-selection/selector.ts's real
-- capability-first selection to these two classes): neither class's real
-- mhr_records rows carry a machine_class value that matches the real,
-- registered cost engine that actually costs them.
--
--   Shear (10 rows, migration 583): machine_class left NULL, deliberately --
--   at the time, the only real concern was NOT colliding with press_brake's
--   selection pool. That concern is now moot (a canonical 'shear' value is
--   unambiguous), but nothing ever revisited it once ShearingEngine
--   (machineClass='shear') was registered.
--
--   Plasma Cut (13 rows, migration 582): machine_class was set to the
--   literal string 'plasma' -- not 'plasma_cut', the real registered
--   PlasmaCuttingEngine's machineClass. 'plasma' is not a canonical
--   MachineClass value at all (default-rates.constants.ts's MACHINE_REGISTRY
--   has 'plasma_cut'/'plasma_punch', never bare 'plasma').
--
-- classifyMachineRecord()'s Tier 0 (trust machine_class directly) fails for
-- both, and Tiers 2/3 (keyword matching against machine_class/process_group/
-- machine_name) ALSO fail for most of these machines' real names -- e.g.
-- "Chicago - HS 25130", "Roper Whitney - 10H8", "Vulcan 3100D", "CSI Series
-- 4 - 200A" contain neither "shear"/"shearing" nor "plasma cut"/"plasma
-- cutting" as a substring. Only the few generically-named rows ("Default
-- Shear", "Shear - 13mm Steel...", "Default Plasma") would ever classify
-- correctly today. Confirmed via direct code read (selector.ts's
-- classifyMachineRecord, three-tier fallback) -- most of these 23 real
-- machines never enter fetchMachinePool()'s candidate list at all, for
-- either class, until this migration.
--
-- Real capability columns are then backfilled via the same migration
-- 570/583-established JOIN pattern against sm_reference_data (already
-- staged, migrations 582/583 -- both categories' raw JSONB carries every
-- real per-machine field, no re-transcription here):
--   Shear: max_thickness_steel_mm/_stainless_steel_mm/_aluminum_mm/
--     _copper_mm -> max_thickness_ms_mm/_ss_mm/_al_mm/_cu_mm (real,
--     per-machine, all 10 rows have all 4 fields -- no gaps).
--     shear_length_mm -> max_length_mm (shear bed/blade length).
--   Plasma Cut: bed_length_mm/bed_width_mm -> max_x_mm/max_y_mm.
--     power_watts (100-100,000) -> power_kw (/1000; informational --
--     see machine-selection/physics.ts's PlasmaCutRequirement doc comment
--     for why thickness is deliberately not gated on this yet -- no real
--     synchronous power->thickness table exists, and inventing one here
--     risks disagreeing with the real, more precise nestingCutRate lookup
--     already used at cost time).
--
-- COALESCE throughout -- never overwrites a real value already on file,
-- only fills genuine NULLs.
-- ============================================================================

BEGIN;

-- ── Shear: machine_class ────────────────────────────────────────────────────
UPDATE mhr_records
SET machine_class = 'shear'
WHERE benchmark_source_key LIKE 'Shearing Machine:%'
  AND machine_class IS NULL;

-- ── Shear: real capability columns ──────────────────────────────────────────
UPDATE mhr_records m
SET
  max_thickness_ms_mm = COALESCE(m.max_thickness_ms_mm, (srd.raw->>'max_thickness_steel_mm')::numeric),
  max_thickness_ss_mm = COALESCE(m.max_thickness_ss_mm, (srd.raw->>'max_thickness_stainless_steel_mm')::numeric),
  max_thickness_al_mm = COALESCE(m.max_thickness_al_mm, (srd.raw->>'max_thickness_aluminum_mm')::numeric),
  max_thickness_cu_mm = COALESCE(m.max_thickness_cu_mm, (srd.raw->>'max_thickness_copper_mm')::numeric),
  max_length_mm       = COALESCE(m.max_length_mm, (srd.raw->>'shear_length_mm')::numeric),
  capability_source    = COALESCE(m.capability_source, 'imported')
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND srd.key LIKE 'Shearing Machine:%';

-- ── Plasma Cut: machine_class ───────────────────────────────────────────────
UPDATE mhr_records
SET machine_class = 'plasma_cut'
WHERE benchmark_source_key LIKE 'Plasma Cutting Machine:%'
  AND machine_class = 'plasma';

-- ── Plasma Cut: real capability columns ─────────────────────────────────────
UPDATE mhr_records m
SET
  max_x_mm          = COALESCE(m.max_x_mm, (srd.raw->>'bed_length_mm')::numeric),
  max_y_mm          = COALESCE(m.max_y_mm, (srd.raw->>'bed_width_mm')::numeric),
  power_kw          = COALESCE(m.power_kw, ROUND((srd.raw->>'power_watts')::numeric / 1000, 3)),
  capability_source = COALESCE(m.capability_source, 'imported')
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND srd.key LIKE 'Plasma Cutting Machine:%';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after):
-- SELECT machine_name, machine_class, max_thickness_ms_mm, max_thickness_ss_mm,
--        max_thickness_al_mm, max_thickness_cu_mm, max_length_mm
--   FROM mhr_records WHERE benchmark_source_key LIKE 'Shearing Machine:%' ORDER BY machine_name;
-- -- Expect: machine_class='shear' and all 4 thickness columns + max_length_mm populated for all 10 rows.
--
-- SELECT machine_name, machine_class, max_x_mm, max_y_mm, power_kw
--   FROM mhr_records WHERE benchmark_source_key LIKE 'Plasma Cutting Machine:%' ORDER BY machine_name;
-- -- Expect: machine_class='plasma_cut' and max_x_mm/max_y_mm/power_kw populated for all 13 rows.
