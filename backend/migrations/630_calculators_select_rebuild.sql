-- ============================================================================
-- Migration 630: Dynamically rebuild ALL RLS policies on `calculators`
--
-- Live diagnosis (2026-09-02): a real impersonated session for a user with
-- ZERO organization memberships saw only 51 of 65 calculators — 14 rows,
-- all independently confirmed via service-role query to have
-- organization_id IS NULL (exactly the condition migration 627's SELECT
-- policy's first OR-branch checks), were silently excluded. This is not
-- explainable by the policy text in migrations 622/627: a plain
-- `A OR B OR C` USING clause cannot selectively exclude a row that
-- satisfies branch A, regardless of query plan — Postgres guarantees
-- identical results across all valid plans for the same logical condition.
--
-- Confirmed NOT a stale-replica/cache artifact: re-run 3x, deterministic;
-- confirmed row-independent (same row IS visible to a DIFFERENT real user
-- who has an active org membership); confirmed not a pagination/count
-- display issue (count itself was 51, with an explicit high .range() too).
--
-- The only remaining explanation is a policy on `calculators` that isn't
-- what migrations 622/627 believe is live — the same class of undocumented
-- drift this initiative already found once on `vendors` (no migration in
-- history ever set it fully-open, yet the code behaved as if it were).
-- There is no `pg_policies`/management-API access available to this session
-- to directly confirm what's live, so this migration does not depend on
-- knowing — it dynamically drops EVERY existing policy on `calculators` by
-- querying pg_policies directly (not by guessing names) before rebuilding,
-- exactly the defensive technique originally scoped for this initiative's
-- `vendors` conversion for the same kind of drift risk.
-- ============================================================================

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'calculators'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.calculators', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "org_select_calculators" ON calculators FOR SELECT
    USING (
        is_user_authorized() AND (
            organization_id IS NULL
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

-- ── Also rebuild calculator_fields / calculator_formulas the same way, ─────
-- ── defensively, since they were touched by the same 622 migration ─────────

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'calculator_fields'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.calculator_fields', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "org_select_calculator_fields" ON calculator_fields FOR SELECT
    USING (
        is_user_authorized() AND EXISTS (
            SELECT 1 FROM calculators
            WHERE calculators.id = calculator_fields.calculator_id
            AND (
                calculators.organization_id IS NULL
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

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'calculator_formulas'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.calculator_formulas', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "org_select_calculator_formulas" ON calculator_formulas FOR SELECT
    USING (
        is_user_authorized() AND EXISTS (
            SELECT 1 FROM calculators
            WHERE calculators.id = calculator_formulas.calculator_id
            AND (
                calculators.organization_id IS NULL
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
