-- ============================================================================
-- Migration 1049: Forging machines, India rates (USA twin cloned at India rates)
-- ============================================================================
-- Migration 824 seeded the 202 forging machines for the USA only, so a forging priced in India had no machine on any
-- step of its route.
--
-- Source: memory/Countries data/India_XML_Data_.csv, commodity "Forging": each machine's direct and indirect overhead
-- rate (USD/hr, rounded to cents). Labour: the India rate of the machine's wage grade, the value every India row of
-- that grade already carries (2 - Metal 1.65, 3 - Metal 1.73, 4 - Metal 2.30 USD/hr; Material Stock has none).
-- The export lists the oven furnaces twice, as Preheat and as Reheat, with the same rates: they are one machine class
-- (forging_oven_furnace) and are added once.
-- 202 machines, each matched by machine class and exact name to its USA row:
--   Band Saw                  15 machine(s)
--   Conveyor Induction Heat   6 machine(s)
--   Hammer                    40 machine(s)
--   Material Stock            1 machine(s)
--   Mechanical Press          13 machine(s)
--   Open Die Press            13 machine(s)
--   Preheat                   9 machine(s)
--   Press                     37 machine(s)
--   Ring Rolling              31 machine(s)
--   Trim                      37 machine(s)
--
-- Idempotent: an India row already present for a machine_class + machine_name is skipped (the guard of migrations
-- 845, 870, 1044 and 1047; mhr_records has no unique constraint to ON CONFLICT on).
-- Verify: SELECT machine_class, count(*) FROM mhr_records WHERE process_group = 'Forging' AND location = 'India'
--   GROUP BY 1 ORDER BY 1;  -- expect 10 classes, 202 rows.
-- ============================================================================

DO $india_forging$
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
  ($str$forging_band_saw$str$, $str$BLIN HDS-J150$str$, 1.65, 10.55, 3.47),
  ($str$forging_band_saw$str$, $str$BLIN HDS-J160$str$, 1.65, 11.28, 3.59),
  ($str$forging_band_saw$str$, $str$BLIN HDS-J180$str$, 1.65, 12.49, 3.79),
  ($str$forging_band_saw$str$, $str$BLIN HDS-J200$str$, 1.65, 15.42, 5.01),
  ($str$forging_band_saw$str$, $str$Band Saw - 1200mm x 1000mm Max Stock Cross Section$str$, 1.65, 9.76, 3.61),
  ($str$forging_band_saw$str$, $str$Band Saw - 2000mm x 2000mm Max Stock Cross Section$str$, 1.65, 15.23, 5.01),
  ($str$forging_band_saw$str$, $str$Band Saw - 500mm x 400mm Max Stock Cross Section$str$, 1.65, 2.45, 2.43),
  ($str$forging_band_saw$str$, $str$DoAll 3613-1 Vert$str$, 1.65, 1.3, 1.22),
  ($str$forging_band_saw$str$, $str$DoAll 500-SNC$str$, 1.65, 1.78, 1.99),
  ($str$forging_band_saw$str$, $str$DoAll C-330NC$str$, 1.65, 1.87, 2.0),
  ($str$forging_band_saw$str$, $str$DoAll C-455CNC$str$, 1.65, 3.66, 2.0),
  ($str$forging_band_saw$str$, $str$DoAll C-650NC$str$, 1.65, 5.45, 2.01),
  ($str$forging_band_saw$str$, $str$DoAll DC-560NC$str$, 1.65, 4.31, 2.01),
  ($str$forging_band_saw$str$, $str$DoAll DC-700NC$str$, 1.65, 6.02, 2.08),
  ($str$forging_band_saw$str$, $str$DoAll DC-800NC$str$, 1.65, 7.8, 2.39),
  ($str$forging_conveyor_induction_heat$str$, $str$Conveyor Induction Heater - 1 Module$str$, 2.3, 94.87, 1.14),
  ($str$forging_conveyor_induction_heat$str$, $str$Conveyor Induction Heater - 2 Module$str$, 2.3, 188.01, 1.19),
  ($str$forging_conveyor_induction_heat$str$, $str$Conveyor Induction Heater - 3 Module$str$, 2.3, 293.22, 1.3),
  ($str$forging_conveyor_induction_heat$str$, $str$Conveyor Induction Heater - 4 Module$str$, 2.3, 377.74, 1.44),
  ($str$forging_conveyor_induction_heat$str$, $str$Conveyor Induction Heater - 5 Module$str$, 2.3, 472.61, 1.53),
  ($str$forging_conveyor_induction_heat$str$, $str$Conveyor Induction Heater - 6 Module$str$, 2.3, 660.61, 1.61),
  ($str$forging_hammer$str$, $str$Chambersburg - 20,000 lb$str$, 2.3, 153.65, 27.35),
  ($str$forging_hammer$str$, $str$ERIE - 1,500 lb$str$, 2.3, 46.36, 8.13),
  ($str$forging_hammer$str$, $str$ERIE - 12,000 lb$str$, 2.3, 95.83, 11.74),
  ($str$forging_hammer$str$, $str$ERIE - 2,000 lb$str$, 2.3, 46.36, 8.13),
  ($str$forging_hammer$str$, $str$ERIE - 2,500 lb$str$, 2.3, 46.36, 8.13),
  ($str$forging_hammer$str$, $str$ERIE - 25,000 lb$str$, 2.3, 173.06, 27.35),
  ($str$forging_hammer$str$, $str$ERIE - 3,000 lb$str$, 2.3, 60.92, 8.13),
  ($str$forging_hammer$str$, $str$ERIE - 6,000 lb$str$, 2.3, 70.22, 8.13),
  ($str$forging_hammer$str$, $str$ERIE - 8,000 lb$str$, 2.3, 70.22, 8.13),
  ($str$forging_hammer$str$, $str$Hammer - 100kJ Impact Energy$str$, 2.3, 88.96, 3.69),
  ($str$forging_hammer$str$, $str$Hammer - 200kJ Impact Energy$str$, 2.3, 107.29, 4.83),
  ($str$forging_hammer$str$, $str$Hammer - 20kJ Impact Energy$str$, 2.3, 48.01, 2.28),
  ($str$forging_hammer$str$, $str$Hammer - 400kJ Impact Energy$str$, 2.3, 195.16, 10.44),
  ($str$forging_hammer$str$, $str$Hammer - 40kJ Impact Energy$str$, 2.3, 59.06, 3.69),
  ($str$forging_hammer$str$, $str$Hammer - 60kJ Impact Energy$str$, 2.3, 70.63, 3.69),
  ($str$forging_hammer$str$, $str$Lasco GH 1000$str$, 2.3, 102.35, 2.58),
  ($str$forging_hammer$str$, $str$Lasco GH 1250$str$, 2.3, 106.07, 2.72),
  ($str$forging_hammer$str$, $str$Lasco GH 1600$str$, 2.3, 111.03, 2.85),
  ($str$forging_hammer$str$, $str$Lasco GH 2000$str$, 2.3, 179.49, 3.1),
  ($str$forging_hammer$str$, $str$Lasco GH 2500$str$, 2.3, 207.18, 3.46),
  ($str$forging_hammer$str$, $str$Lasco GH 3200$str$, 2.3, 217.09, 3.74),
  ($str$forging_hammer$str$, $str$Lasco GH 4000$str$, 2.3, 239.41, 4.17),
  ($str$forging_hammer$str$, $str$Lasco GH 630$str$, 2.3, 70.94, 2.31),
  ($str$forging_hammer$str$, $str$Lasco GH 800$str$, 2.3, 73.42, 2.46),
  ($str$forging_hammer$str$, $str$Lasco HO 100$str$, 2.3, 59.49, 2.71),
  ($str$forging_hammer$str$, $str$Lasco HO 1000$str$, 2.3, 106.07, 3.18),
  ($str$forging_hammer$str$, $str$Lasco HO 125$str$, 2.3, 45.55, 2.04),
  ($str$forging_hammer$str$, $str$Lasco HO 1250$str$, 2.3, 116.23, 3.92),
  ($str$forging_hammer$str$, $str$Lasco HO 160$str$, 2.3, 46.42, 2.22),
  ($str$forging_hammer$str$, $str$Lasco HO 200$str$, 2.3, 47.41, 2.28),
  ($str$forging_hammer$str$, $str$Lasco HO 250$str$, 2.3, 62.59, 3.02),
  ($str$forging_hammer$str$, $str$Lasco HO 315$str$, 2.3, 66.6, 2.4),
  ($str$forging_hammer$str$, $str$Lasco HO 400$str$, 2.3, 70.94, 2.4),
  ($str$forging_hammer$str$, $str$Lasco HO 500$str$, 2.3, 73.42, 2.5),
  ($str$forging_hammer$str$, $str$Lasco HO 630$str$, 2.3, 73.42, 2.76),
  ($str$forging_hammer$str$, $str$Lasco HO 800$str$, 2.3, 78.38, 3.16),
  ($str$forging_hammer$str$, $str$Smeral KHZ 16A$str$, 2.3, 103.59, 4.44),
  ($str$forging_hammer$str$, $str$Smeral KHZ 2A$str$, 2.3, 45.55, 2.95),
  ($str$forging_hammer$str$, $str$Smeral KHZ 4A$str$, 2.3, 66.6, 2.95),
  ($str$forging_hammer$str$, $str$Smeral KHZ 8A$str$, 2.3, 73.42, 3.23),
  ($str$forging_material_stock$str$, $str$Default Material Stock$str$, 0, 0.0, 0.0),
  ($str$forging_mechanical_press$str$, $str$Schuler PK1250$str$, 2.3, 226.97, 1.84),
  ($str$forging_mechanical_press$str$, $str$Schuler PK2000$str$, 2.3, 303.98, 2.45),
  ($str$forging_mechanical_press$str$, $str$Schuler PK3150$str$, 2.3, 422.18, 2.76),
  ($str$forging_mechanical_press$str$, $str$Schuler PK4000$str$, 2.3, 509.42, 2.85),
  ($str$forging_mechanical_press$str$, $str$Schuler PK5000$str$, 2.3, 612.14, 2.96),
  ($str$forging_mechanical_press$str$, $str$Schuler PK6300$str$, 2.3, 745.69, 3.12),
  ($str$forging_mechanical_press$str$, $str$Sumitomo FPA-10000$str$, 2.3, 1128.82, 3.72),
  ($str$forging_mechanical_press$str$, $str$Sumitomo FPA-6000$str$, 2.3, 714.86, 2.83),
  ($str$forging_mechanical_press$str$, $str$Sumitomo FPA-6500$str$, 2.3, 771.36, 2.83),
  ($str$forging_mechanical_press$str$, $str$Sumitomo FPA-8000$str$, 2.3, 923.38, 3.18),
  ($str$forging_mechanical_press$str$, $str$Sumitomo FPZ-2500$str$, 2.3, 355.4, 2.34),
  ($str$forging_mechanical_press$str$, $str$Sumitomo FPZ-3000$str$, 2.3, 406.7, 2.55),
  ($str$forging_mechanical_press$str$, $str$Sumitomo FPZ-4500$str$, 2.3, 560.84, 3.08),
  ($str$forging_open_die_press$str$, $str$ERIE Press Systems 3500 Ton Press$str$, 2.3, 244.18, 2.43),
  ($str$forging_open_die_press$str$, $str$Jinan Quanyue CNC Company 1250T Press$str$, 2.3, 68.42, 2.7),
  ($str$forging_open_die_press$str$, $str$Jinan Quanyue CNC Company 1600T Press$str$, 2.3, 137.98, 2.86),
  ($str$forging_open_die_press$str$, $str$Jinan Quanyue CNC Company 2000T Press$str$, 2.3, 153.1, 2.97),
  ($str$forging_open_die_press$str$, $str$Jinan Quanyue CNC Company 2500T Press$str$, 2.3, 182.16, 3.1),
  ($str$forging_open_die_press$str$, $str$Jinan Quanyue CNC Company 3150T Press$str$, 2.3, 225.54, 3.41),
  ($str$forging_open_die_press$str$, $str$Jinan Quanyue CNC Company 4000T Press$str$, 2.3, 283.26, 3.54),
  ($str$forging_open_die_press$str$, $str$Jinan Quanyue CNC Company 800T Press$str$, 2.3, 53.2, 2.6),
  ($str$forging_open_die_press$str$, $str$Open Die Press 1000 Ton$str$, 2.3, 72.36, 2.65),
  ($str$forging_open_die_press$str$, $str$Open Die Press 10000 Ton$str$, 2.3, 713.13, 6.38),
  ($str$forging_open_die_press$str$, $str$Open Die Press 20000 Ton$str$, 2.3, 1424.87, 7.47),
  ($str$forging_open_die_press$str$, $str$Open Die Press 3000 Ton$str$, 2.3, 214.78, 3.41),
  ($str$forging_open_die_press$str$, $str$Open Die Press 5000 Ton$str$, 2.3, 357.08, 4.02),
  ($str$forging_oven_furnace$str$, $str$H.K. Furnace RT4-105-12$str$, 2.3, 25.83, 3.52),
  ($str$forging_oven_furnace$str$, $str$H.K. Furnace RT4-220-12$str$, 2.3, 51.44, 4.16),
  ($str$forging_oven_furnace$str$, $str$H.K. Furnace RT4-220-9$str$, 2.3, 39.79, 4.16),
  ($str$forging_oven_furnace$str$, $str$H.K. Furnace RT4-300-12$str$, 2.3, 56.6, 4.87),
  ($str$forging_oven_furnace$str$, $str$H.K. Furnace RT4-300-9$str$, 2.3, 53.49, 4.87),
  ($str$forging_oven_furnace$str$, $str$Oven - 12' x 8'$str$, 2.3, 92.62, 5.9),
  ($str$forging_oven_furnace$str$, $str$Oven - 20' x 10'$str$, 2.3, 121.84, 8.52),
  ($str$forging_oven_furnace$str$, $str$Oven - 8' x 4'$str$, 2.3, 63.4, 4.06),
  ($str$forging_oven_furnace$str$, $str$Schlager Box Furnace$str$, 2.3, 47.35, 4.14),
  ($str$forging_press$str$, $str$Lasco KFP 1000$str$, 1.73, 84.92, 3.46),
  ($str$forging_press$str$, $str$Lasco KFP 1200$str$, 1.73, 91.03, 3.88),
  ($str$forging_press$str$, $str$Lasco KFP 1500$str$, 1.73, 100.16, 4.62),
  ($str$forging_press$str$, $str$Lasco KFP 250$str$, 1.73, 19.97, 2.22),
  ($str$forging_press$str$, $str$Lasco KFP 400$str$, 1.73, 30.82, 2.72),
  ($str$forging_press$str$, $str$Lasco KFP 500$str$, 1.73, 42.51, 2.72),
  ($str$forging_press$str$, $str$Lasco KFP 630$str$, 1.73, 46.39, 3.04),
  ($str$forging_press$str$, $str$Lasco KFP 800$str$, 1.73, 51.53, 3.04),
  ($str$forging_press$str$, $str$Lasco KP 1000$str$, 1.73, 37.19, 2.83),
  ($str$forging_press$str$, $str$Lasco KP 1250$str$, 1.73, 47.24, 2.94),
  ($str$forging_press$str$, $str$Lasco KP 1600$str$, 1.73, 59.68, 3.62),
  ($str$forging_press$str$, $str$Lasco KP 2000$str$, 1.73, 79.35, 3.77),
  ($str$forging_press$str$, $str$Lasco KP 400$str$, 1.73, 15.95, 2.55),
  ($str$forging_press$str$, $str$Lasco KP 500$str$, 1.73, 18.96, 2.55),
  ($str$forging_press$str$, $str$Lasco KP 630$str$, 1.73, 22.84, 2.61),
  ($str$forging_press$str$, $str$Lasco KP 800$str$, 1.73, 31.08, 2.72),
  ($str$forging_press$str$, $str$Lasco VPA 1000$str$, 1.73, 104.75, 3.76),
  ($str$forging_press$str$, $str$Lasco VPA 1250$str$, 1.73, 137.11, 4.2),
  ($str$forging_press$str$, $str$Lasco VPA 1600$str$, 1.73, 147.69, 4.58),
  ($str$forging_press$str$, $str$Lasco VPA 2000$str$, 1.73, 184.71, 4.99),
  ($str$forging_press$str$, $str$Lasco VPA 250$str$, 1.73, 27.4, 2.48),
  ($str$forging_press$str$, $str$Lasco VPA 400$str$, 1.73, 44.95, 3.08),
  ($str$forging_press$str$, $str$Lasco VPA 630$str$, 1.73, 78.62, 3.08),
  ($str$forging_press$str$, $str$Lasco VPA 800$str$, 1.73, 83.76, 3.76),
  ($str$forging_press$str$, $str$Lasco VPE 1000$str$, 1.73, 104.75, 3.84),
  ($str$forging_press$str$, $str$Lasco VPE 1250$str$, 1.73, 112.32, 3.84),
  ($str$forging_press$str$, $str$Lasco VPE 1600$str$, 1.73, 122.9, 4.58),
  ($str$forging_press$str$, $str$Lasco VPE 2000$str$, 1.73, 159.92, 4.99),
  ($str$forging_press$str$, $str$Lasco VPE 315$str$, 1.73, 25.72, 3.09),
  ($str$forging_press$str$, $str$Lasco VPE 400$str$, 1.73, 27.1, 3.08),
  ($str$forging_press$str$, $str$Lasco VPE 500$str$, 1.73, 44.99, 3.08),
  ($str$forging_press$str$, $str$Lasco VPE 630$str$, 1.73, 51.84, 3.08),
  ($str$forging_press$str$, $str$Lasco VPE 800$str$, 1.73, 73.85, 3.42),
  ($str$forging_press$str$, $str$Press - 10,000kN Press Force$str$, 1.73, 80.64, 3.43),
  ($str$forging_press$str$, $str$Press - 16,000kN Press Force$str$, 1.73, 108.03, 4.33),
  ($str$forging_press$str$, $str$Press - 20,000kN Press Force$str$, 1.73, 141.72, 4.62),
  ($str$forging_press$str$, $str$Press - 5,000kN Press Force$str$, 1.73, 33.15, 2.72),
  ($str$forging_ring_rolling$str$, $str$D51-1000E$str$, 2.3, 20.4, 1.21),
  ($str$forging_ring_rolling$str$, $str$D51-1000F$str$, 2.3, 23.3, 1.26),
  ($str$forging_ring_rolling$str$, $str$D51-160D$str$, 2.3, 5.14, 0.96),
  ($str$forging_ring_rolling$str$, $str$D51-160E$str$, 2.3, 6.33, 0.98),
  ($str$forging_ring_rolling$str$, $str$D51-250D$str$, 2.3, 6.87, 1.02),
  ($str$forging_ring_rolling$str$, $str$D51-250E$str$, 2.3, 8.72, 1.06),
  ($str$forging_ring_rolling$str$, $str$D51-350D$str$, 2.3, 11.01, 1.1),
  ($str$forging_ring_rolling$str$, $str$D51-350E$str$, 2.3, 12.77, 1.14),
  ($str$forging_ring_rolling$str$, $str$D51-400E$str$, 2.3, 12.68, 1.14),
  ($str$forging_ring_rolling$str$, $str$D51-500E$str$, 2.3, 12.58, 1.17),
  ($str$forging_ring_rolling$str$, $str$D51-630E$str$, 2.3, 18.39, 1.18),
  ($str$forging_ring_rolling$str$, $str$D51-800E$str$, 2.3, 20.87, 1.19),
  ($str$forging_ring_rolling$str$, $str$D53K-1000$str$, 2.3, 61.84, 1.57),
  ($str$forging_ring_rolling$str$, $str$D53K-10000$str$, 2.3, 423.89, 10.18),
  ($str$forging_ring_rolling$str$, $str$D53K-12000$str$, 2.3, 628.82, 14.54),
  ($str$forging_ring_rolling$str$, $str$D53K-1600$str$, 2.3, 75.08, 1.66),
  ($str$forging_ring_rolling$str$, $str$D53K-2000$str$, 2.3, 97.08, 1.81),
  ($str$forging_ring_rolling$str$, $str$D53K-2500$str$, 2.3, 111.85, 2.34),
  ($str$forging_ring_rolling$str$, $str$D53K-3000$str$, 2.3, 130.34, 2.7),
  ($str$forging_ring_rolling$str$, $str$D53K-3500$str$, 2.3, 128.79, 2.74),
  ($str$forging_ring_rolling$str$, $str$D53K-5000$str$, 2.3, 170.41, 3.61),
  ($str$forging_ring_rolling$str$, $str$D53K-630$str$, 2.3, 53.56, 1.44),
  ($str$forging_ring_rolling$str$, $str$D53K-6300$str$, 2.3, 207.55, 5.08),
  ($str$forging_ring_rolling$str$, $str$D53K-8000$str$, 2.3, 270.81, 6.92),
  ($str$forging_ring_rolling$str$, $str$D53K-9000$str$, 2.3, 332.37, 8.72),
  ($str$forging_ring_rolling$str$, $str$Horizontal - Large Machine$str$, 2.3, 628.82, 14.54),
  ($str$forging_ring_rolling$str$, $str$Horizontal - Medium Machine$str$, 2.3, 130.34, 2.7),
  ($str$forging_ring_rolling$str$, $str$Horizontal - Small Machine$str$, 2.3, 53.56, 1.44),
  ($str$forging_ring_rolling$str$, $str$Vertical - Large Machine$str$, 2.3, 23.3, 1.26),
  ($str$forging_ring_rolling$str$, $str$Vertical - Medium Machine$str$, 2.3, 12.77, 1.14),
  ($str$forging_ring_rolling$str$, $str$Vertical - Small Machine$str$, 2.3, 5.14, 0.96),
  ($str$forging_trim$str$, $str$Lasco KFP 1000$str$, 1.73, 84.92, 3.46),
  ($str$forging_trim$str$, $str$Lasco KFP 1200$str$, 1.73, 91.03, 3.88),
  ($str$forging_trim$str$, $str$Lasco KFP 1500$str$, 1.73, 100.16, 4.62),
  ($str$forging_trim$str$, $str$Lasco KFP 250$str$, 1.73, 19.97, 2.22),
  ($str$forging_trim$str$, $str$Lasco KFP 400$str$, 1.73, 30.82, 2.72),
  ($str$forging_trim$str$, $str$Lasco KFP 500$str$, 1.73, 42.51, 2.72),
  ($str$forging_trim$str$, $str$Lasco KFP 630$str$, 1.73, 46.39, 3.04),
  ($str$forging_trim$str$, $str$Lasco KFP 800$str$, 1.73, 51.53, 3.04),
  ($str$forging_trim$str$, $str$Lasco KP 1000$str$, 1.73, 37.19, 2.83),
  ($str$forging_trim$str$, $str$Lasco KP 1250$str$, 1.73, 47.24, 2.94),
  ($str$forging_trim$str$, $str$Lasco KP 1600$str$, 1.73, 59.68, 3.62),
  ($str$forging_trim$str$, $str$Lasco KP 2000$str$, 1.73, 79.35, 3.77),
  ($str$forging_trim$str$, $str$Lasco KP 400$str$, 1.73, 15.95, 2.55),
  ($str$forging_trim$str$, $str$Lasco KP 500$str$, 1.73, 18.96, 2.55),
  ($str$forging_trim$str$, $str$Lasco KP 630$str$, 1.73, 22.84, 2.61),
  ($str$forging_trim$str$, $str$Lasco KP 800$str$, 1.73, 31.08, 2.72),
  ($str$forging_trim$str$, $str$Lasco VPA 1000$str$, 1.73, 104.75, 3.76),
  ($str$forging_trim$str$, $str$Lasco VPA 1250$str$, 1.73, 137.11, 4.2),
  ($str$forging_trim$str$, $str$Lasco VPA 1600$str$, 1.73, 147.69, 4.58),
  ($str$forging_trim$str$, $str$Lasco VPA 2000$str$, 1.73, 184.71, 4.99),
  ($str$forging_trim$str$, $str$Lasco VPA 250$str$, 1.73, 27.4, 2.48),
  ($str$forging_trim$str$, $str$Lasco VPA 400$str$, 1.73, 44.95, 3.08),
  ($str$forging_trim$str$, $str$Lasco VPA 630$str$, 1.73, 78.62, 3.08),
  ($str$forging_trim$str$, $str$Lasco VPA 800$str$, 1.73, 83.76, 3.76),
  ($str$forging_trim$str$, $str$Lasco VPE 1000$str$, 1.73, 104.75, 3.84),
  ($str$forging_trim$str$, $str$Lasco VPE 1250$str$, 1.73, 112.32, 3.84),
  ($str$forging_trim$str$, $str$Lasco VPE 1600$str$, 1.73, 122.9, 4.58),
  ($str$forging_trim$str$, $str$Lasco VPE 2000$str$, 1.73, 159.92, 4.99),
  ($str$forging_trim$str$, $str$Lasco VPE 315$str$, 1.73, 25.72, 3.09),
  ($str$forging_trim$str$, $str$Lasco VPE 400$str$, 1.73, 27.1, 3.08),
  ($str$forging_trim$str$, $str$Lasco VPE 500$str$, 1.73, 44.99, 3.08),
  ($str$forging_trim$str$, $str$Lasco VPE 630$str$, 1.73, 51.84, 3.08),
  ($str$forging_trim$str$, $str$Lasco VPE 800$str$, 1.73, 73.85, 3.42),
  ($str$forging_trim$str$, $str$Trim - 10,000kN Press Force$str$, 1.73, 80.64, 3.43),
  ($str$forging_trim$str$, $str$Trim - 16,000kN Press Force$str$, 1.73, 108.03, 4.33),
  ($str$forging_trim$str$, $str$Trim - 20,000kN Press Force$str$, 1.73, 141.72, 4.62),
  ($str$forging_trim$str$, $str$Trim - 5,000kN Press Force$str$, 1.73, 33.15, 2.72)
  ) AS v(machine_class, usa_name, labor, direct, indirect)
  LOOP
    SELECT id INTO usa_id FROM mhr_records
    WHERE process_group = 'Forging' AND location = 'USA' AND machine_class = r.machine_class AND machine_name = r.usa_name
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

  RAISE NOTICE 'Forging India rows inserted: %', n;
  IF array_length(missing, 1) > 0 THEN
    RAISE NOTICE 'Forging India rows with no USA row (not inserted): %', missing;
  END IF;
END $india_forging$;

NOTIFY pgrst, 'reload schema';
