-- ===================================================================================
-- Migration 395: Backfill uts_mpa / shear_strength_mpa from their legacy
-- equivalent columns (2026-08-01)
--
-- raw_materials has two parallel columns for the same physical quantities:
--   ultimate_tensile_strength (legacy, populated for ~511/511 rows)
--   uts_mpa                   (newer, calculator-facing; populated for only
--                              ~25/511 rows before this migration)
--   shearing_strength          (legacy, populated for 510/511 rows)
--   shear_strength_mpa          (newer, calculator-facing; same ~25-row gap)
--
-- Confirmed via migration 386 (SECC): ultimate_tensile_strength=270 there was
-- a carefully-sourced, verified JIS G3313 spec value -- uts_mpa was simply
-- never backfilled from it, an oversight predating awareness that the
-- calculator system reads uts_mpa specifically, not the legacy column. This
-- is why "UTS (defaulting to 410 MPa mild-steel)" warnings and blank
-- calculator UTS fields showed up for SECC despite a real 270 MPa value
-- sitting in the table already.
--
-- This is a straight copy of existing, already-sourced real values into their
-- newer column -- not a new value being invented. Only fills where the target
-- is NULL and the source has real data; never overwrites an existing uts_mpa/
-- shear_strength_mpa value (in case some rows intentionally differ between
-- the two columns for a documented reason).
-- ===================================================================================

UPDATE raw_materials
SET uts_mpa = ultimate_tensile_strength
WHERE uts_mpa IS NULL
  AND ultimate_tensile_strength IS NOT NULL;

UPDATE raw_materials
SET shear_strength_mpa = shearing_strength
WHERE shear_strength_mpa IS NULL
  AND shearing_strength IS NOT NULL;

-- Verification:
-- SELECT count(*) FROM raw_materials WHERE uts_mpa IS NULL AND ultimate_tensile_strength IS NOT NULL; -- expect 0
-- SELECT count(*) FROM raw_materials WHERE shear_strength_mpa IS NULL AND shearing_strength IS NOT NULL; -- expect 0
-- SELECT material, ultimate_tensile_strength, uts_mpa, shearing_strength, shear_strength_mpa FROM raw_materials WHERE material ILIKE '%SECC%';
