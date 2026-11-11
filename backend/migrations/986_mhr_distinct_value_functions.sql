-- ============================================================================
-- Migration 986: the machine rates' distinct-value lists are computed by the database
-- ============================================================================
-- The Machine Rates page asks for six short lists (currencies, locations, process groups, manufacturer countries, wage grades and the category sources).
-- The backend built each by downloading EVERY mhr_records row in pages (PostgREST answers 1,000 rows at most: seven sequential round trips for 6,472
-- rows) and removing duplicates in JavaScript: measured on the production server, 5.7 to 10.4 seconds for the first call of each list. A DISTINCT
-- answers in one query and a few hundred bytes.
--
-- Both functions are SECURITY INVOKER: they run as the caller, so row-level security on mhr_records decides what each user's lists contain, exactly
-- as the row-by-row reads did. They only read; the column name is checked against a fixed list before it reaches the query text.
-- Both functions return ONE jsonb value (an array), not a set of rows: PostgREST cuts any response at 1,000 rows without an error, and the category
-- sources are 6,253 distinct combinations when taken per machine (found on the real data). The category function therefore reduces each row to what
-- the backend's category rule reads (the first segment of benchmark_source_key, machine_class and the effective process group) and returns the
-- combinations in the order each first appears by id, which is what that rule's "first real machine_class seen for a category wins" depends on.
-- plpgsql, not sql: the body is not checked at creation, so the function can be created before the table exists (a fresh local database).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mhr_distinct_values(p_column text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $f$
DECLARE result jsonb;
BEGIN
  IF p_column IS NULL OR p_column NOT IN ('currency', 'location', 'process_group', 'manufacturer_country', 'wage_grade') THEN
    RAISE EXCEPTION 'mhr_distinct_values: unsupported column %', p_column USING ERRCODE = '22023';
  END IF;
  EXECUTE format('SELECT coalesce(jsonb_agg(v), ''[]''::jsonb) FROM (SELECT DISTINCT %1$I::text AS v FROM public.mhr_records WHERE %1$I IS NOT NULL) d', p_column)
    INTO result;
  RETURN result;
END
$f$;

CREATE OR REPLACE FUNCTION public.mhr_distinct_category_sources()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $f$
BEGIN
  -- key: the text before the first ':' without surrounding whitespace, NULL when empty (the backend reads benchmark_source_key.split(':')[0].trim());
  -- process_group: the row's own group, else its commodity code, '' counting as missing (the backend's  process_group || commodity_code);
  -- machine_class is passed through untouched ('' and NULL stay different: the backend keeps whichever it saw)
  RETURN (
  SELECT coalesce(jsonb_agg(jsonb_build_object('benchmark_source_key', x.k, 'machine_class', x.c, 'process_group', x.g) ORDER BY x.first_id), '[]'::jsonb)
  FROM (
    SELECT nullif(btrim(split_part(r.benchmark_source_key, ':', 1), E' \t\r\n\f\v'), '') AS k,
           r.machine_class::text AS c,
           coalesce(nullif(r.process_group::text, ''), nullif(r.commodity_code::text, '')) AS g,
           (array_agg(r.id ORDER BY r.id))[1] AS first_id
    FROM public.mhr_records r
    GROUP BY 1, 2, 3
  ) x
  );
END
$f$;

REVOKE ALL ON FUNCTION public.mhr_distinct_values(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mhr_distinct_category_sources() FROM PUBLIC;
DO $m986$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.mhr_distinct_values(text) TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.mhr_distinct_category_sources() TO %I', r);
    END IF;
  END LOOP;
END
$m986$;
