-- ============================================================================
-- Migration 608: Fix a live Progressive Die Press misconfiguration, and wire
-- real per-machine cycle-time/capacity data for Standard Press + Tandem
-- Press (Track B Phase 2, Press family -- partial, honest scope)
--
-- PART 1 -- live bug fix (found 2026-08-31 via direct diagnostic query):
-- process_calculator_mappings' real "Progressive die" row is is_active=true
-- with machine_class='press_brake' -- meaning any part routed through
-- Progressive Die Press today silently selects from the REAL bend-brake
-- machine pool (the 16 real Bend Press Brake machines migration 606 just
-- cleaned up), not an actual press. No real Progressive Die Press cost
-- engine exists yet (see PART 2's scope note below for why), so this is set
-- to NULL -- matching this app's own established convention for "no real
-- engine backs this operation yet" (migrations 572/584/585's own precedent)
-- -- never left silently pointing at the wrong machine family.
--
-- PART 2 -- scope decision (2026-08-31, after a live diagnostic audit):
-- machine_library.json's Progressive Die Press / Tandem Press / Standard
-- Press categories are NOT three separate machine populations -- 12 real
-- physical machines (Default Press, 3 Schulers, 8 United Power units) are
-- IDENTICAL hardware listed under multiple categories. But a live audit
-- found these 12 have TWO real problems that make them unsafe to build on
-- right now:
--   (a) each has a DUPLICATE mhr_records row (one tagged operation=
--       'Progressive die', one tagged operation='Tandem Press') -- confirmed
--       live, e.g. "Schuler 1150 Ton" has two rows with DIFFERENT direct/
--       indirect overhead ($72.61/$19.94 vs $79.56/$25.94).
--   (b) their staged physical specs (press_force_kn/max_part_length_mm/
--       max_part_width_mm/press_cycle_time_s in sm_reference_data.raw)
--       CONTRADICT each other across categories for the same real machine
--       -- e.g. "Schuler 1150 Ton" shows force_kn=7000 under both
--       "Progressive Die Press:" and "Tandem Press:" keys, but force_kn=658
--       under "Standard Press:" -- for the literal same real machine. This is
--       NOT the same dispute migration 585's header already resolved (that
--       one was scoped to the 4 NEW "Standard Press - X,000kN" placeholder
--       rows only) -- this is a separate, broader contradiction affecting the
--       12 shared machines, found here for the first time.
-- Per explicit user decision, these 12 machines are EXCLUDED from this
-- migration entirely -- no machine_class assigned, no physics backfilled --
-- until the duplicate rows and contradictory specs are reconciled against
-- the original source screenshots. This migration does NOT touch them.
--
-- What IS safe to build on: the 8 machines named "Standard Press - X,000kN
-- Press Force" (4) and "Tandem Press - X,000kN Press Force" (4) are
-- category-EXCLUSIVE placeholder rows -- never duplicated, never
-- contradicted across categories -- with real, internally-consistent,
-- monotonically-increasing press_cycle_time_s/press_force_kn/
-- max_part_length_mm/max_part_width_mm (verified: force and cycle time both
-- increase smoothly 1500kN->3000kN->5000kN->7000kN for both Standard and
-- Tandem, a real physical progression, not noise). These 8 get real
-- machine_class assignment + physics backfill in this migration.
--
-- The remaining 19 real press-family machines (Aida x7, Bliss - B-35,
-- Niagara - E511B, the 5 "Progressive Die Press - X,000kN" placeholders,
-- STD_PRESS_17) have NO press_cycle_time_s anywhere in the staged data --
-- a genuine, disclosed gap (not fabricated), left with machine_class=NULL,
-- same as before this migration.
--
-- Column choices: press_cycle_time_s is genuinely new (no existing column or
-- lookup-table pattern fits a fixed per-machine cycle-time constant -- every
-- other process's cycle time is thickness/material-driven via a lookup
-- table; here it just isn't). max_part_length_mm/max_part_width_mm are NOT
-- new columns -- they are the exact same real-world concept as the already-
-- established max_x_mm/max_y_mm (used by laser/waterjet/turret's own
-- bed-fit capability check in machine-selection/selector.ts), so they
-- backfill those existing columns instead of adding a duplicate concept
-- under a different name. Likewise press_force_kn backfills the existing
-- max_tonnage column via the same kN/9.80665 conversion selector.ts already
-- uses for tonnage parsed from a machine name (real SI physics, not a new
-- convention). handling_time_const_s/handling_time_mass_coeff_s_per_kg ARE
-- new columns -- no existing generic linear (const + mass*coeff) handling
-- formula exists elsewhere (getHandlingTime() is a lookup-bracket table, a
-- different real formula shape) -- named generically (not "press_"-prefixed)
-- since a future category could plausibly reuse the same linear shape.
-- ============================================================================

BEGIN;

-- PART 1: fix the live misconfiguration. A live run of this migration
-- confirmed process_calculator_mappings has chk_machine_class_required (any
-- is_active=true row must have a non-NULL machine_class) -- nulling
-- machine_class alone violates it. Since no real Progressive Die Press
-- engine exists, the honest fix is to deactivate it too, matching every
-- other not-yet-engineered operation's convention (is_active=false +
-- machine_class=NULL together, never one without the other).
UPDATE process_calculator_mappings
SET machine_class = NULL, is_active = false
WHERE operation = 'Progressive die' AND machine_class = 'press_brake';

-- PART 2: new columns (additive, nullable -- NULL everywhere except the 8
-- machines backfilled below).
ALTER TABLE mhr_records ADD COLUMN IF NOT EXISTS press_cycle_time_s NUMERIC;
ALTER TABLE mhr_records ADD COLUMN IF NOT EXISTS handling_time_const_s NUMERIC;
ALTER TABLE mhr_records ADD COLUMN IF NOT EXISTS handling_time_mass_coeff_s_per_kg NUMERIC;

-- Backfill the 8 clean, category-exclusive placeholder machines from their
-- own sm_reference_data.raw (real, sourced, internally consistent -- see
-- header). bed_length_mm/bed_width_mm and max_tonnage only backfilled when
-- currently NULL, never overwriting a real existing value.
UPDATE mhr_records m
SET
  press_cycle_time_s = (srd.raw->>'press_cycle_time_s')::numeric,
  handling_time_const_s = COALESCE(m.handling_time_const_s, (srd.raw->>'const_coeff_handling_time')::numeric),
  handling_time_mass_coeff_s_per_kg = COALESCE(m.handling_time_mass_coeff_s_per_kg, (srd.raw->>'mass_coeff_handling_time_s_kg')::numeric),
  max_x_mm = COALESCE(m.max_x_mm, (srd.raw->>'max_part_length_mm')::numeric),
  max_y_mm = COALESCE(m.max_y_mm, (srd.raw->>'max_part_width_mm')::numeric),
  max_tonnage = COALESCE(m.max_tonnage, ROUND((srd.raw->>'press_force_kn')::numeric / 9.80665, 2)),
  machine_class = 'standard_press'
FROM sm_reference_data srd
WHERE m.location = 'USA'
  AND srd.category = 'machine'
  AND srd.key = 'Standard Press:' || m.machine_name
  AND m.machine_name IN (
    'Standard Press - 1,500kN Press Force', 'Standard Press - 3,000kN Press Force',
    'Standard Press - 5,000kN Press Force', 'Standard Press - 7,000kN Press Force'
  );

UPDATE mhr_records m
SET
  press_cycle_time_s = (srd.raw->>'press_cycle_time_s')::numeric,
  handling_time_const_s = COALESCE(m.handling_time_const_s, (srd.raw->>'const_coeff_handling_time')::numeric),
  handling_time_mass_coeff_s_per_kg = COALESCE(m.handling_time_mass_coeff_s_per_kg, (srd.raw->>'mass_coeff_handling_time_s_kg')::numeric),
  max_x_mm = COALESCE(m.max_x_mm, (srd.raw->>'max_part_length_mm')::numeric),
  max_y_mm = COALESCE(m.max_y_mm, (srd.raw->>'max_part_width_mm')::numeric),
  max_tonnage = COALESCE(m.max_tonnage, ROUND((srd.raw->>'press_force_kn')::numeric / 9.80665, 2)),
  machine_class = 'tandem_press'
FROM sm_reference_data srd
WHERE m.location = 'USA'
  AND srd.category = 'machine'
  AND srd.key = 'Tandem Press:' || m.machine_name
  AND m.machine_name IN (
    'Tandem Press - 1,500kN Press Force', 'Tandem Press - 3,000kN Press Force',
    'Tandem Press - 5,000kN Press Force', 'Tandem Press - 7,000kN Press Force'
  );

-- Activate the 2 real, now-correctly-classed operations.
UPDATE process_calculator_mappings SET is_active = true, machine_class = 'standard_press' WHERE operation = 'Std Press';
UPDATE process_calculator_mappings SET is_active = true, machine_class = 'tandem_press' WHERE operation = 'Tandem Press';

COMMIT;

-- Verification (run manually after):
-- SELECT machine_name, machine_class, press_cycle_time_s, max_x_mm, max_y_mm, max_tonnage,
--        handling_time_const_s, handling_time_mass_coeff_s_per_kg
--   FROM mhr_records WHERE location='USA' AND machine_class IN ('standard_press','tandem_press')
--   ORDER BY machine_class, machine_name;
-- -- Expect 4 rows each, all fields populated, none NULL.
-- SELECT operation, machine_class, is_active FROM process_calculator_mappings
--   WHERE operation IN ('Progressive die', 'Std Press', 'Tandem Press');
-- -- Expect: 'Progressive die' machine_class=NULL AND is_active=false;
-- -- 'Std Press'/'Tandem Press' both machine_class set and is_active=true.
