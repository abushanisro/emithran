-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 470: Allow globally-owned (NULL user_id) calculator definitions
--
-- Every existing calculator-seed migration (calculators/001-056) hardcodes the
-- same one real developer/tester's auth.users row as user_id -- not a system
-- identity (no such concept exists anywhere in this codebase), and not
-- portable: calculators.user_id is NOT NULL with a hard FK to auth.users(id),
-- so a fresh install with zero users would fail that INSERT outright, and a
-- multi-tenant install would own "global" calculators by one arbitrary
-- account. This must never be repeated for the new Sheet Metal - Net/Gross
-- Material Usage calculators (see calculators/057, calculators/058).
--
-- Fix, matching the precedent already established in this exact schema for
-- the identical problem on raw_materials (349_raw_materials_global_shared_
-- library.sql): make user_id nullable so a NULL-owned "global" calculator
-- row can exist at all (a NULL FK value is always valid regardless of the
-- referenced table's contents, and migrations run via the service-role/
-- superuser connection, which bypasses RLS entirely -- so this INSERT works
-- immediately after this ALTER, independent of the policy changes below).
--
-- Read-open, write-restricted -- deliberately TIGHTER than raw_materials'
-- fully-open model, with no new "admin role" concept invented:
--   - SELECT policies widened to add `OR user_id IS NULL`, so any
--     authenticated+authorized user can read a global calculator and its
--     fields/formulas.
--   - INSERT/UPDATE/DELETE policies are left COMPLETELY UNTOUCHED. Every one
--     of them requires `auth.uid() = user_id` literally (migrations 020 and
--     210), and `auth.uid() = NULL` is never true for any real session -- so
--     a NULL-owned row is already permanently unwritable through the
--     authenticated-user RLS path, for every command, with zero new
--     policies. Global calculators can only ever be created/edited/deleted
--     via the service-role connection (this migration's own future seeds,
--     or a deliberate backend admin endpoint using the service-role client)
--     -- never through the normal authenticated API path.
--
-- The 58 existing calculators' user_id values are left untouched -- out of
-- scope, not broken for their current owner.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE calculators ALTER COLUMN user_id DROP NOT NULL;

DROP POLICY IF EXISTS "Authorized users can view their own calculators and public templates" ON calculators;
CREATE POLICY "Authorized users can view their own calculators and public templates"
    ON calculators FOR SELECT
    USING ((auth.uid() = user_id OR is_public = true OR user_id IS NULL) AND is_user_authorized());

DROP POLICY IF EXISTS "Authorized users can view fields of their calculators or public calculators" ON calculator_fields;
CREATE POLICY "Authorized users can view fields of their calculators or public calculators"
    ON calculator_fields FOR SELECT
    USING (
        EXISTS (SELECT 1 FROM calculators
                WHERE calculators.id = calculator_fields.calculator_id
                AND (calculators.user_id = auth.uid() OR calculators.is_public = true OR calculators.user_id IS NULL))
        AND is_user_authorized()
    );

DROP POLICY IF EXISTS "Authorized users can view formulas of their calculators or public calculators" ON calculator_formulas;
CREATE POLICY "Authorized users can view formulas of their calculators or public calculators"
    ON calculator_formulas FOR SELECT
    USING (
        EXISTS (SELECT 1 FROM calculators
                WHERE calculators.id = calculator_formulas.calculator_id
                AND (calculators.user_id = auth.uid() OR calculators.is_public = true OR calculators.user_id IS NULL))
        AND is_user_authorized()
    );

-- ── Verification ──────────────────────────────────────────────────────────────
-- SELECT column_name, is_nullable FROM information_schema.columns
--   WHERE table_name = 'calculators' AND column_name = 'user_id';
-- Expect is_nullable = 'YES'.
