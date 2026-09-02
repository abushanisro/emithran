-- ============================================================================
-- Migration 626: Add abushan.a@emuski.com to the authorized_users allowlist
--
-- Root cause of "HR Rates still shows no records" even after migration 624
-- (adding this user to the abysha organization): is_user_authorized()
-- (migration 019) is ANDed into every RLS policy on mhr_records, vendors,
-- and calculators (and others) — it checks auth.users.email against
-- authorized_users.is_active, completely independent of organization
-- membership. A user absent from authorized_users sees zero rows on any
-- gated table regardless of which org they belong to. abushan.isro@gmail.com
-- and enquiries@emuski.com were both added here in migration 545 (per
-- [[project_org_scoped_tenancy]]) — abushan.a@emuski.com, being a newly
-- created account, was never added.
--
-- authorized_users is keyed by email, not user_id — no auth.users lookup or
-- UUID needed at all here, so there's no hardcoded-identity risk.
-- ============================================================================

INSERT INTO authorized_users (email, full_name, role, is_active)
VALUES ('abushan.a@emuski.com', 'Abushan A', 'user', true)
ON CONFLICT (email) DO UPDATE SET is_active = true;
