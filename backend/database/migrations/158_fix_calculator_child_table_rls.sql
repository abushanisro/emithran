-- Migration 158: Fix RLS on calculator child tables + re-apply process_calculator_mappings fix
--
-- Root cause of calculators showing 0 for new users:
--
--   Migration 020 created SELECT policies on calculator_fields and
--   calculator_formulas that allow access only when the parent calculator is
--   owned by the current user OR is_public = true.
--
--   Migration 156 updated the calculators SELECT policy to also allow
--   is_global = TRUE, but did NOT touch the child table policies. So even
--   though a new user can now "see" global calculators, the JOIN to
--   calculator_fields and calculator_formulas is blocked — returning no rows.
--
-- Fix: update child table SELECT policies to pass through when the parent
--      calculator is global (is_global = TRUE).
--
-- Also re-applies the process_calculator_mappings permissive SELECT policy
-- (idempotent, safe to run again).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── calculator_fields ────────────────────────────────────────────────────────

-- Drop all existing SELECT policies
DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE tablename = 'calculator_fields' AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   rec.policyname, rec.schemaname, rec.tablename);
  END LOOP;
END $$;

CREATE POLICY "calc_fields_select" ON calculator_fields
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM calculators
      WHERE calculators.id = calculator_fields.calculator_id
        AND (
          calculators.user_id = auth.uid()
          OR calculators.is_global = TRUE
          OR calculators.is_public = TRUE
        )
    )
  );

-- ── calculator_formulas ──────────────────────────────────────────────────────

DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE tablename = 'calculator_formulas' AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   rec.policyname, rec.schemaname, rec.tablename);
  END LOOP;
END $$;

CREATE POLICY "calc_formulas_select" ON calculator_formulas
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM calculators
      WHERE calculators.id = calculator_formulas.calculator_id
        AND (
          calculators.user_id = auth.uid()
          OR calculators.is_global = TRUE
          OR calculators.is_public = TRUE
        )
    )
  );

-- ── process_calculator_mappings (re-apply, idempotent) ───────────────────────

ALTER TABLE process_calculator_mappings ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE tablename = 'process_calculator_mappings'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   rec.policyname, rec.schemaname, rec.tablename);
  END LOOP;
END $$;

CREATE POLICY "global_lookup_select" ON process_calculator_mappings
  FOR SELECT USING (true);

-- ── Verify ───────────────────────────────────────────────────────────────────
DO $$
DECLARE
  calc_count   INTEGER;
  field_count  INTEGER;
  formula_count INTEGER;
  mapping_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO calc_count    FROM calculators WHERE is_global = TRUE;
  SELECT COUNT(*) INTO field_count   FROM calculator_fields;
  SELECT COUNT(*) INTO formula_count FROM calculator_formulas;
  SELECT COUNT(*) INTO mapping_count FROM process_calculator_mappings;

  RAISE NOTICE 'Global calculators: %', calc_count;
  RAISE NOTICE 'Calculator fields total: %', field_count;
  RAISE NOTICE 'Calculator formulas total: %', formula_count;
  RAISE NOTICE 'Process calculator mappings: %', mapping_count;
END $$;
