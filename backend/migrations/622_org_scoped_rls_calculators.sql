-- ============================================================================
-- Migration 622: Org-scoped RLS for calculators, calculator_fields,
-- calculator_formulas + close a confirmed policy-erosion bug
--
-- Phase 7c of the master-data org-scoping initiative (see
-- .claude/plans/vivid-conjuring-reef.md).
--
-- CONFIRMED EROSION BUG: migration 100_rebuild_calculator_system.sql created
-- ungated policies ("Users can view/create/update/delete their own
-- calculators", and the fields/formulas equivalents). migration
-- 210_add_associated_process_to_calculators.sql added a further ungated
-- FOR ALL policy (calculators_tenant_isolation). migration
-- 020_fix_rls_authorization.sql added is_user_authorized()-gated policies
-- under DIFFERENT names ("Authorized users can ..."), and migration
-- 470_calculators_nullable_owner_for_global_definitions.sql widened only the
-- SELECT one of those to admit NULL-owned system rows. None of these ever
-- dropped 100's or 210's original ungated policies — permissive policies OR
-- together, so is_user_authorized() has been non-functional on all three
-- tables this whole time (same erosion class already fixed once for
-- rfq_tracking, migration 552). This migration drops every one of those
-- policy names explicitly (all confirmed by reading each migration file
-- directly, not guessed) and replaces them with one clean set.
--
-- Ownership model: the ~58 existing system calculators (user_id IS NULL,
-- migration 470) are UNTOUCHED — organization_id stays NULL, they remain
-- globally readable and unwritable via the authenticated path (only a
-- service-role connection can create/edit them), exactly as migration 470
-- designed. Every user-owned calculator (user_id IS NOT NULL) moves from
-- per-individual-user to per-organization sharing, so a teammate can see and
-- reuse a colleague's custom calculator — the same motivation as every other
-- table in this initiative. is_public (a calculator's own author choosing to
-- share it platform-wide, orthogonal to org membership — migration 020) is
-- preserved verbatim as a third SELECT branch, not removed.
--
-- calculator_fields/calculator_formulas have no ownership column of their
-- own — access is derived entirely via calculator_id -> calculators, same
-- EXISTS-subquery shape 020/470 already used, just swapping the ownership
-- condition. Their two backing RPCs (replace_calculator_fields /
-- replace_calculator_formulas, src/database/migrations/011_calculator_
-- atomic_operations.sql) are plain LANGUAGE plpgsql functions with no
-- SECURITY DEFINER — confirmed by reading their definition directly before
-- writing this migration — so they run with the CALLING user's RLS applied,
-- same as any other query; no bypass risk, no function rewrite needed.
--
-- calculator_executions (migration 100) is untouched — confirmed by audit to
-- have zero live read/write path anywhere in backend/src; out of scope.
-- ============================================================================

-- ── Schema: add organization_id to calculators only ─────────────────────────

ALTER TABLE calculators ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_calculators_organization_id ON calculators(organization_id);

-- ── Backfill (generic — no hardcoded UUIDs) ─────────────────────────────────
-- Only user-owned rows; the ~58 system rows (user_id IS NULL) are
-- deliberately left with organization_id IS NULL.

UPDATE calculators c
SET organization_id = om.organization_id
FROM organization_members om
WHERE c.user_id = om.user_id
  AND om.status = 'active'
  AND c.user_id IS NOT NULL
  AND c.organization_id IS NULL;

-- ── RLS: calculators ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view their own calculators" ON calculators;
DROP POLICY IF EXISTS "Users can create their own calculators" ON calculators;
DROP POLICY IF EXISTS "Users can update their own calculators" ON calculators;
DROP POLICY IF EXISTS "Users can delete their own calculators" ON calculators;
DROP POLICY IF EXISTS calculators_tenant_isolation ON calculators;
DROP POLICY IF EXISTS "Authorized users can view their own calculators and public templates" ON calculators;
DROP POLICY IF EXISTS "Authorized users can insert their own calculators" ON calculators;
DROP POLICY IF EXISTS "Authorized users can update their own calculators" ON calculators;
DROP POLICY IF EXISTS "Authorized users can delete their own calculators" ON calculators;

CREATE POLICY "org_select_calculators" ON calculators FOR SELECT
    USING (
        is_user_authorized() AND (
            user_id IS NULL
            OR is_public = true
            OR organization_id IN (SELECT current_user_org_ids())
        )
    );

CREATE POLICY "org_insert_calculators" ON calculators FOR INSERT
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_update_calculators" ON calculators FOR UPDATE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_delete_calculators" ON calculators FOR DELETE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

-- ── RLS: calculator_fields ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view fields of their calculators" ON calculator_fields;
DROP POLICY IF EXISTS "Users can create fields in their calculators" ON calculator_fields;
DROP POLICY IF EXISTS "Users can update fields of their calculators" ON calculator_fields;
DROP POLICY IF EXISTS "Users can delete fields of their calculators" ON calculator_fields;
DROP POLICY IF EXISTS "Authorized users can view fields of their calculators or public calculators" ON calculator_fields;
DROP POLICY IF EXISTS "Authorized users can manage fields of their own calculators" ON calculator_fields;

CREATE POLICY "org_select_calculator_fields" ON calculator_fields FOR SELECT
    USING (
        is_user_authorized() AND EXISTS (
            SELECT 1 FROM calculators
            WHERE calculators.id = calculator_fields.calculator_id
            AND (
                calculators.user_id IS NULL
                OR calculators.is_public = true
                OR calculators.organization_id IN (SELECT current_user_org_ids())
            )
        )
    );

CREATE POLICY "org_manage_calculator_fields" ON calculator_fields FOR ALL
    USING (
        is_user_authorized() AND EXISTS (
            SELECT 1 FROM calculators
            WHERE calculators.id = calculator_fields.calculator_id
            AND calculators.organization_id IN (SELECT current_user_org_ids())
        )
    )
    WITH CHECK (
        is_user_authorized() AND EXISTS (
            SELECT 1 FROM calculators
            WHERE calculators.id = calculator_fields.calculator_id
            AND calculators.organization_id IN (SELECT current_user_org_ids())
        )
    );

-- ── RLS: calculator_formulas ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view formulas of their calculators" ON calculator_formulas;
DROP POLICY IF EXISTS "Users can create formulas in their calculators" ON calculator_formulas;
DROP POLICY IF EXISTS "Users can update formulas of their calculators" ON calculator_formulas;
DROP POLICY IF EXISTS "Users can delete formulas of their calculators" ON calculator_formulas;
DROP POLICY IF EXISTS "Authorized users can view formulas of their calculators or public calculators" ON calculator_formulas;
DROP POLICY IF EXISTS "Authorized users can manage formulas of their own calculators" ON calculator_formulas;

CREATE POLICY "org_select_calculator_formulas" ON calculator_formulas FOR SELECT
    USING (
        is_user_authorized() AND EXISTS (
            SELECT 1 FROM calculators
            WHERE calculators.id = calculator_formulas.calculator_id
            AND (
                calculators.user_id IS NULL
                OR calculators.is_public = true
                OR calculators.organization_id IN (SELECT current_user_org_ids())
            )
        )
    );

CREATE POLICY "org_manage_calculator_formulas" ON calculator_formulas FOR ALL
    USING (
        is_user_authorized() AND EXISTS (
            SELECT 1 FROM calculators
            WHERE calculators.id = calculator_formulas.calculator_id
            AND calculators.organization_id IN (SELECT current_user_org_ids())
        )
    )
    WITH CHECK (
        is_user_authorized() AND EXISTS (
            SELECT 1 FROM calculators
            WHERE calculators.id = calculator_formulas.calculator_id
            AND calculators.organization_id IN (SELECT current_user_org_ids())
        )
    );

NOTIFY pgrst, 'reload schema';
