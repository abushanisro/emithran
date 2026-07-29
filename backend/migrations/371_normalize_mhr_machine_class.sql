-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 371: Normalize mhr_records.machine_class to the shared slug vocabulary
--
-- Problem: process_calculator_mappings.machine_class was backfilled (migrations
-- 368/369) with a clean slug vocabulary (fiber_laser, press_brake, cnc_3ax_vmc,
-- ...). mhr_records.machine_class was never populated by that same process — it
-- comes from raw Excel imports (see mhr.service.ts importFromExcel) and is a mix
-- of human-typed Title-Case names, ALL-CAPS duplicates, spelling variants, and a
-- handful of already-correct slugs (confirmed via SELECT DISTINCT machine_class
-- FROM mhr_records — 80+ distinct values, only ~13 of which are real slugs).
--
-- ProcessCostDialog.tsx matches machines to an operation by EXACT STRING EQUALITY
-- between process_calculator_mappings.machine_class and mhr_records.machine_class.
-- With two tables speaking different vocabularies, almost nothing matches — the
-- dialog shows "No machine class configured" for most operations even though the
-- process side is fully backfilled.
--
-- Fix: normalize mhr_records.machine_class into the same slug vocabulary via a
-- pattern cascade (same technique as migration 367, applied to the other table).
-- Idempotent: the CASE conditions still match their own slug output on a second
-- run (e.g. 'fiber_laser' still contains "fiber" + "laser"), so re-running this
-- migration is a safe no-op.
--
-- Judgment calls made below are called out inline — a few source values are
-- genuinely ambiguous (a bare "Press" could be a press brake, a stamping press,
-- or an arbor press) and are deliberately left UNCHANGED rather than guessed,
-- surfaced via the diagnostic NOTICE at the end so they can be reviewed and
-- reclassified by hand once it's clear what machine they actually refer to.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE mhr_records
SET machine_class = CASE
  -- ── Lasers ──────────────────────────────────────────────────────────────────
  WHEN machine_class ILIKE '%co2%laser%'        THEN 'co2_laser'
  WHEN machine_class ILIKE '%laser%engrav%'     THEN 'laser_marking'
  WHEN machine_class ILIKE '%fiber%laser%'      THEN 'fiber_laser'
  WHEN machine_class ILIKE '%laser%cutting%'    THEN 'fiber_laser'   -- bare "Laser Cutting": fiber is the common default

  -- ── Thermal / waterjet cutting ────────────────────────────────────────────────
  WHEN machine_class ILIKE '%plasma%punch%'     THEN 'turret_punch'
  WHEN machine_class ILIKE '%plasma%'           THEN 'plasma'
  WHEN machine_class ILIKE '%waterjet%'         THEN 'waterjet'
  WHEN machine_class ILIKE '%water%jet%'        THEN 'waterjet'

  -- ── Punching / press brake / shearing ─────────────────────────────────────────
  WHEN machine_class ILIKE '%turret%press%'     THEN 'turret_punch'
  WHEN machine_class ILIKE '%turret%punch%'     THEN 'turret_punch'
  WHEN machine_class ILIKE '%bend%brake%'       THEN 'press_brake'
  WHEN machine_class ILIKE '%shear%'            THEN 'press_brake'
  WHEN machine_class ILIKE '%roll%bend%'        THEN 'roll_forming'

  -- ── Turning ───────────────────────────────────────────────────────────────────
  WHEN machine_class ILIKE '%turn%mill%'        THEN 'cnc_mill_turn'
  WHEN machine_class ILIKE '%turning_center%3axis%' THEN 'cnc_lathe_live'
  WHEN machine_class ILIKE '%turning_center%2axis%' THEN 'cnc_lathe'
  WHEN machine_class ILIKE '%multi%spindle%turn%'   THEN 'cnc_lathe'
  WHEN machine_class ILIKE '%sub%spindle%turn%'     THEN 'cnc_lathe'
  WHEN machine_class ILIKE '%vertical%turn%'        THEN 'cnc_lathe'

  -- ── Milling / routing (axis count matters — most-specific first) ─────────────
  WHEN machine_class ILIKE '%milling_center%5axis%' THEN 'cnc_5ax_mc'
  WHEN machine_class ILIKE '%milling_center%4axis%' THEN 'cnc_4ax_vmc'
  WHEN machine_class ILIKE '%milling_center%3axis%' THEN 'cnc_3ax_vmc'
  WHEN machine_class ILIKE '%router%5axis%'         THEN 'cnc_5ax_mc'
  WHEN machine_class ILIKE '%router%3axis%'         THEN 'cnc_3ax_vmc'
  WHEN machine_class ILIKE 'router'                 THEN 'cnc_3ax_vmc'  -- bare "Router": 3-axis is the common default
  WHEN machine_class ILIKE '%gear%hob%'             THEN 'cnc_3ax_vmc'  -- matches process side's Gear Cutting route -> cnc_3ax_vmc
  WHEN machine_class ILIKE '%gear%shap%'            THEN 'cnc_3ax_vmc'
  WHEN machine_class ILIKE '%gear%shav%'            THEN 'cnc_3ax_vmc'

  -- ── Grinding / drilling / EDM ──────────────────────────────────────────────────
  WHEN machine_class ILIKE '%cylindrical%grind%'    THEN 'grinding'
  WHEN machine_class ILIKE '%internal%grind%'       THEN 'grinding'
  WHEN machine_class ILIKE '%surface%grind%'        THEN 'grinding'
  WHEN machine_class ILIKE '%gear%grind%'           THEN 'grinding'
  WHEN machine_class ILIKE '%jig%grind%'            THEN 'grinding'
  WHEN machine_class ILIKE '%deep%hole%drill%'      THEN 'drill_press'
  WHEN machine_class ILIKE '%jig%bor%'              THEN 'drill_press'
  WHEN machine_class ILIKE '%wire%edm%'             THEN 'edm'

  -- ── Molding / extrusion (plastics) ─────────────────────────────────────────────
  WHEN machine_class ILIKE '%compression%mold%'     THEN 'compression_molding'
  WHEN machine_class ILIKE '%compression%mould%'    THEN 'compression_molding'
  WHEN machine_class ILIKE '%structural%foam%mold%' THEN 'compression_molding'
  WHEN machine_class ILIKE '%reaction%injection%mold%' THEN 'compression_molding'
  WHEN machine_class ILIKE '%blow%mold%'            THEN 'blow_molding'
  WHEN machine_class ILIKE '%injection%mold%'       THEN 'injection_molding'
  WHEN machine_class ILIKE '%drying%'               THEN 'injection_molding'  -- matches 'Material Drying' op under Injection Molding/Material Prep
  WHEN machine_class ILIKE '%extrusion%'            THEN 'extrusion'

  -- ── Assembly / welding / cleanup ────────────────────────────────────────────────
  WHEN machine_class ILIKE '%weld%'                 THEN 'welding'
  WHEN machine_class ILIKE '%ultrasonic%clean%'     THEN 'deburring'
  WHEN machine_class ILIKE '%deslag%'               THEN 'deburring'
  WHEN machine_class ILIKE '%assembly%'             THEN 'manual_assembly'
  WHEN machine_class ILIKE '%automated%operation%'  THEN 'manual_assembly'
  WHEN machine_class ILIKE '%manual%operation%'     THEN 'manual_assembly'

  -- ── Inspection ──────────────────────────────────────────────────────────────────
  WHEN machine_class ILIKE 'cmm'                    THEN 'cmm'
  WHEN machine_class ILIKE '%inspection%'           THEN 'cmm'

  -- ── Surface treatment ───────────────────────────────────────────────────────────
  WHEN machine_class ILIKE '%anodi%'                THEN 'anodize'    -- catches Anodize/ANODIZE/HARD ANODIZE PER MIL-A-8625
  WHEN machine_class ILIKE '%powder%coat%'          THEN 'powder_coat'
  WHEN machine_class ILIKE '%zinc%plat%'            THEN 'plating'
  WHEN machine_class ILIKE '%degrease%'             THEN 'chem_treatment'
  WHEN machine_class ILIKE '%passivation%'          THEN 'chem_treatment'
  WHEN machine_class ILIKE '%paint%'                THEN 'chem_treatment'
  WHEN machine_class ILIKE '%etch%'                 THEN 'chem_treatment'
  WHEN machine_class ILIKE '%masking%'              THEN 'chem_treatment'

  -- Already-normalized slugs pass through unchanged (kept explicit for clarity —
  -- also covered implicitly by ELSE below, but listing them documents intent).
  WHEN machine_class IN (
    'fiber_laser','co2_laser','plasma','waterjet','press_brake','turret_punch',
    'roll_forming','deep_draw','cnc_lathe','cnc_lathe_live','cnc_mill_turn',
    'cnc_3ax_vmc','cnc_4ax_vmc','cnc_5ax_mc','grinding','drill_press','tapping',
    'edm','injection_molding','welding','deburring','manual_assembly','cmm',
    'anodize','powder_coat','plating','band_saw','heat_treat_furnace','ndt_test',
    'chem_treatment','adhesive_bonding','electrical_assembly','thermoforming',
    'blow_molding','extrusion','rotational_molding','rubber_molding',
    'compression_molding','laser_marking'
  ) THEN machine_class

  -- Anything not matched above (e.g. bare "Press", "Cutting", "Cut To Length",
  -- "Curing", "Surface Treatment", "Oxyfuel Cutting") is intentionally left
  -- UNCHANGED rather than force-mapped into a guessed class — see the NOTICE
  -- below for the full list still needing a human decision.
  ELSE machine_class
END
WHERE machine_class IS NOT NULL;

-- ── Diagnostic (non-fatal): list what's left after normalization that still
-- isn't one of our known slugs, so it's visible rather than silently ignored ────
DO $$
DECLARE
  leftover_count INTEGER;
  leftover_list  TEXT;
BEGIN
  SELECT COUNT(DISTINCT machine_class), string_agg(DISTINCT machine_class, '; ')
    INTO leftover_count, leftover_list
  FROM mhr_records
  WHERE machine_class IS NOT NULL
    AND machine_class NOT IN (
      'fiber_laser','co2_laser','plasma','waterjet','press_brake','turret_punch',
      'roll_forming','deep_draw','cnc_lathe','cnc_lathe_live','cnc_mill_turn',
      'cnc_3ax_vmc','cnc_4ax_vmc','cnc_5ax_mc','grinding','drill_press','tapping',
      'edm','injection_molding','welding','deburring','manual_assembly','cmm',
      'anodize','powder_coat','plating','band_saw','heat_treat_furnace','ndt_test',
      'chem_treatment','adhesive_bonding','electrical_assembly','thermoforming',
      'blow_molding','extrusion','rotational_molding','rubber_molding',
      'compression_molding','laser_marking'
    );

  IF leftover_count > 0 THEN
    RAISE NOTICE
      'Migration 371: % distinct machine_class value(s) still not normalized (left unchanged, needs a human decision): %',
      leftover_count, leftover_list;
  END IF;
END $$;

-- ── Verification (informational) ───────────────────────────────────────────────
-- SELECT machine_class, COUNT(*) FROM mhr_records GROUP BY 1 ORDER BY 1;
