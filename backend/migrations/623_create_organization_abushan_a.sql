-- ============================================================================
-- Migration 623: Create a new organization for abushan.a@emithran.com
--
-- Requested directly by the user to test the master-data org-scoping work
-- (migrations 620-622) against a real second tenant — until now only one
-- live organization ("abysha") existed, so cross-org isolation could only be
-- reasoned about, never actually observed.
--
-- Per [[feedback_migration_identity_no_hardcode]]: does NOT hardcode any
-- UUID. The owning user's id is looked up live by email from auth.users at
-- migration-run time — this account was confirmed by the user to already
-- have a real login. If it doesn't (e.g. this is run before that person has
-- ever signed in), the migration aborts loudly instead of silently doing
-- nothing or guessing an id.
--
-- Org name is a placeholder ("Abushan A") derived from the email's local
-- part — rename it via the app's own Organization Settings UI once created,
-- no need to re-run this migration for that.
-- ============================================================================

DO $$
DECLARE
    v_user_id UUID;
    v_org_id  UUID;
BEGIN
    SELECT id INTO v_user_id FROM auth.users WHERE email = 'abushan.a@emithran.com';

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No auth.users row found for abushan.a@emithran.com — this account must sign in at least once before this migration can run.';
    END IF;

    -- Idempotency: if this user already owns an organization, do nothing
    -- rather than create a duplicate on a re-run.
    IF EXISTS (SELECT 1 FROM organizations WHERE owner_id = v_user_id) THEN
        RAISE NOTICE 'User % already owns an organization — skipping creation.', v_user_id;
        RETURN;
    END IF;

    INSERT INTO organizations (name, owner_id)
    VALUES ('Abushan A', v_user_id)
    RETURNING id INTO v_org_id;

    INSERT INTO organization_members (organization_id, user_id, role, status)
    VALUES (v_org_id, v_user_id, 'owner', 'active');

    RAISE NOTICE 'Created organization % for user %.', v_org_id, v_user_id;
END $$;
