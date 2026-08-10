-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 445: Backfill machine_class for India's migration-183 mhr_records
-- seed batch (2026-08-08)
--
-- Root cause of "No dedicated CMM machine on file for India (real or
-- benchmark)": database/migrations/183_seed_india_mhr_lhr_fix_im_family.sql's
-- INSERT INTO mhr_records column list never included machine_class —
-- 'CMM (Small)' (commodity_code='SM-CMM-SM', a real, correctly-priced
-- ₹2000/hr row) has machine_class = NULL. BOMItemsService.resolveCmmSpecificRate
-- queries mhr_records with `.eq('machine_class', 'cmm')` and no other
-- fallback — a NULL machine_class can never match that filter, so the row
-- is invisible to it even though the real rate data has been there all
-- along. (Other India rows from the same batch — CNC VMC/Lathe, Fiber
-- Laser, Press Brake, Injection Molding, Deburring Bench — resolve fine
-- today via resolveMHRRates' commodity_code/keyword fallback passes, which
-- don't require machine_class; this backfill is still worth doing for them
-- since it's the correct, complete classification and other machine_class-
-- keyed code paths may exist or be added later.)
--
-- Mapping: default-rates.ts's MACHINE_REGISTRY already lists every one of
-- migration 183's commodity codes under a real class (SM-CMM-SM under
-- 'cmm', SM-BRAKE-80T/160T under 'press_brake', etc.) — this migration just
-- writes that already-authoritative mapping onto the rows that were never
-- given it. SM-EDM-WIRE and SM-GRIND-CYL have no registered MACHINE_REGISTRY
-- class today (no EDM/grinding cost-engine process consumes machine_class
-- for them yet) — left untouched rather than inventing a class no code
-- reads.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE mhr_records
SET machine_class = CASE commodity_code
  WHEN 'SM-VMC-3AX'   THEN 'cnc_3ax_vmc'
  WHEN 'SM-VMC-5AX'   THEN 'cnc_5ax_mc'
  WHEN 'SM-LATHE-2AX' THEN 'cnc_lathe'
  WHEN 'SM-LASER-6KW' THEN 'fiber_laser'
  WHEN 'SM-LASER-2KW' THEN 'fiber_laser'
  WHEN 'SM-BRAKE-160T' THEN 'press_brake'
  WHEN 'SM-BRAKE-80T'  THEN 'press_brake'
  WHEN 'SM-IM-100T'   THEN 'injection_molding'
  WHEN 'SM-IM-200T'   THEN 'injection_molding'
  WHEN 'SM-IM-500T'   THEN 'injection_molding'
  WHEN 'SM-CMM-SM'    THEN 'cmm'
  WHEN 'SM-DEBURR'    THEN 'deburring'
  ELSE machine_class
END
WHERE commodity_code IN (
  'SM-VMC-3AX', 'SM-VMC-5AX', 'SM-LATHE-2AX', 'SM-LASER-6KW', 'SM-LASER-2KW',
  'SM-BRAKE-160T', 'SM-BRAKE-80T', 'SM-IM-100T', 'SM-IM-200T', 'SM-IM-500T',
  'SM-CMM-SM', 'SM-DEBURR'
)
AND machine_class IS NULL;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT machine_name, commodity_code, machine_class, location
-- FROM mhr_records WHERE commodity_code = 'SM-CMM-SM';
-- Expect machine_class = 'cmm' for the India row.
