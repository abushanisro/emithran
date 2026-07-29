-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 367: Add machine_class to mhr_benchmark_rates (2026-07-22)
--
-- Problem: mhr_benchmark_rates has no machine_class column, so the benchmark
-- API can only filter by process_group ('Sheet Metal'). All sheet metal
-- benchmark machines (fiber laser, turret punch, press brake, deburring) are
-- returned together. The dialog auto-selects the first alphabetically —
-- 'CNC Turret Punch' — even for a fiber laser operation.
--
-- Fix: Add machine_class TEXT column, populate via pattern-matching on
-- machine_name, then expose it through GET /api/mhr/benchmark?machineClass=.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CASE-based UPDATEs with ON CONFLICT.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── 1. Add column ─────────────────────────────────────────────────────────────
ALTER TABLE mhr_benchmark_rates
  ADD COLUMN IF NOT EXISTS machine_class TEXT;

-- ── 2. Populate based on machine_name patterns ────────────────────────────────
UPDATE mhr_benchmark_rates
SET machine_class = CASE
  -- Fiber / CO2 lasers
  WHEN machine_name ILIKE '%Fiber Laser%'      THEN 'fiber_laser'
  WHEN machine_name ILIKE '%CO2 Laser%'         THEN 'co2_laser'
  WHEN machine_name ILIKE '%Laser%'             THEN 'fiber_laser'

  -- Turret punch / CNC punch
  WHEN machine_name ILIKE '%Turret Punch%'      THEN 'turret_punch'
  WHEN machine_name ILIKE '%CNC Punch%'         THEN 'turret_punch'
  WHEN machine_name ILIKE '%Punch%'             THEN 'turret_punch'

  -- Waterjet
  WHEN machine_name ILIKE '%Waterjet%'          THEN 'waterjet'
  WHEN machine_name ILIKE '%Water Jet%'         THEN 'waterjet'
  WHEN machine_name ILIKE '%Abrasive Jet%'      THEN 'waterjet'

  -- Press brake / bending
  WHEN machine_name ILIKE '%Press Brake%'       THEN 'press_brake'
  WHEN machine_name ILIKE '%Bending Machine%'   THEN 'press_brake'
  WHEN machine_name ILIKE '%Bend Brake%'        THEN 'press_brake'

  -- Deburring / finishing
  WHEN machine_name ILIKE '%Deburr%'            THEN 'deburring'
  WHEN machine_name ILIKE '%Debur%'             THEN 'deburring'
  WHEN machine_name ILIKE '%Finishing Cell%'    THEN 'deburring'

  -- Welding
  WHEN machine_name ILIKE '%Weld%'              THEN 'welding'
  WHEN machine_name ILIKE '%MIG%'               THEN 'welding'
  WHEN machine_name ILIKE '%TIG%'               THEN 'welding'

  -- CMM / quality
  WHEN machine_name ILIKE '%CMM%'               THEN 'cmm'
  WHEN machine_name ILIKE '%Coordinate Measuring%' THEN 'cmm'
  WHEN machine_name ILIKE '%Inspection%'        THEN 'cmm'

  -- Grinding
  WHEN machine_name ILIKE '%Surface Grinder%'   THEN 'grinding'
  WHEN machine_name ILIKE '%Cylindrical Grinder%' THEN 'grinding'
  WHEN machine_name ILIKE '%Grinder%'           THEN 'grinding'

  -- Drill press
  WHEN machine_name ILIKE '%Drill Press%'       THEN 'drill_press'
  WHEN machine_name ILIKE '%Drill%'             THEN 'drill_press'

  -- CNC mill-turn / turn-mill
  WHEN machine_name ILIKE '%Mill-Turn%'         THEN 'cnc_mill_turn'
  WHEN machine_name ILIKE '%Turn-Mill%'         THEN 'cnc_mill_turn'
  WHEN machine_name ILIKE '%Mill Turn%'         THEN 'cnc_mill_turn'
  WHEN machine_name ILIKE '%Multitask%'         THEN 'cnc_mill_turn'

  -- CNC lathe / turning
  WHEN machine_name ILIKE '%Lathe%'             THEN 'cnc_lathe'
  WHEN machine_name ILIKE '%Turning Center%'    THEN 'cnc_lathe_live'
  WHEN machine_name ILIKE '%CNC Lathe%'         THEN 'cnc_lathe'

  -- 5-axis machining
  WHEN machine_name ILIKE '%5-Axis%'            THEN 'cnc_5ax_mc'
  WHEN machine_name ILIKE '%5 Axis%'            THEN 'cnc_5ax_mc'
  WHEN machine_name ILIKE '%Five Axis%'         THEN 'cnc_5ax_mc'

  -- 4-axis VMC
  WHEN machine_name ILIKE '%4-Axis%'            THEN 'cnc_4ax_vmc'
  WHEN machine_name ILIKE '%4 Axis%'            THEN 'cnc_4ax_vmc'

  -- CNC VMC / machining center (3-axis, catch-all for mills)
  WHEN machine_name ILIKE '%VMC%'               THEN 'cnc_3ax_vmc'
  WHEN machine_name ILIKE '%Vertical Mill%'     THEN 'cnc_3ax_vmc'
  WHEN machine_name ILIKE '%Machining Center%'  THEN 'cnc_3ax_vmc'
  WHEN machine_name ILIKE '%Milling%'           THEN 'cnc_3ax_vmc'
  WHEN machine_name ILIKE '%CNC Mill%'          THEN 'cnc_3ax_vmc'

  -- Surface treatment
  WHEN machine_name ILIKE '%Anodize%'           THEN 'anodize'
  WHEN machine_name ILIKE '%Anodizing%'         THEN 'anodize'
  WHEN machine_name ILIKE '%Powder Coat%'       THEN 'powder_coat'
  WHEN machine_name ILIKE '%Electroplat%'       THEN 'plating'
  WHEN machine_name ILIKE '%Plat%'              THEN 'plating'

  -- Assembly
  WHEN machine_name ILIKE '%Assembly%'          THEN 'manual_assembly'
  WHEN machine_name ILIKE '%Manual%'            THEN 'manual_assembly'

  -- Injection molding
  WHEN machine_name ILIKE '%Injection Mold%'    THEN 'injection_molding'
  WHEN machine_name ILIKE '%Molding%'           THEN 'injection_molding'

  -- Tapping
  WHEN machine_name ILIKE '%Tap%'               THEN 'tapping'

  ELSE NULL
END
WHERE machine_class IS NULL;

-- ── 3. Index for fast filtering by machineClass + location ────────────────────
CREATE INDEX IF NOT EXISTS idx_mhr_benchmark_machine_class
  ON mhr_benchmark_rates (machine_class, location);

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT machine_class, COUNT(*), array_agg(DISTINCT machine_name ORDER BY machine_name)
-- FROM mhr_benchmark_rates
-- GROUP BY machine_class
-- ORDER BY machine_class;
--
-- All rows should have a non-NULL machine_class.
-- SELECT COUNT(*) FROM mhr_benchmark_rates WHERE machine_class IS NULL;
-- Expected: 0 (or very few for truly unknown machines)
