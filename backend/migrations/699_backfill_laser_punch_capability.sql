-- ============================================================================
-- Migration 699: Backfill real capability columns for Laser Punch (Machine
-- Economics backlog, Part 1)
-- ============================================================================
-- Unlike Shear/Plasma Cut/Plasma Punch, Laser Punch's machine_class is
-- already correctly 'laser_punch' on all 26 real mhr_records rows (an
-- earlier session already fixed a real mislabeling bug where 127 machines
-- carried machine_class='turret_punch' -- see laser-punch-engine.ts's own
-- comment). What's still missing: the real, richest capability data of this
-- whole backlog -- press_force_kn (a genuine punching-force capacity,
-- confirmed unused by laser-punch-engine.ts's own real cost formula, a
-- real previously-unused capability signal, not a duplicate of an existing
-- formula), real per-material thickness (max_thickness_steel_mm/
-- _aluminum_mm/_stainless_steel_mm/_copper_mm -- same clean, labeled shape
-- as Shear, confirmed present on all 26 real machines, no unlabeled-tier
-- ambiguity the way fiber_laser's data has), and real bed size
-- (max_sheet_length_mm/max_sheet_width_mm) -- staged in sm_reference_data
-- (migration 507) but never backfilled into the typed columns
-- machine-selection/selector.ts's hydrateCapability() actually reads.
--
-- kN -> tonnes-force: /9.80665, the same SI conversion migrations 480/510/
-- 570 already use.
--
-- Disclosed, carried forward from migration 507's own source note (not
-- re-verified here): a couple of Amada models ("rows 5-6" in the source
-- screenshots) carry a small risk of a 1-row misalignment for punch_rate/
-- nibble_rate/rapid_traverse_rate/max_sheet_width/max_thickness --
-- worth a spot-check against the original source if precision on those
-- specific 2 machines matters.
-- ============================================================================

BEGIN;

UPDATE mhr_records m
SET
  max_tonnage          = COALESCE(m.max_tonnage, ROUND((srd.raw->>'press_force_kn')::numeric / 9.80665, 1)),
  max_thickness_ms_mm  = COALESCE(m.max_thickness_ms_mm, (srd.raw->>'max_thickness_steel_mm')::numeric),
  max_thickness_ss_mm  = COALESCE(m.max_thickness_ss_mm, (srd.raw->>'max_thickness_stainless_steel_mm')::numeric),
  max_thickness_al_mm  = COALESCE(m.max_thickness_al_mm, (srd.raw->>'max_thickness_aluminum_mm')::numeric),
  max_thickness_cu_mm  = COALESCE(m.max_thickness_cu_mm, (srd.raw->>'max_thickness_copper_mm')::numeric),
  max_x_mm             = COALESCE(m.max_x_mm, (srd.raw->>'max_sheet_length_mm')::numeric),
  max_y_mm             = COALESCE(m.max_y_mm, (srd.raw->>'max_sheet_width_mm')::numeric),
  capability_source    = COALESCE(m.capability_source, 'imported')
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND m.machine_class = 'laser_punch'
  AND srd.key LIKE 'Laser Punch / Punch Press:%'
  AND (srd.raw->>'press_force_kn') IS NOT NULL
  AND (srd.raw->>'press_force_kn')::numeric > 0;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after):
-- SELECT machine_name, max_tonnage, max_thickness_ms_mm, max_thickness_ss_mm,
--        max_thickness_al_mm, max_thickness_cu_mm, max_x_mm, max_y_mm
--   FROM mhr_records WHERE machine_class = 'laser_punch' ORDER BY machine_name;
-- -- Expect all 26 rows populated (real machine_library.json data has no gaps for this category).
