-- ============================================================================
-- Migration 629: Create a new organization "EMITHRAN" owned by
-- abushan.a@emithran.com
--
-- Requires that account to already exist in auth.users — this migration
-- does NOT create it (account creation / password handling is not something
-- done via a migration; sign up through the app's normal auth flow, or
-- create the user in the Supabase dashboard, first). If run before that
-- account exists, this aborts loudly rather than silently doing nothing.
--
-- Per [[feedback_migration_identity_no_hardcode]]: the owning user's id is
-- looked up live by email, not a hardcoded/remembered UUID.
-- ============================================================================

DO $$
DECLARE
    v_user_id UUID;
    v_org_id  UUID;
BEGIN
    SELECT id INTO v_user_id FROM auth.users WHERE email = 'abushan.a@emithran.com';
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No auth.users row found for abushan.a@emithran.com — that account must be created (app sign-up or Supabase dashboard) before this migration can run.';
    END IF;

    IF EXISTS (SELECT 1 FROM organizations WHERE owner_id = v_user_id) THEN
        RAISE NOTICE 'User % already owns an organization — skipping creation.', v_user_id;
        RETURN;
    END IF;

    INSERT INTO organizations (name, owner_id)
    VALUES ('EMITHRAN', v_user_id)
    RETURNING id INTO v_org_id;

    INSERT INTO organization_members (organization_id, user_id, role, status)
    VALUES (v_org_id, v_user_id, 'owner', 'active');

    RAISE NOTICE 'Created organization % (EMITHRAN) for user %.', v_org_id, v_user_id;
END $$;
