-- ============================================================================
-- Migration 1047: Casting Investment drying and cooling work centres, India rates (USA twin cloned at India rates)
-- ============================================================================
-- Migrations 870 and 876 gave India every investment casting machine except the Drying and Cooling work centres
-- ("Default Machine"), so the Drying and Cooling steps of an India investment casting had no machine and its route
-- could not be completed.
--
-- Source: memory/Countries data/India_XML_Data_.csv, commodity "Casting - Investment", machine types Drying and
-- Cooling: the direct and indirect overhead rate (USD/hr, rounded to cents). Labour: the India rate of the wage
-- grade both carry (2 - Casting, 2.14 USD/hr); neither is crewed.
--
-- Idempotent: an India row already present for a machine_class + machine_name is skipped (the guard of migrations
-- 845 and 870).
-- Verify: SELECT machine_class, mhr_usd_per_hour FROM mhr_records WHERE location = 'India'
--   AND machine_class IN ('casting_investment_drying', 'casting_investment_cooling');  -- 1.48 and 0.86
-- ============================================================================

DO $india1047$
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
  ($str$casting_investment_drying$str$, $str$Default Machine$str$, 2.14, 0.62, 0.86),
  ($str$casting_investment_cooling$str$, $str$Default Machine$str$, 2.14, 0, 0.86)
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

  RAISE NOTICE 'Casting Investment India rows inserted: %', n;
  IF array_length(missing, 1) > 0 THEN
    RAISE NOTICE 'Casting Investment India rows with no USA row (not inserted): %', missing;
  END IF;
END $india1047$;

NOTIFY pgrst, 'reload schema';
