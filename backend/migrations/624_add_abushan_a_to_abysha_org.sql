-- ============================================================================
-- Migration 624: Add abushan.a@emuski.com as a member of the existing
-- "abysha" organization (correction/supersedes migration 623)
--
-- Migration 623 created a brand-new, separate organization owned by
-- 'abushan.a@emithran.com' — a typo'd email from the request that doesn't
-- match any real account (the real one, visible in the running app, is
-- 'abushan.a@emuski.com' — same domain as the existing org owner,
-- enquiries@emuski.com). Since auth.users had no row for the typo'd email,
-- 623's DO block hit its own RAISE EXCEPTION and aborted — nothing was
-- created, nothing to roll back.
--
-- Correct fix, per direct user confirmation: this is the SAME company as the
-- existing "abysha" org (same email domain), not a separate customer — add
-- them as a real member of that org instead of owning an isolated new one.
-- They'll then see all of abysha's vendors/HR rates/custom calculators
-- immediately via the existing org-scoped RLS (migrations 620/622,
-- mhr_records's own from the earlier tenancy phases) — no data cloning
-- needed, this is exactly the real-colleague-sharing case those migrations
-- were built for.
--
-- Per [[feedback_migration_identity_no_hardcode]]: both the new member's
-- user_id and the target organization's id are looked up live by email —
-- neither is a hardcoded/remembered UUID from a prior session's snapshot,
-- which could be stale.
-- ============================================================================

DO $$
DECLARE
    v_new_user_id UUID;
    v_org_id      UUID;
BEGIN
    SELECT id INTO v_new_user_id FROM auth.users WHERE email = 'abushan.a@emuski.com';
    IF v_new_user_id IS NULL THEN
        RAISE EXCEPTION 'No auth.users row found for abushan.a@emuski.com.';
    END IF;

    SELECT o.id INTO v_org_id
    FROM organizations o
    JOIN auth.users owner ON owner.id = o.owner_id
    WHERE owner.email = 'enquiries@emuski.com';
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'No organization found owned by enquiries@emuski.com.';
    END IF;

    INSERT INTO organization_members (organization_id, user_id, role, status)
    VALUES (v_org_id, v_new_user_id, 'member', 'active')
    ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'active';

    RAISE NOTICE 'Added user % to organization % as an active member.', v_new_user_id, v_org_id;
END $$;
