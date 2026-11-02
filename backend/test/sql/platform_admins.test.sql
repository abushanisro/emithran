-- 943: platform admins are granted by SQL only, no API role can read or change the list, and is_platform_admin answers only for
-- the caller.
INSERT INTO auth.users (id) VALUES ('11111111-0000-4000-8000-00000000000a'), ('11111111-0000-4000-8000-00000000000b');
INSERT INTO public.platform_admins (user_id, granted_by) VALUES ('11111111-0000-4000-8000-00000000000a', '11111111-0000-4000-8000-00000000000b');

\i /migrations/943_platform_admins.sql

SET ROLE authenticated;
SELECT set_config('test.uid', '11111111-0000-4000-8000-00000000000a', false);
DO $$
BEGIN
  ASSERT public.is_platform_admin('11111111-0000-4000-8000-00000000000a'), 'a platform admin is recognised';
  ASSERT NOT public.is_platform_admin(NULL), 'no user is no admin';
  BEGIN
    PERFORM count(*) FROM public.platform_admins;
    RAISE EXCEPTION 'a signed-in user read platform_admins';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.platform_admins (user_id, granted_by) VALUES ('11111111-0000-4000-8000-00000000000b', auth.uid());
    RAISE EXCEPTION 'a signed-in user granted platform admin';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- b is not an admin, and cannot learn that a is one.
SELECT set_config('test.uid', '11111111-0000-4000-8000-00000000000b', false);
DO $$
BEGIN
  ASSERT NOT public.is_platform_admin('11111111-0000-4000-8000-00000000000b'), 'b is not a platform admin';
  ASSERT NOT public.is_platform_admin('11111111-0000-4000-8000-00000000000a'), 'b cannot probe whether a is one';
END $$;
RESET ROLE;

-- Revoking is one DELETE and takes effect at once.
DELETE FROM public.platform_admins WHERE user_id = '11111111-0000-4000-8000-00000000000a';
SET ROLE authenticated;
SELECT set_config('test.uid', '11111111-0000-4000-8000-00000000000a', false);
DO $$
BEGIN
  ASSERT NOT public.is_platform_admin('11111111-0000-4000-8000-00000000000a'), 'a revoked admin is no longer one';
END $$;
RESET ROLE;

DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.is_platform_admin(uuid)', 'EXECUTE'), 'anon cannot ask';
  ASSERT (SELECT proconfig FROM pg_proc WHERE oid = 'public.is_platform_admin(uuid)'::regprocedure) = '{"search_path=public, pg_temp"}',
    'is_platform_admin has a pinned search_path';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.platform_admins'::regclass), 'row-level security is on';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'platform_admins'), 'and no policy opens it';
END $$;
