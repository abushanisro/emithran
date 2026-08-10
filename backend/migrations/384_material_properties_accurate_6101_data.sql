-- ===================================================================================
-- Migration 384: Accurate 6101 property data + engineering-property columns (2026-07-30)
--
-- Source for all 6101-T6 values below: Methode Power Solutions "Extrudable
-- Aluminum Alloys" datasheet (6063-T5 / 6101-T6 / 6061-T6 comparison table),
-- https://www.methodepowersolutions.com/wp-content/uploads/2020/07/Extrudable_Aluminum_Alloys-Verified.pdf
-- Methode Power Solutions manufactures busbars and power conductors -- the
-- exact application of the part that surfaced this gap -- so this is a
-- directly relevant, citable industry source, not a generic materials
-- database. Cross-checked electrical conductivity against a second source
-- (AZoM / general web references citing 55-59% IACS for 6101) before use.
--
-- UTS (221 MPa) and yield (193 MPa) match the earlier migration exactly --
-- confirms those were correct. Shear strength is corrected from an earlier
-- estimate of 133 MPa (derived by analogy to other alloys' UTS:shear ratio)
-- to the datasheet's actual measured value of 138 MPa.
--
-- "2026 data": physical/mechanical alloy properties (strength, modulus,
-- conductivity) are stable material-science constants, not something that
-- changes year to year -- only market pricing is time-sensitive, and pricing
-- is deliberately NOT included here (see migration 382's reasoning: no
-- verified current quote available, left as PENDING_REVIEW rather than
-- guessed). Do not fabricate a "2026 price" for the same reason.
--
-- New columns, and why each one is scoped the way it is:
--   elastic_modulus_gpa, poisson_ratio -- backfilled for ALL existing
--     Aluminum rows (not just 6101). Unlike strength/conductivity, these two
--     are near-invariant across wrought aluminum alloys as a matter of
--     physics (the elastic response is dominated by the aluminum matrix, not
--     alloying additions) -- confirmed identical (68.9 GPa / 0.33) across
--     6063-T5, 6101-T6, and 6061-T6 in the same datasheet. This is a real,
--     citable engineering approximation used industry-wide, not a guess.
--   elongation_pct, electrical_conductivity_iacs_pct, thermal_conductivity_w_mk
--     -- populated for 6101 ONLY. These vary meaningfully by alloy and temper
--     (elongation 8-20%+, IACS ~30-60%+ depending on alloy), so backfilling
--     them for the other 38 aluminum rows without alloy-specific verified
--     data would repeat exactly the mistake this whole thread has been
--     correcting. Add those individually, with a real source per alloy, if
--     needed later.
-- ===================================================================================

ALTER TABLE raw_materials
    ADD COLUMN IF NOT EXISTS elastic_modulus_gpa            NUMERIC,
    ADD COLUMN IF NOT EXISTS poisson_ratio                   NUMERIC,
    ADD COLUMN IF NOT EXISTS elongation_pct                  NUMERIC,
    ADD COLUMN IF NOT EXISTS electrical_conductivity_iacs_pct NUMERIC,
    ADD COLUMN IF NOT EXISTS thermal_conductivity_w_mk       NUMERIC;

COMMENT ON COLUMN raw_materials.elastic_modulus_gpa IS 'Young''s modulus (GPa). ~68.9 GPa for wrought aluminum alloys generally (near alloy-independent).';
COMMENT ON COLUMN raw_materials.poisson_ratio       IS 'Poisson''s ratio (dimensionless). ~0.33 for wrought aluminum alloys generally.';
COMMENT ON COLUMN raw_materials.elongation_pct      IS 'Elongation at break, % (alloy- and temper-specific -- do not generalize across alloys).';
COMMENT ON COLUMN raw_materials.electrical_conductivity_iacs_pct IS 'Electrical conductivity, %IACS (alloy- and temper-specific).';
COMMENT ON COLUMN raw_materials.thermal_conductivity_w_mk IS 'Solid-state thermal conductivity, W/m-K at ~25C (alloy-specific; distinct from thermal_conductivity_melt, which is for injection-molding melt-state simulation, not general engineering use).';

-- Backfill elastic modulus + Poisson's ratio for all existing aluminum rows
-- (safe generalization, see header). Does not touch rows that already have
-- a value (none currently do, but WHERE guards against double-run weirdness
-- if a future migration sets alloy-specific values here).
UPDATE raw_materials
SET elastic_modulus_gpa = 68.9,
    poisson_ratio = 0.33
WHERE material_type = 'Aluminum'
  AND elastic_modulus_gpa IS NULL;

-- Accurate 6101-T6 data (all values from the Methode Power Solutions datasheet
-- above; shear strength corrected from the earlier 133 MPa estimate to the
-- real measured 138 MPa).
UPDATE raw_materials
SET ultimate_tensile_strength = 221,
    yield_tensile_strength = 193,
    shearing_strength = 138,
    elongation_pct = 15,
    electrical_conductivity_iacs_pct = 57.7,  -- derived from 0.00000299 ohm-cm resistivity / IACS reference 0.0000017241 ohm-cm
    thermal_conductivity_w_mk = 218,
    melting_temp_c = 637,                     -- midpoint of datasheet's 621-654 C range
    astm_standard = 'ASTM B317'
WHERE material = 'Generic Aluminum, ANSI 6101';

-- Verification:
-- SELECT material, ultimate_tensile_strength, yield_tensile_strength, shearing_strength,
--        elongation_pct, elastic_modulus_gpa, poisson_ratio,
--        electrical_conductivity_iacs_pct, thermal_conductivity_w_mk, astm_standard
--   FROM raw_materials WHERE material = 'Generic Aluminum, ANSI 6101';
-- SELECT count(*) FROM raw_materials WHERE material_type = 'Aluminum' AND elastic_modulus_gpa = 68.9;
