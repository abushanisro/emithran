-- ============================================================================
-- Migration 545: Resolve the orphan-user hold + populate authorized_users
--
-- Two things confirmed by the user (2026-08-22), previously held open:
--
-- 1. The "orphan user" from migrations 543/544's transitional clause
--    (417c3a4c-16c7-4467-93c6-1299c618c22b, email abushan.isro@gmail.com) is
--    confirmed to belong to the SAME organization as the existing owner
--    (enquiries@emuski.com, org "abysha" = cd0d0963-419a-44b6-8b06-6b38bd547946),
--    not a separate tenant. Adds their organization_members row and backfills
--    their mhr_records rows accordingly.
--
--    CORRECTION to migrations 543/544's own comments: those files said "425
--    rows" for this user based on an earlier, incorrect cross-reference.
--    Verified directly against the live DB before writing this migration:
--    the real split is 281 rows owned by the org owner (already backfilled
--    by 543) + 144 rows owned by this user (not yet backfilled) + 13 true
--    global rows (user_id IS NULL, untouched) = 438 total. This migration
--    backfills exactly those 144 rows — the WHERE clause was always
--    correct (keyed on user_id, not a row count), only the prose comment in
--    543/544 was wrong. Not editing those already-applied files (append-
--    only migration history) — corrected here instead.
--
-- 2. authorized_users was found completely EMPTY (0 rows) — is_user_authorized()
--    has been returning FALSE for every real user of this app, not just
--    these two. Populating both real accounts now closes that gap for the
--    only two accounts that exist today. This does not change is_user_
--    authorized()'s own logic — same allowlist gate as before, just no
--    longer vacuous.
-- ============================================================================

-- ── 1. Orphan-user org membership + backfill ─────────────────────────────────

INSERT INTO organization_members (organization_id, user_id, role, status)
VALUES ('cd0d0963-419a-44b6-8b06-6b38bd547946', '417c3a4c-16c7-4467-93c6-1299c618c22b', 'member', 'active')
ON CONFLICT (organization_id, user_id) DO NOTHING;

UPDATE mhr_records
SET organization_id = 'cd0d0963-419a-44b6-8b06-6b38bd547946'
WHERE user_id = '417c3a4c-16c7-4467-93c6-1299c618c22b'
  AND organization_id IS NULL;

-- ── 2. Populate authorized_users for both real accounts ──────────────────────

INSERT INTO authorized_users (email, full_name, role, is_active)
VALUES
    ('enquiries@emuski.com', 'Emuski (org owner)', 'admin', true),
    ('abushan.isro@gmail.com', 'Abushan (org member)', 'user', true)
ON CONFLICT (email) DO NOTHING;
