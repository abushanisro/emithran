-- ============================================================================
-- Migration 791: Wire the real, named Surface Treatment operations onto the
-- live engine, then retire the generic "Surface Treatment" catch-all row
-- ============================================================================
-- CONTEXT
--
-- Migration 790 seeded 33 real named Surface Treatment operations from
-- memory/SurfaceTreatment (Anodize, Black Oxide, Zinc Plating, ...), all
-- inactive/not_modeled -- correct at the time, since none had a machine_class
-- yet. The group ONLY had one active row, the single generic catch-all
-- "Surface Treatment" (re-homed from Post Processing by migration 790 step 1),
-- which is what every surface-treatment quote runs through today
-- (computeSurfaceTreatmentLine / cost-surface-treatment.ts, dispatched via
-- BOMItemsService.resolveSurfaceTreatmentDbRate + enrichSurfaceTreatmentRate).
--
-- The engine already resolves a SPECIFIC treatment two ways, neither of which
-- has ever depended on the generic pill:
--   Step 1 (resolveSurfaceTreatmentDbRate): longest-substring match of an
--     ACTIVE process_calculator_mappings.operation name (Surface Treatment or
--     Sheet Metal group) inside the raw treatment callout text on the
--     drawing, then
--     surface_treatment_rates.process_operation = that exact operation name.
--   Step 2 (classifySurfaceTreatment, default-rates.constants.ts): a regex
--     fallback over the callout text -> a treatment_type bucket
--     (anodize_type_ii/iii, zinc_plate, powder_coat, passivate,
--     chem_conversion_coating, or a generic '__default__' catch-all for any
--     other plat/paint/coat/black-oxide/nickel/chrome/e-coat callout).
--
-- surface_treatment_rates.process_operation (migration 363's own header:
-- "canonical name from process_calculator_mappings") was BUILT for real named
-- catalog rows to exist -- Anodizing Type I/II/III, Black Oxide, Degrease,
-- Nickel Plating, Passivation, Zinc Plating, Hard Chrome plating, Zinc Nickel
-- plating, and more -- but until 790, no such rows existed, so Step 1 could
-- never fire (the generic row own operation string, "Surface Treatment",
-- cannot appear as a substring of a real drawing callout). This migration
-- finally lets Step 1 do its job.
--
-- THE FIX
--
-- 1. Activates the 16 of the 33 seeded operations that have real coverage --
--    confirmed against surface_treatment_rates row by row below, either by
--    an exact/near-exact process_operation match (a real, treatment-specific
--    rate) or by classifySurfaceTreatment regex catch-all (a real, if
--    blended, '__default__' rate). Each is commented with which applies.
--    Reuses the EXISTING calculator (copied via subquery from the live
--    generic row, never a hardcoded UUID) -- no formula, no cost-math change.
--    The other 17 (Bead Blast, Dot Peen, Laser Engraving, Screen Printing,
--    Shot Blast/Peen, Sand Blast, Vibratory Finishing, the conveyor
--    abrasive/shot-blast/dry/oven-cure/load/unload stations, Mask-Bench,
--    Mask-Spray, Oven Cure) are mechanical finishing, marking, masking or
--    material-handling steps -- a genuinely different cost model (time or
--    media-consumption based, not area x rate vs. a minimum lot) that does
--    not exist yet. Left exactly as 790 seeded them: inactive, not_modeled,
--    a disclosed gap, not fabricated.
-- 2. Fixes two real casing mismatches in surface_treatment_rates so Step 1's
--    exact-string match actually finds the MORE SPECIFIC real rate instead of
--    silently falling through to the generic bucket for these two:
--      'Hard Chrome plating' -> 'Hard Chrome Plating'  ($28.00/m2 vs ~$3-13 blended)
--      'Zinc Nickel plating' -> 'Zinc Nickel Plating'  ($16.00/m2; the regex fallback in
--        classifySurfaceTreatment would otherwise misclassify this as plain zinc_plate, $1.79-$12/m2 --
--        a real, meaningfully cheaper alloy-plate rate this was silently landing on before)
--    The catalog own Title Case naming (sourced from memory/SurfaceTreatment,
--    the digital-factory data) is treated as authoritative; the rate table is
--    aligned to it, not the other way around.
-- 3. Retires the generic "Surface Treatment" row -- guarded: aborts if, after
--    step 1, no row is left active with machine_class='surface_treatment' (the
--    real failure mode this guards against: a naming assumption above did not
--    hold against the live catalog, which would otherwise zero every real
--    surface-treatment cost line with no warning). Mirrors the same
--    guard-then-delete discipline migration 790 already used, for the same reason.
-- ============================================================================

BEGIN;

-- ── Step 1: activate the 16 operations with real coverage ──────────────────
-- Each row: is_active, machine_class, roadmap_status, and the SAME calculator
-- the generic row already used (subquery -- never a literal UUID). Every row
-- already exists (seeded by 790); this only flips its wiring.
DO $wire$
DECLARE
  cal_id UUID;
  cal_name VARCHAR(200);
  lhr VARCHAR(50);
BEGIN
  SELECT calculator_id, calculator_name, lhr_process_group
    INTO cal_id, cal_name, lhr
  FROM process_calculator_mappings
  WHERE process_group = 'Surface Treatment' AND operation = 'Surface Treatment' AND is_active = true
  LIMIT 1;

  IF cal_id IS NULL THEN
    RAISE EXCEPTION 'The generic Surface Treatment row is not active or has no calculator_id -- nothing to copy onto the real operations. Aborting before any change.';
  END IF;

  UPDATE process_calculator_mappings
  SET is_active = true, machine_class = 'surface_treatment',
      calculator_id = cal_id, calculator_name = cal_name, lhr_process_group = lhr
  WHERE process_group = 'Surface Treatment' AND operation IN (
    -- Real, treatment-specific rate on file (exact process_operation match):
    'Black Oxide', 'Degrease', 'Nickel Plating', 'Passivation', 'Zinc Plating',
    -- Real, treatment-specific rate after the casing fix in step 2 below:
    'Hard Chrome Plating', 'Zinc Nickel Plating',
    -- classifySurfaceTreatment's anodize/powder_coat regex buckets (real, specific rates):
    'Anodize', 'Conveyor Powder Coating', 'Powder Coat Cart',
    -- classifySurfaceTreatment's generic '__default__' catch-all (real, blended rate --
    -- no treatment-specific row exists for these under this exact name):
    'Cadmium Plating', 'Conveyor Conversion Coating', 'Decorative Chrome Plating',
    'Manual Paint', 'Painting', 'Wet Coat Line'
  );

  UPDATE process_taxonomy
  SET machine_class = 'surface_treatment', roadmap_status = 'production'
  WHERE process_group = 'Surface Treatment' AND process_name IN (
    'Black Oxide', 'Degrease', 'Nickel Plating', 'Passivation', 'Zinc Plating',
    'Hard Chrome Plating', 'Zinc Nickel Plating',
    'Anodize', 'Conveyor Powder Coating', 'Powder Coat Cart',
    'Cadmium Plating', 'Conveyor Conversion Coating', 'Decorative Chrome Plating',
    'Manual Paint', 'Painting', 'Wet Coat Line'
  );
END
$wire$;

-- ── Step 2: align two casing mismatches so Step-1 lookup finds them ────────
UPDATE surface_treatment_rates SET process_operation = 'Hard Chrome Plating', updated_at = now()
WHERE process_operation = 'Hard Chrome plating';

UPDATE surface_treatment_rates SET process_operation = 'Zinc Nickel Plating', updated_at = now()
WHERE process_operation = 'Zinc Nickel plating';

-- ── Step 3: guard, then retire the generic catch-all row ───────────────────
DO $retire$
DECLARE
  still_wired integer;
  referenced integer;
BEGIN
  -- Real coverage must survive the generic row's removal: at least one OTHER
  -- active, calculator-linked row must now carry machine_class='surface_treatment'.
  SELECT count(*) INTO still_wired
  FROM process_calculator_mappings
  WHERE machine_class = 'surface_treatment' AND is_active = true AND calculator_id IS NOT NULL
    AND NOT (process_group = 'Surface Treatment' AND operation = 'Surface Treatment');

  SELECT count(*) INTO referenced
  FROM mhr_records mr
  JOIN process_taxonomy pt ON pt.id = mr.canonical_process_id
  WHERE pt.process_group = 'Surface Treatment' AND pt.process_name = 'Surface Treatment';

  IF still_wired = 0 THEN
    RAISE EXCEPTION 'No real named operation ended up active+calculator-linked -- deleting the generic row would zero every surface-treatment cost line. Refusing to delete. Inspect step 1 above.';
  END IF;
  IF referenced > 0 THEN
    RAISE EXCEPTION 'mhr_records still references the generic Surface Treatment taxonomy row (% row(s)) -- refusing to delete.', referenced;
  END IF;
END
$retire$;

DELETE FROM process_calculator_mappings WHERE process_group = 'Surface Treatment' AND operation = 'Surface Treatment';
DELETE FROM process_taxonomy WHERE process_group = 'Surface Treatment' AND process_name = 'Surface Treatment';

COMMIT;

-- Verification (run manually after):
-- SELECT operation, is_active, machine_class, calculator_id FROM process_calculator_mappings
--   WHERE process_group = 'Surface Treatment' ORDER BY is_active DESC, operation;
--   -- expect: no "Surface Treatment" row; the 16 named ones above is_active=true,
--   -- machine_class='surface_treatment', calculator_id = the same UUID on all of them;
--   -- the other 17 unchanged (inactive, machine_class NULL).
-- SELECT process_operation, treatment_type, rate_per_m2_usd FROM surface_treatment_rates
--   WHERE process_operation IN ('Hard Chrome Plating','Zinc Nickel Plating');
--   -- expect exactly these two spellings, no lowercase-p duplicates left unmatched.
