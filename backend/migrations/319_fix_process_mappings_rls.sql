-- Migration 319: Fix RLS on process_calculator_mappings
-- ============================================================================
-- PROBLEM
-- PersistenceService.apply() inserts proposed masters into process_calculator_mappings
-- using the user's JWT. RLS blocks this INSERT because no INSERT policy exists —
-- only SELECT was ever granted (implicitly via the default seeded data).
--
-- PRINCIPAL ENGINEER RATIONALE
-- process_calculator_mappings is a shared/global master table (no owner_id column).
-- It holds both system-seeded rows (from migrations) and user-approved proposed
-- masters from AI plan generation. Both classes are legitimate tenant data.
-- Authenticated users must be able to INSERT new process mappings when they
-- approve proposed masters from a generated plan.
--
-- With migration 318 in place (correct routing template step names), all 4 standard
-- sheet metal ops match existing rows and NO proposed masters are generated for
-- this part. This policy is still required for:
--   - Edge-case parts where the planner proposes genuinely new operations
--   - Future process families (welding, casting, etc.)
--   - Any tenant who adds custom operations via the process library UI
-- ============================================================================

-- Ensure RLS is on (safe no-op if already enabled)
ALTER TABLE process_calculator_mappings ENABLE ROW LEVEL SECURITY;

-- SELECT: all authenticated users can read all active mappings (already works — making explicit)
DROP POLICY IF EXISTS "process_mappings_select" ON process_calculator_mappings;
CREATE POLICY "process_mappings_select"
  ON process_calculator_mappings
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: authenticated users can add new process mappings (proposed master approval)
DROP POLICY IF EXISTS "process_mappings_insert" ON process_calculator_mappings;
CREATE POLICY "process_mappings_insert"
  ON process_calculator_mappings
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- UPDATE: authenticated users can update mappings (e.g. link a calculator to an op)
DROP POLICY IF EXISTS "process_mappings_update" ON process_calculator_mappings;
CREATE POLICY "process_mappings_update"
  ON process_calculator_mappings
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
