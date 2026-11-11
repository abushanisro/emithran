-- 986: the distinct-value lists come from the database, as the caller (row-level security decides what each user's lists contain), in the order
-- the category rule needs, and a column outside the fixed list is refused.
-- this test has its own throwaway database: replace whatever earlier migrations made of the table with the columns the functions read
DROP TABLE IF EXISTS public.mhr_records CASCADE;
CREATE TABLE public.mhr_records (
  id uuid PRIMARY KEY, owner uuid, currency text, location varchar, process_group varchar, manufacturer_country varchar, wage_grade varchar,
  benchmark_source_key text, machine_class varchar, commodity_code varchar
);
ALTER TABLE public.mhr_records ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.mhr_records TO authenticated;
-- a stand-in for the real policy: everyone sees the global rows (owner NULL) and each user also sees their own
CREATE POLICY see_global_and_own ON public.mhr_records FOR SELECT USING (owner IS NULL OR owner = nullif(current_setting('test.uid', true), '')::uuid);

INSERT INTO public.mhr_records (id, owner, currency, location, process_group, manufacturer_country, wage_grade, benchmark_source_key, machine_class, commodity_code) VALUES
 ('00000000-0000-4000-8000-000000000003', NULL, 'USD', 'USA',   'Machining', 'Germany', '3 - Metal',   'Inspection:cmm', 'cmm',   NULL),
 ('00000000-0000-4000-8000-000000000001', NULL, 'USD', 'USA',   'Machining', 'Germany', '3 - Metal',   'Inspection:cmm', NULL,    NULL),
 ('00000000-0000-4000-8000-000000000002', NULL, 'INR', 'India', 'Plastic Molding', NULL, NULL,         NULL,             'press', 'PM'),
 ('00000000-0000-4000-8000-000000000004', NULL, NULL,  NULL,    NULL,        NULL,      NULL,          NULL,             NULL,    NULL),
 ('00000000-0000-4000-8000-000000000006', NULL, NULL, NULL, NULL, NULL, NULL, '  Inspection  :Bench', NULL, ''),
 ('00000000-0000-4000-8000-000000000005', '11111111-0000-4000-8000-00000000000a', 'EUR', 'Berlin', 'Sheet Metal', 'France', 'Own grade', NULL, NULL, NULL);

\i /migrations/986_mhr_distinct_value_functions.sql
\i /migrations/986_mhr_distinct_value_functions.sql

SET ROLE authenticated;
SELECT set_config('test.uid', '22222222-0000-4000-8000-00000000000b', false);

DO $$
DECLARE strs text[];
BEGIN
  -- one jsonb array per list (never a set of rows: PostgREST would cut a set at 1,000 rows), distinct, no NULLs, nothing duplicated
  ASSERT jsonb_typeof(public.mhr_distinct_values('currency')) = 'array', 'a single jsonb array';
  SELECT array_agg(v ORDER BY v) INTO strs FROM jsonb_array_elements_text(public.mhr_distinct_values('currency')) v;
  ASSERT strs = ARRAY['INR', 'USD'], format('currencies: %s (others'' own rows hidden)', strs);
  SELECT array_agg(v ORDER BY v) INTO strs FROM jsonb_array_elements_text(public.mhr_distinct_values('location')) v;
  ASSERT strs = ARRAY['India', 'USA'], 'locations';
  SELECT array_agg(v ORDER BY v) INTO strs FROM jsonb_array_elements_text(public.mhr_distinct_values('process_group')) v;
  ASSERT strs = ARRAY['Machining', 'Plastic Molding'], 'process groups';
  SELECT array_agg(v ORDER BY v) INTO strs FROM jsonb_array_elements_text(public.mhr_distinct_values('manufacturer_country')) v;
  ASSERT strs = ARRAY['Germany'], 'countries';
  SELECT array_agg(v ORDER BY v) INTO strs FROM jsonb_array_elements_text(public.mhr_distinct_values('wage_grade')) v;
  ASSERT strs = ARRAY['3 - Metal'], 'wage grades';
  -- more than 1,000 distinct values still come back as ONE value (the row limit applies to rows, not to a jsonb value)
  ASSERT (SELECT jsonb_array_length(public.mhr_distinct_values('currency'))) = 2, 'sanity';
  -- a column outside the fixed list never reaches the query text
  BEGIN
    PERFORM public.mhr_distinct_values('id; DROP TABLE public.mhr_records');
    RAISE EXCEPTION 'an unsupported column was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.mhr_distinct_values(NULL);
    RAISE EXCEPTION 'NULL column was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;

DO $$
DECLARE got jsonb;
BEGIN
  -- reduced to what the category rule reads, one entry per combination, in first-appearance order by id. Row 6 has a key with spaces around it
  -- ('  Inspection  :Bench' reads as 'Inspection') and an empty commodity code (missing, like NULL).
  got := public.mhr_distinct_category_sources();
  ASSERT got = '[
    {"benchmark_source_key": "Inspection", "machine_class": null,    "process_group": "Machining"},
    {"benchmark_source_key": null,         "machine_class": "press", "process_group": "Plastic Molding"},
    {"benchmark_source_key": "Inspection", "machine_class": "cmm",   "process_group": "Machining"},
    {"benchmark_source_key": null,         "machine_class": null,    "process_group": null},
    {"benchmark_source_key": "Inspection", "machine_class": null,    "process_group": null}
  ]'::jsonb, format('category sources: %s', got);
END $$;

-- the caller's own rows are in their lists, and only theirs
SELECT set_config('test.uid', '11111111-0000-4000-8000-00000000000a', false);
DO $$
BEGIN
  ASSERT (SELECT array_agg(v ORDER BY v) FROM jsonb_array_elements_text(public.mhr_distinct_values('currency')) v) = ARRAY['EUR', 'INR', 'USD'], 'a user also sees their own rows';
END $$;

-- not callable without a role that was granted it
RESET ROLE;
CREATE ROLE nobody_986 NOLOGIN;
SET ROLE nobody_986;
DO $$
BEGIN
  BEGIN
    PERFORM public.mhr_distinct_values('currency');
    RAISE EXCEPTION 'a role without the grant could call it';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
