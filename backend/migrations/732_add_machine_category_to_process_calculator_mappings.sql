-- ============================================================================
-- Migration 732: Add a real, verified `machine_category` column to
-- process_calculator_mappings, so the Process page can group Sheet Metal
-- operations by category the same way the HR Rates page already groups
-- machines by category (Phase 1 of the category-first catalog work).
-- ============================================================================
-- WHY A NEW COLUMN, NOT A JOIN OFF machine_class
--
-- HR Rates derives category as mhr_records.benchmark_source_key.split(':')[0]
-- (MHRService.getDistinctCategories / mhrCategoryOf()). Deriving Process
-- page's category the same way by joining process_calculator_mappings.
-- machine_class -> mhr_records.machine_class -> that machine's category is
-- NOT reliable in general: machine_class is documented (mhrCategoryOf.ts,
-- VERIFIED_CLASS_CATEGORY) as capable of spanning more than one real
-- category before a class has been split/verified (e.g. this exact app's
-- own history: fiber_laser used to also cover "3D Laser Cutting Machine"
-- until migration 722 split laser_3d out). A silent join risks re-
-- introducing that same class of bug. Instead: a real, nullable column,
-- populated ONLY where a specific machine_class has been verified (below)
-- to correspond to exactly one real machine_library.json category.
--
-- WHY `machine_category`, NOT `category`
--
-- ProcessCalculatorMappingResponseDto already has an unrelated
-- `taxonomy.operations[].operationCategory` (a per-operation feature-type
-- concept from process_taxonomy_operations, e.g. "Flanging" / "ComplexHole")
-- sourced from process_operations.json. Naming the new column "category"
-- would collide conceptually with that existing, different field.
--
-- VERIFICATION METHOD (same discipline as every machine-class fix this
-- session): for each Sheet Metal machine_class below, its real machine
-- pool was cross-checked against memory/sheetmetal/machine/
-- machine_library.json's own categories -- either by exact row-count match
-- against a real, already-documented figure (CLAUDE.md's own "26 real
-- machines" for Laser Punch, "21" for Turret Press, "5" for Deslag, etc.)
-- or, for the three laser classes, by full name-for-name cross-file
-- verification already performed this session (migrations 722/729/730).
-- Classes with no verified 1:1 category (deburring's sibling secondary ops
-- -- tapping/hole_forming/drill_press-shared counterboring/countersinking/
-- reaming/pem_insertion -- none of which have ANY matching category in
-- machine_library.json at all, consistent with their real "Manual rate --
-- not linked to a machine" / "No machine on file" disclosures already shown
-- in the app) are left `machine_category = NULL` -- a genuine, disclosed
-- gap, not a guess.
--
-- Scoped to Sheet Metal only for this phase (current domain priority,
-- CLAUDE.md). Other process groups get their own verified pass later.
--
-- Idempotent: column add is IF NOT EXISTS; every UPDATE re-derives the same
-- result on rerun.
--
-- Run in: Supabase SQL Editor
-- ============================================================================

BEGIN;

ALTER TABLE process_calculator_mappings
  ADD COLUMN IF NOT EXISTS machine_category VARCHAR;

CREATE INDEX IF NOT EXISTS idx_process_calculator_mappings_machine_category
  ON process_calculator_mappings(machine_category);

-- ── Verified 1:1 machine_class -> real category (Sheet Metal, active rows) ──
UPDATE process_calculator_mappings SET machine_category = 'Fiber Laser Cutting Machine', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'fiber_laser' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = 'Laser Cutting Machine', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'co2_laser' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = '3D Laser Cutting Machine', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'laser_3d' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = 'Laser Punch / Punch Press', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'laser_punch' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = 'Turret Press (Punch Press)', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'turret_punch' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = 'Waterjet Cutting Machine', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'waterjet' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = 'Oxyfuel Cutting Machine', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'oxyfuel_cut' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = 'Shearing Machine', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'shear' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = 'Cut To Length Line (CTL)', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'cut_to_length_line' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = 'Plasma Cutting Machine', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'plasma_cut' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = 'Plasma Punch', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'plasma_punch' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = '2-Axis Router', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'router' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = 'Standard Press', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'standard_press' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = 'Tandem Press', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'tandem_press' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = 'Progressive Die Press', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'progressive_die_press' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = '2 Roll Bender', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'roll_bending_2' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = '3 Roll Bender', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'roll_bending_3' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = '4 Roll Bender', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'roll_bending_4' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = 'Bend Press Brake', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'press_brake' AND is_active = true;

UPDATE process_calculator_mappings SET machine_category = 'Deslag Machine', updated_at = NOW()
 WHERE process_group = 'Sheet Metal' AND machine_class = 'deburring' AND is_active = true;

-- Deliberately left NULL: tapping ('tapping'), Hole Extrusion/Burring
-- ('hole_forming'), Counterboring/Countersinking/Reaming (shared
-- 'drill_press'), PEM Insertion ('pem_insertion') -- none have a matching
-- category anywhere in machine_library.json (confirmed: no "Tapping",
-- "Hole Extrusion"/"Burring", "Drill Press", or "PEM"/"Insertion" category
-- exists in that file at all), consistent with these operations' own real,
-- already-shown "Manual rate -- not linked to a machine" / "No machine on
-- file" disclosures elsewhere in the app.

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after):
--
-- SELECT machine_category, count(*) FROM process_calculator_mappings
--  WHERE process_group = 'Sheet Metal' AND is_active = true
--  GROUP BY machine_category ORDER BY machine_category NULLS LAST;
-- -- Expect one row per category above (20 categories) plus one NULL group
-- -- for tapping/hole_forming/drill_press/pem_insertion's genuinely
-- -- uncategorized rows.
