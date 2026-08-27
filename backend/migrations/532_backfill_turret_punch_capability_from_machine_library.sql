-- ============================================================================
-- Migration: Backfill turret_punch max_tonnage/bed/thickness from the
--            Machine Library reference export
-- Purpose: Live bug report (P0.4 follow-up): a real quote for a ~13.6 t
--          (incl. 15% margin) turret-punch job in USA showed only one
--          machine ("Amada em 3510 ZRT") with NO alternatives, and its own
--          "Why" reasoning read "No capability on file -- conservative class
--          defaults applied". Root cause confirmed via live-data diagnostic:
--          USA has exactly 2 turret_punch mhr_records rows --
--            - "Amada em 3510 ZRT" (commodity_code "Turret") -- max_tonnage,
--              max_thickness_mm, max_x_mm, max_y_mm, capability_source ALL
--              NULL. hydrateCapability() (machine-selection/selector.ts) had
--              nothing in the DB to use, no seed-registry name match either,
--              so it fell all the way through to the generic
--              MACHINE_CLASS_DEFAULTS.turret_punch (20 t / 2000x1000 mm) --
--              exactly what the UI's "conservative class defaults applied"
--              reason describes.
--            - "CNC Turret Punch" (commodity_code "SM-PUNCH-CNC",
--              capability_source='benchmark') -- a separate, apparently
--              synthetic/placeholder row, NOT addressed by this migration
--              (no match in the reference export; whether/why it doesn't
--              surface as an alternative is a separate question, tracked
--              outside this data-backfill).
--
--          This turret_punch reconciliation was simply never done -- press
--          brake (migrations 480, 510) and waterjet (migration 511) already
--          got the equivalent treatment from this same "Turret Press (Punch
--          Press)" / already-staged machine_library export (migration 508);
--          turret_punch was the one category left unreconciled.
--
--          Exactly ONE real, unambiguous name match found: the export's
--          "Turret Press (Punch Press):Amada EM-3510 ZRT" (case/hyphen
--          differences only from the live "Amada em 3510 ZRT" -- same real
--          machine). Source fields -> live columns:
--            press_force_kn 300.0 / 9.80665 = 30.59 t         -> max_tonnage
--            max_sheet_length_mm 2500.0                        -> max_x_mm
--            max_sheet_width_mm  1275.0                        -> max_y_mm
--            max_thickness_steel_mm            6.0             -> max_thickness_ms_mm
--            max_thickness_stainless_steel_mm  4.5             -> max_thickness_ss_mm
--            max_thickness_aluminum_mm         6.0             -> max_thickness_al_mm
--            max_thickness_copper_mm           6.0             -> max_thickness_cu_mm
--          (brass 6.0 has no corresponding mhr_records column -- left
--          unstored, same as every other category's reconciliation when a
--          source field has nowhere real to go.)
--
--          max_thickness_mm (the ONE column turret_punch's own isCapable()
--          check actually reads today -- selector.ts has no per-material
--          gating for turret_punch the way it does for laser via
--          laserThicknessLimit()) is set to 4.5, the MINIMUM across the
--          machine's real per-material limits above, not the steel value --
--          a single generic ceiling must never overstate capability for the
--          worst-case material (stainless here). Storing the real per-
--          material columns alongside it (unused by turret_punch selection
--          today) means a future material-aware turret_punch gating fix
--          (mirroring laser's) needs zero additional backfill.
--
--          capability_source explicitly set to 'imported' -- this is now
--          real catalog data, not a seed/name-parsed guess.
-- Author: Principal Engineering Team
-- Date: 2026-08-21
-- Version: 1.0.0
-- ============================================================================

UPDATE mhr_records
SET
  max_tonnage         = 30.59,
  max_x_mm             = 2500.0,
  max_y_mm             = 1275.0,
  max_thickness_mm     = 4.5,
  max_thickness_ms_mm  = 6.0,
  max_thickness_ss_mm  = 4.5,
  max_thickness_al_mm  = 6.0,
  max_thickness_cu_mm  = 6.0,
  capability_source    = 'imported'
WHERE machine_class = 'turret_punch'
  AND location = 'USA'
  AND lower(machine_name) = lower('Amada em 3510 ZRT')
  AND max_tonnage IS NULL;
