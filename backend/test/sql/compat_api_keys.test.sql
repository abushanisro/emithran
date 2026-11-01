-- Migration 935 on a bare Postgres with 930-932: API keys are bound to one organization, can only be revoked, and authenticate only
-- while they are valid. The tables below are the parts of migrations 200 and the organization schema that 935 builds on.
CREATE TABLE public.authorized_users (email text PRIMARY KEY, is_active boolean DEFAULT true);
CREATE TABLE public.organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.organization_members (
  organization_id uuid NOT NULL REFERENCES public.organizations(id), user_id uuid NOT NULL, status text NOT NULL DEFAULT 'active'
);
CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  key_hash varchar(64) NOT NULL UNIQUE,
  key_prefix varchar(12) NOT NULL,
  scopes text[] NOT NULL DEFAULT '{"read"}',
  last_used_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_keys_user_select ON public.api_keys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY api_keys_user_insert ON public.api_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY api_keys_user_update ON public.api_keys FOR UPDATE USING (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_keys TO authenticated;

-- Alice (one organization), Bob (two organizations), and an old-style key of Alice's from before 935.
DO $$
DECLARE alice uuid; bob uuid;
BEGIN
  alice := public.provision_user('alice@example.com');
  bob := public.provision_user('bob@example.com');
  INSERT INTO public.authorized_users VALUES ('alice@example.com', true), ('bob@example.com', true);
  INSERT INTO public.organizations (id) VALUES ('aaaaaaaa-0000-4000-8000-000000000001'), ('bbbbbbbb-0000-4000-8000-000000000002');
  INSERT INTO public.organization_members VALUES ('aaaaaaaa-0000-4000-8000-000000000001', alice),
    ('aaaaaaaa-0000-4000-8000-000000000001', bob), ('bbbbbbbb-0000-4000-8000-000000000002', bob);
  INSERT INTO public.api_keys (user_id, name, key_hash, key_prefix, scopes) VALUES (alice, 'old', repeat('0', 64), 'mk_live_0000', '{read}');
END $$;

\i /migrations/935_api_keys_auth.sql
\i /migrations/935_api_keys_auth.sql

DO $$
BEGIN
  ASSERT (SELECT revoked_at IS NOT NULL FROM public.api_keys WHERE name = 'old'), 'keys from before 935 are revoked';
  ASSERT (SELECT status FROM public.authenticate_api_key(repeat('0', 64))) = 'revoked', 'and do not authenticate';
  ASSERT (SELECT status FROM public.authenticate_api_key(repeat('f', 64))) = 'unknown', 'an unknown hash is unknown';
  ASSERT (SELECT key_id FROM public.authenticate_api_key(repeat('f', 64))) IS NULL, 'and reveals nothing';
  ASSERT NOT has_function_privilege('authenticated', 'public.authenticate_api_key(text)', 'EXECUTE'), 'signed-in users cannot look keys up';
  ASSERT NOT has_function_privilege('anon', 'public.authenticate_api_key(text)', 'EXECUTE'), 'nor can anon';
  ASSERT has_function_privilege('service_role', 'public.authenticate_api_key(text)', 'EXECUTE'), 'only the backend can';
END $$;

-- Alice issues a key for her one organization, as PostgREST would run it.
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM auth.users WHERE email = 'alice@example.com'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;
INSERT INTO public.api_keys (user_id, name, key_hash, key_prefix, scopes, organization_id, expires_at)
  VALUES (auth.uid(), 'erp', repeat('a', 64), 'mk_live_aaaa', '{projects:read}', 'aaaaaaaa-0000-4000-8000-000000000001', now() + interval '90 days');

DO $$
BEGIN
  -- not for another organization
  BEGIN
    INSERT INTO public.api_keys (user_id, name, key_hash, key_prefix, scopes, organization_id, expires_at)
      VALUES (auth.uid(), 'x', repeat('b', 64), 'mk_live_bbbb', '{projects:read}', 'bbbbbbbb-0000-4000-8000-000000000002', now() + interval '1 day');
    RAISE EXCEPTION 'inserted a key for an organization Alice is not in';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- not without expiry, not for more than a year
  BEGIN
    INSERT INTO public.api_keys (user_id, name, key_hash, key_prefix, scopes, organization_id)
      VALUES (auth.uid(), 'x', repeat('c', 64), 'mk_live_cccc', '{projects:read}', 'aaaaaaaa-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'inserted a key without expiry';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.api_keys (user_id, name, key_hash, key_prefix, scopes, organization_id, expires_at)
      VALUES (auth.uid(), 'x', repeat('d', 64), 'mk_live_dddd', '{projects:read}', 'aaaaaaaa-0000-4000-8000-000000000001', now() + interval '400 days');
    RAISE EXCEPTION 'inserted a key valid for more than a year';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- not with an unknown scope
  BEGIN
    INSERT INTO public.api_keys (user_id, name, key_hash, key_prefix, scopes, organization_id, expires_at)
      VALUES (auth.uid(), 'x', repeat('e', 64), 'mk_live_eeee', '{admin}', 'aaaaaaaa-0000-4000-8000-000000000001', now() + interval '1 day');
    RAISE EXCEPTION 'inserted a key with an unknown scope';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- a key can only be revoked, never widened
  BEGIN
    UPDATE public.api_keys SET scopes = '{projects:read,projects:write}' WHERE name = 'erp';
    RAISE EXCEPTION 'changed the scopes of a key';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.api_keys SET expires_at = now() + interval '300 days' WHERE name = 'erp';
    RAISE EXCEPTION 'changed the expiry of a key';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.authenticate_api_key(repeat('a', 64));
  ASSERT r.status = 'ok', 'a valid key authenticates';
  ASSERT r.email = 'alice@example.com' AND r.organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND r.scopes = '{projects:read}', 'with its owner, organization and scopes';
  ASSERT (SELECT last_used_at IS NOT NULL FROM public.api_keys WHERE name = 'erp'), 'and records when it was used';

  -- Alice joins a second organization: the key stops working (RLS could no longer keep it to one organization)
  INSERT INTO public.organization_members VALUES ('bbbbbbbb-0000-4000-8000-000000000002', r.user_id);
  ASSERT (SELECT status FROM public.authenticate_api_key(repeat('a', 64))) = 'organization', 'a multi-organization owner is refused';
  DELETE FROM public.organization_members WHERE organization_id = 'bbbbbbbb-0000-4000-8000-000000000002' AND user_id = r.user_id;
  -- removed from the key's organization: refused
  UPDATE public.organization_members SET status = 'inactive' WHERE user_id = r.user_id;
  ASSERT (SELECT status FROM public.authenticate_api_key(repeat('a', 64))) = 'organization', 'an owner who left the organization is refused';
  UPDATE public.organization_members SET status = 'active' WHERE user_id = r.user_id;
  -- no longer invited: refused
  UPDATE public.authorized_users SET is_active = false WHERE email = 'alice@example.com';
  ASSERT (SELECT status FROM public.authenticate_api_key(repeat('a', 64))) = 'not_authorized', 'an uninvited owner is refused';
  UPDATE public.authorized_users SET is_active = true WHERE email = 'alice@example.com';
  -- expired: refused
  UPDATE public.api_keys SET expires_at = now() - interval '1 second' WHERE name = 'erp';
  ASSERT (SELECT status FROM public.authenticate_api_key(repeat('a', 64))) = 'expired', 'an expired key is refused';
  UPDATE public.api_keys SET expires_at = now() + interval '1 day' WHERE name = 'erp';
  ASSERT (SELECT status FROM public.authenticate_api_key(repeat('a', 64))) = 'ok', 'and works again once valid';
END $$;

-- Alice revokes it herself; she cannot un-revoke it.
SET ROLE authenticated;
UPDATE public.api_keys SET revoked_at = now() WHERE name = 'erp';
DO $$
BEGIN
  BEGIN
    UPDATE public.api_keys SET revoked_at = NULL WHERE name = 'erp';
    RAISE EXCEPTION 'un-revoked a key';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT status FROM public.authenticate_api_key(repeat('a', 64))) = 'revoked', 'a revoked key is refused'; END $$;

-- Bob is in two organizations: he cannot issue a key at all yet.
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM auth.users WHERE email = 'bob@example.com'), 'role', 'authenticated')::text, false);
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.api_keys (user_id, name, key_hash, key_prefix, scopes, organization_id, expires_at)
      VALUES (auth.uid(), 'x', repeat('9', 64), 'mk_live_9999', '{projects:read}', 'aaaaaaaa-0000-4000-8000-000000000001', now() + interval '1 day');
    RAISE EXCEPTION 'a multi-organization user issued a key';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
