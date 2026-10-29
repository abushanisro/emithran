-- 922: a table with the Supabase default grants (anon has everything) and a view over it; after the migration anon has nothing,
-- signed-in users keep the data privileges but lose TRUNCATE/REFERENCES/TRIGGER, and a table created afterwards starts closed.
CREATE TABLE public.sample_rates (id int PRIMARY KEY, v text);
CREATE VIEW public.sample_rates_summary AS SELECT id FROM public.sample_rates;
CREATE SEQUENCE public.sample_seq;
GRANT ALL ON public.sample_rates, public.sample_rates_summary, public.sample_seq TO anon, authenticated;

\i /migrations/922_revoke_anon_table_access.sql
\i /migrations/922_revoke_anon_table_access.sql

CREATE TABLE public.created_later (id int);

DO $$
BEGIN
  ASSERT NOT has_table_privilege('anon', 'public.sample_rates', 'SELECT'), 'anon cannot read a table';
  ASSERT NOT has_table_privilege('anon', 'public.sample_rates', 'INSERT'), 'anon cannot write a table';
  ASSERT NOT has_table_privilege('anon', 'public.sample_rates_summary', 'SELECT'), 'anon cannot read a view (views skip RLS)';
  ASSERT NOT has_sequence_privilege('anon', 'public.sample_seq', 'USAGE'), 'anon cannot use a sequence';
  ASSERT has_table_privilege('authenticated', 'public.sample_rates', 'SELECT')
     AND has_table_privilege('authenticated', 'public.sample_rates', 'UPDATE'), 'signed-in users keep data access';
  ASSERT NOT has_table_privilege('authenticated', 'public.sample_rates', 'TRUNCATE'), 'no TRUNCATE for the API roles';
  ASSERT NOT has_table_privilege('authenticated', 'public.sample_rates', 'TRIGGER'), 'no TRIGGER for the API roles';
  ASSERT NOT has_table_privilege('anon', 'public.created_later', 'SELECT'), 'a table created later starts closed to anon';
END
$$;
