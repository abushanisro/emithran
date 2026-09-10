-- ============================================================================
-- Migration 701: Backfill real capability columns for the forming-family
-- classes (Standard Press, Tandem Press, Progressive Die Press, Roll
-- Bending 2/3/4) -- Machine Economics backlog, forming-family completion.
-- ============================================================================
-- buildPartRequirements() previously built NO MachineRequirement at all for
-- these 6 classes (it only ever looped the sheet_metal_cutting engine
-- family) -- so resolveMHRRates()'s selectMachine() call always fell back
-- to { kind: 'generic' } for them: zero tonnage/bed/thickness gating,
-- regardless of the part. Real, sourced, already-staged capability data for
-- all 6 classes exists in sm_reference_data (confirmed by direct read of
-- the migrations that staged them) and was simply never wired into
-- mhr_records' typed capability columns -- same defect class as the
-- Shear/Plasma Cut/Plasma Punch/Laser Punch fixes (migrations 697-699).
--
-- Real field-name note (two shapes, same real quantities):
--   Standard Press (585) / Tandem Press (508): max_part_length_mm,
--     max_part_width_mm, press_force_kn, and ALL 5 real per-material
--     thickness fields (max_thickness_steel_mm/_aluminum_mm/_brass_mm/
--     _copper_mm/_stainless_steel_mm).
--   Progressive Die Press (508): press_table_length_mm, press_table_width_mm,
--     press_force_kn, but ONLY max_thickness_aluminum_mm -- the other 4
--     materials were explicitly disclosed as illegible in the source
--     migration's own note (glare/blur in the source photos) and were never
--     fabricated to fill the gap; this migration does not fabricate them
--     either -- max_thickness_ms/ss/cu_mm stay NULL for this class.
--   Roll Bending 2/3/4 (505): roll_working_length_mm, steel_thickness_mm
--     (mild-steel only -- no other real material breakdown exists for this
--     class anywhere in the sourced reference data).
--
-- kN -> tonnes-force: /9.80665, the same SI conversion migrations 480/510/
-- 570/699 already use.
-- ============================================================================

BEGIN;

-- Standard Press + Tandem Press: identical real field shape, real coverage
-- across all 5 materials.
UPDATE mhr_records m
SET
  max_tonnage          = COALESCE(m.max_tonnage, ROUND((srd.raw->>'press_force_kn')::numeric / 9.80665, 1)),
  max_x_mm             = COALESCE(m.max_x_mm, (srd.raw->>'max_part_length_mm')::numeric),
  max_y_mm             = COALESCE(m.max_y_mm, (srd.raw->>'max_part_width_mm')::numeric),
  max_thickness_ms_mm  = COALESCE(m.max_thickness_ms_mm, (srd.raw->>'max_thickness_steel_mm')::numeric),
  max_thickness_ss_mm  = COALESCE(m.max_thickness_ss_mm, (srd.raw->>'max_thickness_stainless_steel_mm')::numeric),
  max_thickness_al_mm  = COALESCE(m.max_thickness_al_mm, (srd.raw->>'max_thickness_aluminum_mm')::numeric),
  max_thickness_cu_mm  = COALESCE(m.max_thickness_cu_mm, (srd.raw->>'max_thickness_copper_mm')::numeric),
  capability_source    = COALESCE(m.capability_source, 'imported')
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND m.machine_class IN ('standard_press', 'tandem_press')
  AND (srd.key LIKE 'Standard Press:%' OR srd.key LIKE 'Tandem Press:%')
  AND (srd.raw->>'press_force_kn') IS NOT NULL
  AND (srd.raw->>'press_force_kn')::numeric > 0;

-- Progressive Die Press: different real field names for bed size
-- (press_table_*), and only aluminum thickness is real -- others left NULL,
-- never fabricated.
UPDATE mhr_records m
SET
  max_tonnage          = COALESCE(m.max_tonnage, ROUND((srd.raw->>'press_force_kn')::numeric / 9.80665, 1)),
  max_x_mm             = COALESCE(m.max_x_mm, (srd.raw->>'press_table_length_mm')::numeric),
  max_y_mm             = COALESCE(m.max_y_mm, (srd.raw->>'press_table_width_mm')::numeric),
  max_thickness_al_mm  = COALESCE(m.max_thickness_al_mm, (srd.raw->>'max_thickness_aluminum_mm')::numeric),
  capability_source    = COALESCE(m.capability_source, 'imported')
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND m.machine_class = 'progressive_die_press'
  AND srd.key LIKE 'Progressive Die Press:%'
  AND (srd.raw->>'press_force_kn') IS NOT NULL
  AND (srd.raw->>'press_force_kn')::numeric > 0;

-- Roll Bending 2/3/4: real roll length + mild-steel-only thickness.
UPDATE mhr_records m
SET
  max_length_mm        = COALESCE(m.max_length_mm, (srd.raw->>'roll_working_length_mm')::numeric),
  max_thickness_ms_mm  = COALESCE(m.max_thickness_ms_mm, (srd.raw->>'steel_thickness_mm')::numeric),
  capability_source    = COALESCE(m.capability_source, 'imported')
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND m.machine_class IN ('roll_bending_2', 'roll_bending_3', 'roll_bending_4')
  AND (srd.key LIKE '2 Roll Bender:%' OR srd.key LIKE '3 Roll Bender:%' OR srd.key LIKE '4 Roll Bender:%')
  AND (srd.raw->>'roll_working_length_mm') IS NOT NULL
  AND (srd.raw->>'roll_working_length_mm')::numeric > 0;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after):
-- SELECT machine_class, machine_name, max_tonnage, max_x_mm, max_y_mm,
--        max_thickness_ms_mm, max_thickness_ss_mm, max_thickness_al_mm, max_thickness_cu_mm, max_length_mm
--   FROM mhr_records
--   WHERE machine_class IN ('standard_press','tandem_press','progressive_die_press','roll_bending_2','roll_bending_3','roll_bending_4')
--   ORDER BY machine_class, machine_name;
-- -- Expect: standard_press/tandem_press rows populated across all thickness columns;
-- -- progressive_die_press rows populated for max_tonnage/max_x_mm/max_y_mm/max_thickness_al_mm only
-- -- (ss/cu stay NULL -- real, disclosed gap, not a bug); roll_bending_* rows populated for
-- -- max_length_mm/max_thickness_ms_mm only.
