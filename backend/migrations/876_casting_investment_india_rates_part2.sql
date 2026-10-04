-- 876: Casting Investment India rates, the 12 rows migration 870 disclosed as unresolved
-- (plus Secondary Sand Coating, new in 869/875). Source: memory/Countries data/India_XML_Data_.csv,
-- filtered to Commodity = 'Casting - Investment' -- a complete, unambiguous master export with
-- its own Machine Type column per row, confirming:
--   * Ceramic Leaching and Soluble Wax Leaching really are two distinct real rate sets for the
--     same 5 Magnus machines (not interchangeable) -- resolves 870's disclosed Magnus gap.
--     The user's own call (plain -> Ceramic Leaching, group 2 -> Soluble Wax Leaching) is exactly
--     what this file independently confirms, not a guess that happened to be accepted.
--   * "Olympic Kilns FL20E - Box" has its own real, distinct rate (not the same as "Olympic Kiln
--     Fl27E - Box", which 870's smaller source file's un-suffixed row was ambiguous between).
--   * "Secondary Sand Coating" (VATECH RS300250, migration 869/875) has its own real rate too.
-- Labor rate is not in this file (wage-grade based); each row reuses the real, sourced labor
-- rate migration 870 already verified for that process (2.14 Wax Injection Press / Ceramic Core
-- Firing wage grade, 2.99 Robotic Shell Building wage grade).
-- Idempotent: the same NOT EXISTS guard as 870/845 (mhr_records has no unique constraint).

DO $india876$
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
        WHEN 'id'                                      THEN 'gen_random_uuid()'
        WHEN 'created_at'                              THEN 'now()'
        WHEN 'updated_at'                              THEN 'now()'
        ELSE 'usa_row.' || quote_ident(c.column_name)
      END, ', ' ORDER BY c.ordinal_position
    )
  INTO cols, sel
  FROM information_schema.columns c
  WHERE c.table_name = 'mhr_records';

  FOR r IN SELECT * FROM (VALUES
    ($str$casting_investment_ceramic_leaching$str$, $str$Magnus ALX30H52 - 2200lbs$str$, 2.14, 7.93, 0.90),
    ($str$casting_investment_ceramic_leaching$str$, $str$Magnus ALXH7652 - 2200lbs$str$, 2.14, 17.33, 0.95),
    ($str$casting_investment_ceramic_leaching$str$, $str$Magnus MAL 2222 - 520lbs$str$, 2.14, 3.88, 0.88),
    ($str$casting_investment_ceramic_leaching$str$, $str$Magnus ML24 X1 - 250lbs$str$, 2.14, 3.34, 0.88),
    ($str$casting_investment_ceramic_leaching$str$, $str$Magnus MLSR - 200lbs$str$, 2.14, 1.37, 0.87),
    ($str$casting_investment_soluble_wax_leaching$str$, $str$Magnus ALX30H52 - 2200lbs$str$, 2.14, 2.56, 0.90),
    ($str$casting_investment_soluble_wax_leaching$str$, $str$Magnus ALXH7652 - 2200lbs$str$, 2.14, 4.00, 0.95),
    ($str$casting_investment_soluble_wax_leaching$str$, $str$Magnus MAL 2222 - 520lbs$str$, 2.14, 1.76, 0.88),
    ($str$casting_investment_soluble_wax_leaching$str$, $str$Magnus ML24 X1 - 250lbs$str$, 2.14, 1.36, 0.88),
    ($str$casting_investment_soluble_wax_leaching$str$, $str$Magnus MLSR - 200lbs$str$, 2.14, 0.47, 0.87),
    ($str$casting_investment_ceramic_core_firing$str$, $str$Olympic Kilns FL20E - Box$str$, 2.14, 2.83, 0.91),
    ($str$casting_investment_secondary_sand_coating$str$, $str$VATECH RS300250$str$, 2.99, 1.22, 1.18)
  ) AS v(machine_class, usa_name, labor, direct, indirect)
  LOOP
    SELECT id INTO usa_id FROM mhr_records
    WHERE process_group = 'Casting Investment' AND location = 'USA' AND machine_class = r.machine_class AND machine_name = r.usa_name
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

  RAISE NOTICE 'Casting Investment India rows inserted (part 2): %', n;
  IF array_length(missing, 1) > 0 THEN
    RAISE NOTICE 'Casting Investment India rows with no USA match (not inserted): %', missing;
  END IF;
END $india876$;

NOTIFY pgrst, 'reload schema';

-- Verify (expect 109 total: the 97 from 870 + these 12):
-- SELECT count(*) FROM mhr_records WHERE process_group = 'Casting Investment' AND location = 'India';
