-- ============================================================================
-- Migration 543: Backfill organization_id for mhr_records, boms, bom_items
--
-- Phase 2 backfill step of the org-scoped tenancy initiative (see
-- .claude/plans/delegated-gliding-swan.md). Live data checked directly
-- against the DB before writing this (2026-08-22):
--   - The one existing organization ("abysha") has exactly one real member,
--     5572f34d-2f51-456e-a5d7-96f840128b50 (owner).
--   - mhr_records also has 13 rows with user_id IS NULL (true global/
--     benchmark rows — untouched, organization_id stays NULL, that IS the
--     global-default state) and 425 rows owned by a second user,
--     417c3a4c-16c7-4467-93c6-1299c618c22b, who has ZERO organization_members
--     row at all.
--
-- The 417c3a4c-... rows are DELIBERATELY NOT backfilled here — held pending
-- confirming who that account is, per explicit instruction. Migration 544's
-- transitional RLS clause keeps those rows exactly as accessible as they are
-- today (owner-only via user_id) until a follow-up migration resolves them
-- one way or the other. Do not extend this UPDATE to cover them without
-- that confirmation.
-- ============================================================================

UPDATE mhr_records
SET organization_id = 'cd0d0963-419a-44b6-8b06-6b38bd547946'
WHERE user_id = '5572f34d-2f51-456e-a5d7-96f840128b50'
  AND organization_id IS NULL;

UPDATE boms
SET organization_id = 'cd0d0963-419a-44b6-8b06-6b38bd547946'
WHERE user_id = '5572f34d-2f51-456e-a5d7-96f840128b50'
  AND organization_id IS NULL;

-- bom_items has no reliable independent ownership signal of its own —
-- inherits organization_id from its parent bom, not re-derived from any
-- user_id column on bom_items itself.
UPDATE bom_items
SET organization_id = boms.organization_id
FROM boms
WHERE bom_items.bom_id = boms.id
  AND bom_items.organization_id IS NULL
  AND boms.organization_id IS NOT NULL;
