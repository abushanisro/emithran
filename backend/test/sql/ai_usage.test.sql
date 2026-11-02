-- 949: AI usage is counted per user, organization and day; only the caller's own row grows, only for the caller's organizations,
-- and nobody can lower a total or write the table directly.
INSERT INTO auth.users (id) VALUES ('11111111-0000-4000-8000-00000000000a'), ('11111111-0000-4000-8000-00000000000b');
INSERT INTO public.organizations (id) VALUES ('aaaaaaaa-0000-4000-8000-000000000001'), ('bbbbbbbb-0000-4000-8000-000000000002');

\i /migrations/949_ai_usage_daily.sql
\i /migrations/949_ai_usage_daily.sql

SET ROLE authenticated;
SELECT set_config('test.uid', '11111111-0000-4000-8000-00000000000a', false);
SELECT set_config('test.org_ids', 'aaaaaaaa-0000-4000-8000-000000000001', false);
SELECT public.ai_usage_record('aaaaaaaa-0000-4000-8000-000000000001', 1000, 200);
SELECT public.ai_usage_record('aaaaaaaa-0000-4000-8000-000000000001', 300, 50);

DO $$
DECLARE t record;
BEGIN
  SELECT * INTO t FROM public.ai_usage_today('aaaaaaaa-0000-4000-8000-000000000001');
  ASSERT t.user_tokens = 1550 AND t.organization_tokens = 1550 AND t.global_tokens = 1550, format('A after two calls: %s', t);
  ASSERT (SELECT calls FROM public.ai_usage_daily) = 2, 'one row, two calls (atomic upsert)';
  -- not a member of B: neither read nor write B's counters
  BEGIN
    PERFORM public.ai_usage_record('bbbbbbbb-0000-4000-8000-000000000002', 1, 1);
    RAISE EXCEPTION 'A recorded usage for B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.ai_usage_today('bbbbbbbb-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'A read B''s usage';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- a total can never be lowered
  BEGIN
    PERFORM public.ai_usage_record('aaaaaaaa-0000-4000-8000-000000000001', -1000, 0);
    RAISE EXCEPTION 'a negative amount was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    UPDATE public.ai_usage_daily SET input_tokens = 0;
    RAISE EXCEPTION 'the table was written directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.ai_usage_daily;
    RAISE EXCEPTION 'a row was deleted directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- B, in organization B, sees only its own row, but the deployment total includes A's spend.
SELECT set_config('test.uid', '11111111-0000-4000-8000-00000000000b', false);
SELECT set_config('test.org_ids', 'bbbbbbbb-0000-4000-8000-000000000002', false);
SELECT public.ai_usage_record('bbbbbbbb-0000-4000-8000-000000000002', 10, 5);
DO $$
DECLARE t record;
BEGIN
  SELECT * INTO t FROM public.ai_usage_today('bbbbbbbb-0000-4000-8000-000000000002');
  ASSERT t.user_tokens = 15 AND t.organization_tokens = 15 AND t.global_tokens = 1565, format('B: %s', t);
  ASSERT (SELECT count(*) FROM public.ai_usage_daily) = 1, 'B reads only its own row';
END $$;
RESET ROLE;

SET ROLE anon;
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.ai_usage_record(uuid, bigint, bigint)', 'EXECUTE'), 'anon cannot record';
  ASSERT NOT has_function_privilege('anon', 'public.ai_usage_today(uuid)', 'EXECUTE'), 'anon cannot read';
  ASSERT NOT has_table_privilege('anon', 'public.ai_usage_daily', 'SELECT'), 'anon cannot read the table';
END $$;
RESET ROLE;

DO $$
BEGIN
  ASSERT (SELECT bool_and(p.prosecdef AND p.proconfig::text LIKE '%search_path=public, pg_temp%') FROM pg_proc p
           WHERE p.proname IN ('ai_usage_today', 'ai_usage_record')), 'definer functions pin search_path';
END $$;
