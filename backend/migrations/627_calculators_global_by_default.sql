-- ============================================================================
-- Migration 627: Make calculators global-by-default, matching raw_materials
-- and the process cluster — supersedes 622's per-org treatment of existing
-- rows
--
-- Live data check (2026-09-02, via a real impersonated session, not just
-- service-role): of the 65 live calculators, 63 carry `user_id =
-- 5572f34d-2f51-456e-a5d7-96f840128b50` — the SAME single seed/developer
-- account migration 470's own header comment already warned about ("Every
-- existing calculator-seed migration (calculators/001-056) hardcodes the
-- same one real developer/tester's auth.users row as user_id -- not a
-- system identity"). Migration 622 treated `user_id IS NOT NULL` as "real
-- per-company custom calculator" and backfilled all 63 to the abysha org —
-- technically correct given the schema, but wrong in substance: these are
-- platform costing-engine definitions (Injection Molding Cycle Time,
-- Machining - Turning, Sheet Metal - Bending Manufacturing, etc.), not one
-- company's proprietary formulas. The user confirmed directly: these should
-- be global to every organization, the same as raw_materials/process.
--
-- Fix: decouple "is this calculator global" from `user_id` (kept as a
-- historical/audit-trail field only, exactly as raw_materials already treats
-- its own `user_id` column per migration 351's comment) and key it on
-- `organization_id IS NULL` instead, matching every other reference-catalog
-- table in this initiative. All 63 rows currently org-scoped to abysha
-- revert to organization_id = NULL — visible to every org again, exactly as
-- they always were before migration 622. A genuinely new calculator a user
-- creates going forward still gets `organization_id` = their own org on
-- INSERT (unchanged) — only pre-existing seed data is affected here.
-- ============================================================================

-- ── Data: un-scope every currently org-owned calculator back to global ─────

UPDATE calculators
SET organization_id = NULL
WHERE organization_id IS NOT NULL;

-- ── RLS: calculators SELECT — organization_id IS NULL (not user_id IS NULL)
-- is now what makes a row global ────────────────────────────────────────────

DROP POLICY IF EXISTS "org_select_calculators" ON calculators;

CREATE POLICY "org_select_calculators" ON calculators FOR SELECT
    USING (
        is_user_authorized() AND (
            organization_id IS NULL
            OR is_public = true
            OR organization_id IN (SELECT current_user_org_ids())
        )
    );

-- INSERT/UPDATE/DELETE policies (org_insert_calculators, org_update_calculators,
-- org_delete_calculators) are unchanged from migration 622 — a newly created
-- calculator still gets organization_id = the creating org (never NULL via
-- the authenticated path), and the shared global catalog stays protected
-- from being edited/deleted by any single org, same as raw_materials/process.

NOTIFY pgrst, 'reload schema';
