-- ============================================================================
-- Migration: Seed real Chemical Conversion Coating rates (USA/Germany/China)
-- Purpose: "Chemical Conversion Coating" (chromate conversion / chem film,
--          e.g. MIL-DTL-5541 on aluminum) had NO dedicated row in
--          surface_treatment_rates at all -- a drawing callout for it was
--          silently routed to the generic '__default__' bucket by
--          classifySurfaceTreatment()'s catch-all "coat" match, pricing it
--          with an unrelated fallback rate instead of a real one. Real,
--          region-specific per-m2 rates found in a reference cost-parameter
--          document (memory/sheetmetal/laser_cutting_costing_params (1).md,
--          section 7): USA $25.04/m2, Germany $21.70/m2, China $16.70/m2.
--
--          min_lot_charge_usd has NO source in that same document (only
--          per-m2 + a single 0.11m2 worked example were given). Per this
--          project's no-guessing standard, defaulted to the column's own
--          schema default (0) rather than inventing a minimum-lot figure --
--          NOT a confirmed "no minimum" fact, disclosed explicitly in notes.
-- Author: Principal Engineering Team
-- Date: 2026-08-19
-- Version: 1.0.0
-- ============================================================================

INSERT INTO surface_treatment_rates (treatment_type, label, location, rate_per_m2_usd, min_lot_charge_usd, process_operation, notes)
VALUES
  ('chem_conversion_coating', 'Chemical Conversion Coating', 'USA',     25.04, 0, 'Chemical Conversion Coating', 'Real per-m2 rate sourced from a reference cost-parameter document. min_lot_charge_usd NOT sourced -- defaulted to 0, NOT a confirmed "no minimum" fact; verify before relying on it for small-lot quotes.'),
  ('chem_conversion_coating', 'Chemical Conversion Coating', 'Germany', 21.70, 0, 'Chemical Conversion Coating', 'Real per-m2 rate sourced from a reference cost-parameter document. min_lot_charge_usd NOT sourced -- defaulted to 0, NOT a confirmed "no minimum" fact; verify before relying on it for small-lot quotes.'),
  ('chem_conversion_coating', 'Chemical Conversion Coating', 'China',   16.70, 0, 'Chemical Conversion Coating', 'Real per-m2 rate sourced from a reference cost-parameter document. min_lot_charge_usd NOT sourced -- defaulted to 0, NOT a confirmed "no minimum" fact; verify before relying on it for small-lot quotes.')
ON CONFLICT (treatment_type, location) DO NOTHING;
