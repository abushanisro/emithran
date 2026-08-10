-- ============================================================================
-- Migration 420: bom_items.scenario_overrides — generic, reusable Cost Guide
-- override bag (replaces the need for a one-off "<field>_override" column
-- per scenario input, e.g. migration 316's manufacturing_family_override).
-- ============================================================================
-- Root cause this fixes: the Cost Guide's "Blank Thickness" input had no save
-- path at all (pure client-side useState, confirmed by grep — no mutate()
-- call anywhere referenced it), so any typed override silently reverted to
-- the CAD-extracted value on refresh. Simply wiring it to save into the
-- existing bom_items.sheet_thickness_mm column would have been WORSE than
-- doing nothing: every real costing entry point resolves thickness as
-- `summary.sheetThicknessMm ?? item.sheetThicknessMm ?? 0` (summary =
-- CAD-analysis feature-graph data), so item.sheet_thickness_mm is only ever
-- consulted when CAD analysis is absent — an override written there would be
-- silently ignored by costing on any part that has real CAD analysis, while
-- ALSO destroying the original CAD value the "CAD value" UI note depends on
-- (both currently read/write the same column).
--
-- Design: one JSONB column holding named overrides, e.g.
-- {"sheetThicknessMm": 2}, checked FIRST (ahead of the CAD-extracted value)
-- by a single shared resolver (see costing/scenario-overrides.ts) used
-- identically by getCostSummary/getRouteComparison/getCandidateRoutes — so a
-- future scenario override (material, batch size, blank stock, ...) is one
-- new resolver call, not a new migration + a new column + new plumbing
-- copy-pasted into three cost methods each time.
-- ============================================================================

ALTER TABLE bom_items
ADD COLUMN IF NOT EXISTS scenario_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN bom_items.scenario_overrides IS
  'Generic Cost Guide manual-override bag, keyed by scenario input name (e.g. "sheetThicknessMm"). '
  'A present key wins over the CAD-extracted/auto-detected value for that input in every costing '
  'entry point (see costing/scenario-overrides.ts''s resolveEffective()). Absent/null key = no '
  'override, falls through to the real CAD value, then the bom_items column fallback. Never '
  'overwrites the underlying CAD-extracted columns/feature-graph data — those stay the honest '
  'record of what was actually detected.';

-- Verification:
-- SELECT id, scenario_overrides FROM bom_items WHERE scenario_overrides != '{}'::jsonb LIMIT 5;
-- Should be empty right after this migration (no overrides set yet).
