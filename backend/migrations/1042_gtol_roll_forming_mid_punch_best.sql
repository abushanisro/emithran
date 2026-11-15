-- ============================================================================
-- Migration 1042: Sheet Metal Roll Forming Mid Punch holds 0.762 mm, not 0.782
-- ============================================================================
-- tblGtolProcessCapabilities (staged by migration 747 from memory/Machining) gives the Best Achievable of
-- "Sheet Metal Roll Forming Mid Punch" as 0.782 mm for diamTolerance and tolerance. Every other copy of the table
-- in the reference data (Die Casting, Sand casting, Additive Manufacturing) gives 0.762 mm, and 0.762 mm is the
-- value the row's own series is built on: it is 0.030 in, as its Worst Achievable 1.524 mm is 0.060 in and the
-- Post Punch row runs 0.254 to 0.762 mm. 0.782 is a transcription slip in the Machining copy.
--
-- The other six places where the copies differ were checked the same way and the staged value is the one the
-- majority carries, so nothing else changes. No engine reads this process's rows today: no cost moves.
--
-- Idempotent: only an element still carrying 0.782 is rewritten.
-- ============================================================================

UPDATE machining_reference_data m
SET raw = (
  SELECT jsonb_agg(
    CASE
      WHEN e->>'Process' = 'Sheet Metal Roll Forming Mid Punch'
       AND e->>'GtolCategory' IN ('diamTolerance', 'tolerance')
       AND (e->>'Best Achievable')::numeric = 0.782
      THEN jsonb_set(e, '{Best Achievable}', '0.762'::jsonb)
      ELSE e
    END ORDER BY ord)
  FROM jsonb_array_elements(m.raw) WITH ORDINALITY AS t(e, ord)
)
WHERE m.category = 'lookup_table' AND m.key = 'tblGtolProcessCapabilities' AND jsonb_typeof(m.raw) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(m.raw) e
    WHERE e->>'Process' = 'Sheet Metal Roll Forming Mid Punch' AND e->>'GtolCategory' IN ('diamTolerance', 'tolerance')
      AND (e->>'Best Achievable')::numeric = 0.782
  );
