-- ============================================================================
-- Migration 546: Orphan-user org membership + mhr_records backfill
--
-- User confirmed directly (2026-08-22) that abushan.isro@gmail.com
-- (417c3a4c-16c7-4467-93c6-1299c618c22b) is their own account — not a
-- second real customer/contractor. Cleared to run. (Held on this
-- confirmation before writing it this way — the earlier inference from a
-- similar git author email was evidence, not confirmation.)
--
-- Running this:
--   1. Adds 417c3a4c-... to organization_members for org cd0d0963-... (role
--      'member', status 'active').
--   2. Backfills their 144 mhr_records rows (owner-only today via the
--      transitional clause in migration 544) to organization_id =
--      cd0d0963-... — after this, the transitional clause no longer applies
--      to any of their rows (organization_id is no longer NULL for them).
--
-- Correction to migrations 543/544's own "425 rows" comment: verified
-- directly against the live DB before writing this — the real split is 281
-- rows (org owner, already backfilled by 543) + 144 rows (this user) + 13
-- true-global rows (user_id IS NULL, untouched) = 438 total. Not editing
-- 543/544 themselves (already applied, append-only migration history).
-- ============================================================================

INSERT INTO organization_members (organization_id, user_id, role, status)
VALUES ('cd0d0963-419a-44b6-8b06-6b38bd547946', '417c3a4c-16c7-4467-93c6-1299c618c22b', 'member', 'active')
ON CONFLICT (organization_id, user_id) DO NOTHING;

UPDATE mhr_records
SET organization_id = 'cd0d0963-419a-44b6-8b06-6b38bd547946'
WHERE user_id = '417c3a4c-16c7-4467-93c6-1299c618c22b'
  AND organization_id IS NULL;
