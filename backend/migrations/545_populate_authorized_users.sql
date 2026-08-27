-- ============================================================================
-- Migration 545: Populate authorized_users for the two real accounts
--
-- authorized_users was found completely EMPTY (0 rows) — is_user_authorized()
-- has been returning FALSE for every real user of this app. This does not
-- change is_user_authorized()'s own logic — same allowlist gate as before,
-- just no longer vacuous. Not contingent on the separate orphan-user org
-- membership question (see 546) — this part was confirmed safe on its own.
-- ============================================================================

INSERT INTO authorized_users (email, full_name, role, is_active)
VALUES
    ('enquiries@emuski.com', 'Emuski (org owner)', 'admin', true),
    ('abushan.isro@gmail.com', 'Abushan', 'user', true)
ON CONFLICT (email) DO NOTHING;
