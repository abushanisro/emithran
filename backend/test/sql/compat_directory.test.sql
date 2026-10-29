-- Migration 932 on a bare Postgres with 930+931: the user directory is readable only through service-only functions, only for the ids asked.
\i /migrations/932_user_directory.sql
\i /migrations/932_user_directory.sql

DO $$
DECLARE a uuid; b uuid;
BEGIN
  a := public.provision_user('alice@example.com', 'Alice A');
  b := public.provision_user('bob@example.com');
  ASSERT (SELECT count(*) FROM public.directory_users(ARRAY[a])) = 1, 'only the id asked for is returned';
  ASSERT (SELECT full_name FROM public.directory_users(ARRAY[a])) = 'Alice A', 'name read';
  ASSERT (SELECT email FROM public.directory_users(ARRAY[b])) = 'bob@example.com', 'email read';
  ASSERT (SELECT count(*) FROM public.directory_users(NULL)) = 0 AND (SELECT count(*) FROM public.directory_users('{}')) = 0, 'no ids, no users';
  ASSERT public.directory_find_by_email('ALICE@Example.com') = a, 'find by email is case-insensitive';
  ASSERT public.directory_find_by_email('nobody@example.com') IS NULL, 'unknown email';
  PERFORM public.directory_set_full_name(b, 'Bob B');
  ASSERT (SELECT full_name FROM public.directory_users(ARRAY[b])) = 'Bob B', 'name updated';
  ASSERT (SELECT full_name FROM public.directory_users(ARRAY[a])) = 'Alice A', 'other users untouched';
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.directory_users(uuid[])', 'public.directory_find_by_email(text)', 'public.directory_set_full_name(uuid,text)'] LOOP
    ASSERT has_function_privilege('service_role', fn, 'EXECUTE'), fn || ' callable by service_role';
    ASSERT NOT has_function_privilege('authenticated', fn, 'EXECUTE'), fn || ' not callable by signed-in users';
    ASSERT NOT has_function_privilege('anon', fn, 'EXECUTE'), fn || ' not callable by anon';
  END LOOP;
END $$;
