-- ============================================================================
-- Migration: Label press_brake rows with real backfilled tonnage as 'imported'
-- Purpose: P0.6 closeout residual finding (P0 Final Acceptance Audit, Area 1).
--          "Bend Brake-1500kN" (153.00t), "Bend Brake-2500kN" (254.90t), and
--          "Bend Brake-800kN" (81.60t) all carry real max_tonnage values
--          backfilled by earlier migrations (480_press_brake_kn_tonnage_backfill,
--          510_backfill_press_brake_tonnage_from_machine_library) from the same
--          licensed reference export used throughout this reconciliation --
--          but capability_source was never set on them, left NULL.
--
--          Functionally harmless today: hydrateCapability() (selector.ts)
--          defaults a NULL capability_source to 'imported' whenever real
--          numeric capability data exists on the row (`row.capability_source
--          ?? 'imported'`), so these three rows already behave as imported,
--          high-confidence data at runtime. This migration only makes the
--          stored column say what's already true, for anyone reading the
--          table directly (admin UI, future audits, other reconciliation
--          passes) without re-deriving that inference themselves.
--
--          Guarded to only touch rows that are both real (max_tonnage set)
--          and unlabeled (capability_source IS NULL) -- does not touch
--          "Press Brake 80T (2500mm)", which is already correctly labeled
--          'benchmark'.
-- Author: Principal Engineering Team
-- Date: 2026-08-22
-- Version: 1.0.0
-- ============================================================================

UPDATE mhr_records
SET capability_source = 'imported'
WHERE machine_class = 'press_brake'
  AND max_tonnage IS NOT NULL
  AND capability_source IS NULL;
