-- ============================================================================
-- Migration 631: Authorization bootstrap — close the gap between
-- organization_members and authorized_users permanently
--
-- Two separate, unrelated gates currently exist on top of Supabase Auth:
--   organization_members  (which org am I in / what's my role)
--   authorized_users       (am I allowed into the app at all — is_user_authorized())
-- Nothing has ever kept them in sync. Every account added to an org so far
-- (migration 624 for abushan.a@emuski.com, and migration 629's equivalent
-- for abushan.a@emithran.com) needed a SEPARATE, manually-written migration
-- (626, and now this one) just to also become authorized — real,
-- reproducible live evidence (2026-09-02 verification): EMITHRAN's owner
-- had correct org membership but was blocked from vendors/mhr_records/
-- calculators entirely (every table gated by is_user_authorized()) until
-- authorized.
--
-- Fix, two parts:
--   1. One-time backfill — authorize every account that already has an
--      active organization_members row but no authorized_users row.
--   2. A trigger on organization_members so this can never happen again:
--      any INSERT, or UPDATE that flips status to 'active', automatically
--      authorizes that member's email. Fires for every role (owner AND
--      member) — the "member" case is the exact bug already hit once
--      (abushan.a@emuski.com, migration 624/626), not just the "owner"
--      case (abushan.a@emithran.com, migration 629), so bootstrapping only
--      owners would leave the identical gap open for the next teammate
--      invite.
-- ============================================================================

-- ── Part 1: one-time backfill ────────────────────────────────────────────────

INSERT INTO authorized_users (email, full_name, role, is_active)
SELECT DISTINCT u.email, u.email, 'user', true
FROM organization_members om
JOIN auth.users u ON u.id = om.user_id
WHERE om.status = 'active'
ON CONFLICT (email) DO UPDATE SET is_active = true;

-- ── Part 2: trigger to keep this in sync going forward ──────────────────────

CREATE OR REPLACE FUNCTION auto_authorize_org_member()
RETURNS TRIGGER AS $$
DECLARE
    v_email TEXT;
BEGIN
    IF NEW.status = 'active' AND NEW.user_id IS NOT NULL THEN
        SELECT email INTO v_email FROM auth.users WHERE id = NEW.user_id;
        IF v_email IS NOT NULL THEN
            INSERT INTO authorized_users (email, full_name, role, is_active)
            VALUES (v_email, v_email, 'user', true)
            ON CONFLICT (email) DO UPDATE SET is_active = true;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- SECURITY DEFINER is required: authorized_users' own RLS (migration 018)
-- only grants INSERT/UPDATE to the service_role, and this trigger must be
-- able to write it on behalf of whatever role performs the
-- organization_members insert (an authenticated app user via
-- OrganizationContextGuard-backed endpoints, not service_role).

DROP TRIGGER IF EXISTS trg_auto_authorize_org_member ON organization_members;
CREATE TRIGGER trg_auto_authorize_org_member
    AFTER INSERT OR UPDATE ON organization_members
    FOR EACH ROW
    EXECUTE FUNCTION auto_authorize_org_member();

NOTIFY pgrst, 'reload schema';
