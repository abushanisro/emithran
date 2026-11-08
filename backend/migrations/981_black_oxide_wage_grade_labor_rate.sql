-- ============================================================================
-- Migration 981: Black Oxide machines take the labor rate of their wage grade
-- ============================================================================
-- memory/SurfaceTreatment/Machine/black_oxide_machines.csv leaves Labor Rate and
-- Wage Grade Name blank, so migration 820 seeded those rows with no labor rate and
-- the costing engine (rightly) did not price them. The process has a wage grade:
-- memory/SurfaceTreatment/surface_treatment_wage_grades.csv puts Black Oxide on
-- "2 - Metal", and every other surface machine of that grade carries one labor
-- rate per location (29.95 USD/hr in the USA). Each Black Oxide row takes that
-- rate for its own location, only when the other machines of the grade agree on
-- one value and the row has none. Idempotent; never overwrites a stated rate.
-- ============================================================================

DO $st981$
DECLARE
  n integer;
BEGIN
  WITH grade2 AS (
    SELECT location, min(usd_labor_rate_per_hr) AS rate
    FROM mhr_records
    WHERE machine_class IN ('surface_anodize', 'surface_bead_blast', 'surface_cadmium_plating', 'surface_conveyor_abrasive_finishing', 'surface_conveyor_conversion_coating', 'surface_conveyor_dry', 'surface_conveyor_oven_cure', 'surface_conveyor_part_loading', 'surface_conveyor_part_unloading', 'surface_conveyor_powder_coating', 'surface_conveyor_shot_blast', 'surface_decorative_chrome_plating', 'surface_degrease', 'surface_dot_peen', 'surface_hard_chrome_plating', 'surface_laser_engraving', 'surface_mask_bench', 'surface_nickel_plating', 'surface_oven_cure', 'surface_painting', 'surface_passivation', 'surface_powder_coat_cart', 'surface_sand_blast', 'surface_screen_printing', 'surface_shot_blast', 'surface_shot_peen', 'surface_vibratory_finishing', 'surface_wet_coat_line', 'surface_zinc_nickel_plating', 'surface_zinc_plating')
      AND usd_labor_rate_per_hr IS NOT NULL
    GROUP BY location
    HAVING count(DISTINCT usd_labor_rate_per_hr) = 1
  )
  UPDATE mhr_records m
  SET usd_labor_rate_per_hr = grade2.rate,
      usd_lhr_total = grade2.rate
  FROM grade2
  WHERE m.machine_class = 'surface_black_oxide'
    AND m.location = grade2.location
    AND m.usd_labor_rate_per_hr IS NULL
    AND m.usd_lhr_total IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Black Oxide: % machine rows took their wage-grade labor rate', n;
END
$st981$;

NOTIFY pgrst, 'reload schema';
