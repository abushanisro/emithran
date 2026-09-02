-- ============================================================================
-- Migration 632: HR Rates (mhr_records) legacy per-creator RLS cleanup
--
-- Closes technical debt migration 544 (2026-08-22) explicitly flagged and
-- deferred: "mhr_records keeps a TRANSITIONAL clause... for the 425 rows
-- owned by [an unresolved account]... Once that's resolved and those rows
-- get a real organization_id, this transitional clause becomes dead weight
-- for them — it should be dropped in a follow-up migration at that point,
-- not left indefinitely." That account is now fully resolved and confirmed
-- (5572f34d-2f51-456e-a5d7-96f840128b50, enquiries@emuski.com, the real
-- EMUSKI/abysha owner) — 20 of their mhr_records rows are still
-- organization_id IS NULL, visible only to them personally (not their
-- EMUSKI teammates) via the transitional `(organization_id IS NULL AND
-- user_id = auth.uid())` clause. Confirmed live during Phase 7 verification
-- (2026-09-02): abushan.a@emuski.com, a real active EMUSKI member, cannot
-- see these 20 rows despite being on the same team.
--
-- Two steps, no schema changes:
--   1. Reassign the 20 rows to their owner's real organization (generic
--      join, not a hardcoded org/user UUID).
--   2. Rebuild mhr_records' 4 policies without the per-creator branch —
--      the OTHER transitional branch, `(organization_id IS NULL AND
--      user_id IS NULL)`, is NOT touched: that's the 1585 genuinely global/
--      benchmark rows (no creator at all), a real, permanent, intentional
--      part of the design, not debt.
--
-- Policies are rebuilt via a dynamic pg_policies loop (not named DROP
-- POLICY IF EXISTS) — this codebase has already shown undocumented live
-- policy drift twice this initiative (vendors, calculators), so this is the
-- more robust technique for a high-traffic table like mhr_records rather
-- than trusting the names migration 544 is believed to have used.
-- ============================================================================

-- ── Step 1: reassign legacy creator-owned rows to their real organization ──

UPDATE mhr_records m
SET organization_id = om.organization_id
FROM organization_members om
WHERE m.user_id = om.user_id
  AND om.status = 'active'
  AND m.organization_id IS NULL
  AND m.user_id IS NOT NULL;

-- ── Step 2: rebuild RLS without the per-creator transitional branch ────────

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'mhr_records'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.mhr_records', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "org_select_own_and_global" ON mhr_records FOR SELECT
    USING (
        is_user_authorized() AND (
            (organization_id IS NOT NULL AND organization_id IN (SELECT current_user_org_ids()))
            OR (organization_id IS NULL AND user_id IS NULL)
        )
    );

CREATE POLICY "org_insert_own" ON mhr_records FOR INSERT
    WITH CHECK (
        is_user_authorized() AND organization_id IN (SELECT current_user_org_ids())
    );

CREATE POLICY "org_update_own" ON mhr_records FOR UPDATE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_delete_own" ON mhr_records FOR DELETE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

NOTIFY pgrst, 'reload schema';
