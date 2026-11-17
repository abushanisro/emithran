-- ============================================================================
-- Migration 1044: Die Casting machines beside the press, India rates (USA twin cloned at India rates)
-- ============================================================================
-- India had only the casting machines themselves (High Pressure Die Casting, Gravity Die Casting; migration 845).
-- Every other step of a die-cast part (melting, trim, cleaning, finishing, coremaking, core coating and drying,
-- visual inspection) had USA machines only, so an India part showed "no machine in HR Rates" on each of them.
--
-- Source: memory/Countries data/India_XML_Data_.csv, commodity "Casting - Die": each machine's direct and indirect
-- overhead rate (USD/hr, rounded to cents as migration 845 does). Labour: the India rate of the machine's wage grade,
-- the value every India casting row already carries (2 - Casting 2.14, 3 - Casting 2.25, 4 - Casting 2.99,
-- 2 - Metal 1.65 USD/hr; migrations 845, 848, 870).
-- 154 machines, each matched by machine type and exact name to its USA row:
--   Cleaning                   20 machine(s)
--   Core Refractory Coat       1 machine(s)
--   Coremaking                 31 machine(s)
--   Finishing                  4 machine(s)
--   Melting                    24 machine(s)
--   Refractory Coat Air Dry    1 machine(s)
--   Refractory Coat Oven Dry   35 machine(s)
--   Trim                       37 machine(s)
--   Visual Inspection          1 machine(s)
--
-- Idempotent: an India row already present for a machine_class + machine_name is skipped (the guard of migrations
-- 845 and 870; mhr_records has no unique constraint to ON CONFLICT on).
-- Verify: SELECT machine_class, count(*) FROM mhr_records WHERE process_group = 'Die Casting' AND location = 'India'
--   GROUP BY 1 ORDER BY 1;  -- expect 11 classes, 237 rows.
-- ============================================================================

DO $india1044$
DECLARE
  cols text; sel text; r record; usa_id uuid; n integer := 0; missing text[] := '{}';
BEGIN
  SELECT
    string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position),
    string_agg(
      CASE c.column_name
        WHEN 'location'                                THEN '''India'''
        WHEN 'country_code'                            THEN '''IN'''
        WHEN 'direct_overhead_rate'                    THEN '$2'
        WHEN 'indirect_overhead_rate'                  THEN '$3'
        WHEN 'benchmark_direct_overhead_rate_usd_hr'   THEN '$2'
        WHEN 'benchmark_indirect_overhead_rate_usd_hr' THEN '$3'
        WHEN 'total_machine_hour_rate'                 THEN 'ROUND(($2 + $3)::numeric, 2)'
        WHEN 'mhr_usd_per_hour'                        THEN 'ROUND(($2 + $3)::numeric, 2)'
        WHEN 'manual_mhr_value'                        THEN 'ROUND(($2 + $3)::numeric, 2)'
        WHEN 'fully_burdened_local_per_hr'             THEN 'ROUND(($2 + $3)::numeric, 2)'
        WHEN 'usd_labor_rate_per_hr'                   THEN '$4'
        WHEN 'benchmark_labor_rate_usd_hr'             THEN '$4'
        WHEN 'benchmark_source_key'                    THEN 'usa_row.benchmark_source_key || '':India'''
        WHEN 'id'                                      THEN 'gen_random_uuid()'
        WHEN 'created_at'                              THEN 'now()'
        WHEN 'updated_at'                              THEN 'now()'
        ELSE 'usa_row.' || quote_ident(c.column_name)
      END, ', ' ORDER BY c.ordinal_position
    )
  INTO cols, sel
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'mhr_records' AND c.is_generated = 'NEVER';

  FOR r IN SELECT * FROM (VALUES
  ($str$die_casting_cleaning$str$, $str$Chamber Blast$str$, 2.14, 2.11, 0.97),
  ($str$die_casting_cleaning$str$, $str$Goff 1-1/2 Cu Ft$str$, 2.14, 2.02, 0.95),
  ($str$die_casting_cleaning$str$, $str$Goff 12 Cu Ft S$str$, 2.14, 4.28, 1.12),
  ($str$die_casting_cleaning$str$, $str$Goff 2-1/2 Cu Ft$str$, 2.14, 2.11, 0.97),
  ($str$die_casting_cleaning$str$, $str$Goff 24 Cu Ft$str$, 2.14, 6.7, 1.21),
  ($str$die_casting_cleaning$str$, $str$Goff 3 Cu Ft$str$, 2.14, 2.32, 1.0),
  ($str$die_casting_cleaning$str$, $str$Goff 48 S$str$, 2.14, 7.35, 1.15),
  ($str$die_casting_cleaning$str$, $str$Goff 6 Cu Ft S$str$, 2.14, 3.28, 1.06),
  ($str$die_casting_cleaning$str$, $str$Goff 60 S$str$, 2.14, 8.32, 1.25),
  ($str$die_casting_cleaning$str$, $str$Goff 72 D$str$, 2.14, 9.85, 1.15),
  ($str$die_casting_cleaning$str$, $str$Goff 72 S$str$, 2.14, 9.56, 1.36),
  ($str$die_casting_cleaning$str$, $str$Goff 72 SWING$str$, 2.14, 12.17, 2.25),
  ($str$die_casting_cleaning$str$, $str$Goff 96 XT$str$, 2.14, 18.52, 1.52),
  ($str$die_casting_cleaning$str$, $str$Room Blast$str$, 2.14, 30.73, 4.92),
  ($str$die_casting_cleaning$str$, $str$Table Blast - 2,250kg Load Capacity$str$, 2.14, 9.39, 1.35),
  ($str$die_casting_cleaning$str$, $str$Table Blast - 3,250kg Load Capacity$str$, 2.14, 11.73, 1.42),
  ($str$die_casting_cleaning$str$, $str$Table Blast - 4,500kg Load Capacity$str$, 2.14, 14.66, 2.17),
  ($str$die_casting_cleaning$str$, $str$Tumbler - 1,400kg Load Capacity$str$, 2.14, 6.5, 1.22),
  ($str$die_casting_cleaning$str$, $str$Tumbler - 200kg Load Capacity$str$, 2.14, 2.32, 0.96),
  ($str$die_casting_cleaning$str$, $str$Tumbler - 750kg Load Capacity$str$, 2.14, 4.29, 1.1),
  ($str$die_casting_core_refractory_coat$str$, $str$Default$str$, 1.65, 0.0, 0.86),
  ($str$die_casting_coremaking$str$, $str$Beardsley & Piper CB-15-CC$str$, 2.14, 11.05, 1.51),
  ($str$die_casting_coremaking$str$, $str$Beardsley & Piper CB-184-CC$str$, 2.14, 12.26, 1.51),
  ($str$die_casting_coremaking$str$, $str$Beardsley & Piper CB-254-CC$str$, 2.14, 12.26, 1.51),
  ($str$die_casting_coremaking$str$, $str$Beardsley & Piper CB-30-CC$str$, 2.14, 11.05, 1.51),
  ($str$die_casting_coremaking$str$, $str$Beardsley & Piper CB-40-CC$str$, 2.14, 11.05, 1.51),
  ($str$die_casting_coremaking$str$, $str$Coremaker - 1,000mm x 850mm x 700mm (LxWxH) Corebox$str$, 2.14, 12.0, 1.49),
  ($str$die_casting_coremaking$str$, $str$Coremaker - 1,500mm x 1,500mm x 1,340mm (LxWxH) Corebox$str$, 2.14, 13.48, 1.56),
  ($str$die_casting_coremaking$str$, $str$Coremaker - 650mm x 450mm x 450mm (LxWxH) Corebox$str$, 2.14, 10.78, 1.43),
  ($str$die_casting_coremaking$str$, $str$Coremaker 50mm Smallest Core - 890mm x 870mm x 630mm (LxWxH) Corebox$str$, 2.14, 13.62, 2.03),
  ($str$die_casting_coremaking$str$, $str$DISACORE 10 MP$str$, 2.14, 7.33, 1.2),
  ($str$die_casting_coremaking$str$, $str$DISACORE 120 MP$str$, 2.14, 12.26, 1.82),
  ($str$die_casting_coremaking$str$, $str$DISACORE 20 MP$str$, 2.14, 11.0, 1.37),
  ($str$die_casting_coremaking$str$, $str$DISACORE 20 TP$str$, 2.14, 12.21, 1.61),
  ($str$die_casting_coremaking$str$, $str$DISACORE 200 MP$str$, 2.14, 13.48, 1.95),
  ($str$die_casting_coremaking$str$, $str$DISACORE 300-25L$str$, 2.14, 13.48, 1.27),
  ($str$die_casting_coremaking$str$, $str$DISACORE 300-40L$str$, 2.14, 13.48, 1.27),
  ($str$die_casting_coremaking$str$, $str$DISACORE 40 MP$str$, 2.14, 13.48, 1.49),
  ($str$die_casting_coremaking$str$, $str$DISACORE 40 TP$str$, 2.14, 8.52, 1.64),
  ($str$die_casting_coremaking$str$, $str$DISACORE 60 TP$str$, 2.14, 8.52, 1.49),
  ($str$die_casting_coremaking$str$, $str$DISACORE 80 MP$str$, 2.14, 17.2, 1.49),
  ($str$die_casting_coremaking$str$, $str$DISACORE 80 TP$str$, 2.14, 17.2, 1.93),
  ($str$die_casting_coremaking$str$, $str$Laempe LL20$str$, 2.14, 13.62, 2.03),
  ($str$die_casting_coremaking$str$, $str$Redford CB-12-SA$str$, 2.14, 13.37, 2.48),
  ($str$die_casting_coremaking$str$, $str$Redford CB-16-SA$str$, 2.14, 13.37, 2.48),
  ($str$die_casting_coremaking$str$, $str$Redford CB-22-SA$str$, 2.14, 13.37, 2.48),
  ($str$die_casting_coremaking$str$, $str$Redford CB-26-SA$str$, 2.14, 13.37, 2.48),
  ($str$die_casting_coremaking$str$, $str$Redford HC-22-UL$str$, 2.14, 13.48, 1.47),
  ($str$die_casting_coremaking$str$, $str$Redford HCB-22$str$, 2.14, 13.48, 1.47),
  ($str$die_casting_coremaking$str$, $str$Redford HCB-22-UL$str$, 2.14, 13.48, 1.47),
  ($str$die_casting_coremaking$str$, $str$Redford HCB-26-UL$str$, 2.14, 13.48, 1.47),
  ($str$die_casting_coremaking$str$, $str$Redford HCB-36-UL$str$, 2.14, 13.48, 1.47),
  ($str$die_casting_finishing$str$, $str$Hand Grind$str$, 2.14, 0.29, 0.89),
  ($str$die_casting_finishing$str$, $str$Snag Wheel - 12kg Max Part Weight$str$, 2.14, 0.3, 0.89),
  ($str$die_casting_finishing$str$, $str$Snag Wheel - 23kg Max Part Weight$str$, 2.14, 0.59, 0.89),
  ($str$die_casting_finishing$str$, $str$Snag With Hoist - 45kg Max Part Weight$str$, 2.14, 0.74, 0.89),
  ($str$die_casting_melting$str$, $str$Crucible Furnace - 0.04m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Crucible Furnace - 0.09m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Crucible Furnace - 0.2m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Crucible Furnace - 0.3m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Crucible Furnace - 0.4m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Crucible Furnace - 0.7m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Cupola Furnace - 0.04m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Cupola Furnace - 0.09m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Cupola Furnace - 0.2m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Cupola Furnace - 0.3m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Cupola Furnace - 0.4m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Cupola Furnace - 0.64m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Electric Arc Furnace - 0.2m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Electric Arc Furnace - 0.6m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Electric Arc Furnace - 10m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Electric Arc Furnace - 15m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Electric Arc Furnace - 2.5m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Electric Arc Furnace - 6.5m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Induction Furnace - 0.06m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Induction Furnace - 0.13m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Induction Furnace - 0.64m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Induction Furnace - 1.27m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Induction Furnace - 3.18m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_melting$str$, $str$Induction Furnace - 6.35m^3 Capacity$str$, 2.25, 0.0, 0.0),
  ($str$die_casting_refractory_coat_air_dry$str$, $str$Default$str$, 1.65, 0.0, 0.86),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Conveyor 10m x 4.5m x 2.4m - BedSize$str$, 2.14, 45.4, 2.71),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Conveyor 12m x 1.5m x 2.4m - BedSize$str$, 2.14, 20.13, 1.8),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Conveyor 12m x 5m x 2.4m - BedSize$str$, 2.14, 59.44, 3.23),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Conveyor 14m x 1.8m x 2.4m - BedSize$str$, 2.14, 26.86, 2.07),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Conveyor 4m x 1m x 2.4m - BedSize$str$, 2.14, 7.11, 1.18),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Conveyor 5m x 3m x 2.4m - BedSize$str$, 2.14, 17.32, 1.64),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Conveyor 6m x 1m x 2.4m - BedSize$str$, 2.14, 8.97, 1.28),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Conveyor 6m x 4m x 2.4m - BedSize$str$, 2.14, 25.74, 1.98),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Conveyor 8m x 1.5m x 2.4m - BedSize$str$, 2.14, 14.51, 1.53),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Conveyor 8m x 4m x 2.4m - BedSize$str$, 2.14, 33.23, 2.26),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 1.2m x 1.2m x 1.2m - BedSize$str$, 2.14, 3.81, 0.94),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 1.2m x 1.2m x 1.5m - BedSize$str$, 2.14, 4.01, 0.94),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 1.2m x 1.5m x 1.8m - BedSize$str$, 2.14, 4.45, 0.96),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 1.5m x 1.5m x 1.5m - BedSize$str$, 2.14, 4.5, 0.98),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 1.5m x 1.5m x 2m - BedSize$str$, 2.14, 4.98, 0.98),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 1.8m x 1.5m x 2m - BedSize$str$, 2.14, 5.35, 1.0),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 1.8m x 1.8m x 1.8m - BedSize$str$, 2.14, 5.48, 1.01),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 1m x 1m x 1m - BedSize$str$, 2.14, 3.51, 0.93),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 1m x 1m x 2m - BedSize$str$, 2.14, 3.98, 0.93),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 2.5m x 2m x 2m - BedSize$str$, 2.14, 7.22, 1.08),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 2m x 1.5m x 2m - BedSize$str$, 2.14, 5.6, 1.01),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 2m x 2m x 2m - BedSize$str$, 2.14, 6.45, 1.04),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 3m x 2.5m x 2m - BedSize$str$, 2.14, 9.14, 1.17),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 3m x 2.5m x 3m - BedSize$str$, 2.14, 12.14, 1.17),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 3m x 2m x 2m - BedSize$str$, 2.14, 8.0, 1.12),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 3m x 3m x 2m - BedSize$str$, 2.14, 10.28, 1.22),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 3m x 3m x 3m - BedSize$str$, 2.14, 13.93, 1.22),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 3m x 4m x 3m - BedSize$str$, 2.14, 17.67, 1.31),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 4m x 3.5m x 2m - BedSize$str$, 2.14, 14.28, 1.39),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 4m x 3m x 3m - BedSize$str$, 2.14, 17.38, 1.33),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 5m x 3m x 3m - BedSize$str$, 2.14, 20.94, 1.44),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 5m x 4m x 3m - BedSize$str$, 2.14, 26.87, 1.59),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 6m x 4.5m x 3m - BedSize$str$, 2.14, 34.87, 1.82),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 6m x 5m x 3m - BedSize$str$, 2.14, 38.31, 1.91),
  ($str$die_casting_refractory_coat_oven_dry$str$, $str$Rack 8m x 4.5m x 3m - BedSize$str$, 2.14, 45.11, 2.13),
  ($str$die_casting_trim$str$, $str$Lasco KFP 1000$str$, 2.25, 84.92, 3.46),
  ($str$die_casting_trim$str$, $str$Lasco KFP 1200$str$, 2.25, 91.03, 3.88),
  ($str$die_casting_trim$str$, $str$Lasco KFP 1500$str$, 2.25, 100.16, 4.62),
  ($str$die_casting_trim$str$, $str$Lasco KFP 250$str$, 2.25, 19.97, 2.22),
  ($str$die_casting_trim$str$, $str$Lasco KFP 400$str$, 2.25, 30.82, 2.72),
  ($str$die_casting_trim$str$, $str$Lasco KFP 500$str$, 2.25, 42.51, 2.72),
  ($str$die_casting_trim$str$, $str$Lasco KFP 630$str$, 2.25, 46.39, 3.04),
  ($str$die_casting_trim$str$, $str$Lasco KFP 800$str$, 2.25, 51.53, 3.04),
  ($str$die_casting_trim$str$, $str$Lasco KP 1000$str$, 2.25, 37.19, 2.83),
  ($str$die_casting_trim$str$, $str$Lasco KP 1250$str$, 2.25, 47.24, 2.94),
  ($str$die_casting_trim$str$, $str$Lasco KP 1600$str$, 2.25, 59.68, 3.62),
  ($str$die_casting_trim$str$, $str$Lasco KP 2000$str$, 2.25, 79.35, 3.77),
  ($str$die_casting_trim$str$, $str$Lasco KP 400$str$, 2.25, 15.95, 2.55),
  ($str$die_casting_trim$str$, $str$Lasco KP 500$str$, 2.25, 18.96, 2.55),
  ($str$die_casting_trim$str$, $str$Lasco KP 630$str$, 2.25, 22.84, 2.61),
  ($str$die_casting_trim$str$, $str$Lasco KP 800$str$, 2.25, 31.08, 2.72),
  ($str$die_casting_trim$str$, $str$Lasco VPA 1000$str$, 2.25, 104.75, 3.76),
  ($str$die_casting_trim$str$, $str$Lasco VPA 1250$str$, 2.25, 137.11, 4.2),
  ($str$die_casting_trim$str$, $str$Lasco VPA 1600$str$, 2.25, 147.69, 4.58),
  ($str$die_casting_trim$str$, $str$Lasco VPA 2000$str$, 2.25, 184.71, 4.99),
  ($str$die_casting_trim$str$, $str$Lasco VPA 250$str$, 2.25, 27.4, 2.48),
  ($str$die_casting_trim$str$, $str$Lasco VPA 400$str$, 2.25, 44.95, 3.08),
  ($str$die_casting_trim$str$, $str$Lasco VPA 630$str$, 2.25, 78.62, 3.08),
  ($str$die_casting_trim$str$, $str$Lasco VPA 800$str$, 2.25, 83.76, 3.76),
  ($str$die_casting_trim$str$, $str$Lasco VPE 1000$str$, 2.25, 104.75, 3.84),
  ($str$die_casting_trim$str$, $str$Lasco VPE 1250$str$, 2.25, 112.32, 3.84),
  ($str$die_casting_trim$str$, $str$Lasco VPE 1600$str$, 2.25, 122.9, 4.58),
  ($str$die_casting_trim$str$, $str$Lasco VPE 2000$str$, 2.25, 159.92, 4.99),
  ($str$die_casting_trim$str$, $str$Lasco VPE 315$str$, 2.25, 25.72, 3.09),
  ($str$die_casting_trim$str$, $str$Lasco VPE 400$str$, 2.25, 27.1, 3.08),
  ($str$die_casting_trim$str$, $str$Lasco VPE 500$str$, 2.25, 44.99, 3.08),
  ($str$die_casting_trim$str$, $str$Lasco VPE 630$str$, 2.25, 51.84, 3.08),
  ($str$die_casting_trim$str$, $str$Lasco VPE 800$str$, 2.25, 73.85, 3.42),
  ($str$die_casting_trim$str$, $str$Press - 10,000kN Press Force$str$, 2.25, 80.64, 3.43),
  ($str$die_casting_trim$str$, $str$Press - 16,000kN Press Force$str$, 2.25, 108.03, 4.33),
  ($str$die_casting_trim$str$, $str$Press - 20,000kN Press Force$str$, 2.25, 141.72, 4.62),
  ($str$die_casting_trim$str$, $str$Press - 5,000kN Press Force$str$, 2.25, 33.15, 2.72),
  ($str$die_casting_visual_inspection$str$, $str$Default$str$, 2.99, 0.0, 0.88)
  ) AS v(machine_class, usa_name, labor, direct, indirect)
  LOOP
    SELECT id INTO usa_id FROM mhr_records
    WHERE process_group = 'Die Casting' AND location = 'USA' AND machine_class = r.machine_class AND machine_name = r.usa_name
    LIMIT 1;
    IF usa_id IS NULL THEN
      missing := array_append(missing, r.machine_class || ':' || r.usa_name);
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM mhr_records m WHERE m.location = 'India' AND m.machine_class = r.machine_class AND m.machine_name = r.usa_name) THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'INSERT INTO mhr_records (%s) SELECT %s FROM mhr_records usa_row WHERE usa_row.id = $1',
      cols, sel
    ) USING usa_id, r.direct, r.indirect, r.labor;
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'Die Casting India rows inserted: %', n;
  IF array_length(missing, 1) > 0 THEN
    RAISE NOTICE 'Die Casting India rows with no USA row (not inserted): %', missing;
  END IF;
END $india1044$;

NOTIFY pgrst, 'reload schema';
