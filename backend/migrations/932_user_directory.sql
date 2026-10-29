-- ============================================================================
-- Migration 932: reading the user directory without the Supabase admin API
-- ============================================================================
-- The backend used auth.admin.listUsers/getUserById/updateUserById to show a person's email and name. On plain Postgres the `auth`
-- schema is not exposed by PostgREST, so these three SECURITY DEFINER functions do the same jobs, callable by service_role ONLY.
--   directory_users(ids)            -> id, email, full_name for exactly the ids asked (never the whole directory)
--   directory_find_by_email(email)  -> the user's id or NULL (case-insensitive)
--   directory_set_full_name(id, n)  -> keeps the display name in sync
-- Idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.directory_users(p_ids uuid[])
RETURNS TABLE (id uuid, email text, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email, u.raw_user_meta_data ->> 'full_name'
  FROM auth.users u
  WHERE u.id = ANY (coalesce(p_ids, '{}'::uuid[]));
$$;

CREATE OR REPLACE FUNCTION public.directory_find_by_email(p_email text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT u.id FROM auth.users u WHERE lower(u.email) = lower(p_email) ORDER BY u.created_at LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.directory_set_full_name(p_user_id uuid, p_full_name text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  UPDATE auth.users
  SET raw_user_meta_data = jsonb_set(coalesce(raw_user_meta_data, '{}'::jsonb), '{full_name}', to_jsonb(p_full_name)), updated_at = now()
  WHERE id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.directory_users(uuid[]), public.directory_find_by_email(text), public.directory_set_full_name(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.directory_users(uuid[]), public.directory_find_by_email(text), public.directory_set_full_name(uuid, text)
  TO service_role;
