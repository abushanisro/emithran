-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 373: Repair process_cost_records where operation was set to the same
-- generic label as process_route (e.g. "Route: Laser Cutting, Operation: Laser
-- Cutting"), so it never matches a real process_calculator_mappings row.
--
-- Root cause: cost-engine.ts (the AI/route-comparison cost engine) previously
-- emitted only a single cosmetic display label per process line (e.g. "Laser
-- Cutting"), and the frontend (manufacturing-intelligence/page.tsx) duplicated
-- that same label into BOTH processRoute and operation when saving a process
-- cost record. That has now been fixed in code: cost-engine.ts resolves a real
-- operation (e.g. "Fiber Laser Cut") from process_calculator_mappings via
-- BomItemsService.resolveProcessIdentities() and the frontend uses it when
-- present. This migration is the one-time data catch-up for rows saved BEFORE
-- that fix, which are still stuck with operation === process_route.
--
-- Fix: for any row where operation = process_route AND that exact
-- (process_group, process_route, operation) triple has no match in
-- process_calculator_mappings (i.e. it's not a route that legitimately also has
-- an identically-named operation), replace operation with the real operation
-- for that (process_group, process_route) with the lowest display_order — the
-- same "pick one deterministic representative" convention
-- resolveProcessIdentities() uses server-side. Sourced entirely from the DB,
-- no hardcoded operation names.
--
-- Idempotent: re-running is a no-op once operation no longer equals process_route
-- (or once the corrected triple has a real mapping match).
-- ════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  repaired_count INTEGER;
  still_unmatched INTEGER;
BEGIN
  UPDATE process_cost_records pcr
  SET operation = sub.operation
  FROM (
    SELECT DISTINCT ON (process_group, process_route)
      process_group, process_route, operation
    FROM process_calculator_mappings
    WHERE is_active = true
    ORDER BY process_group, process_route, display_order
  ) sub
  WHERE pcr.process_group = sub.process_group
    AND pcr.process_route = sub.process_route
    AND pcr.operation = pcr.process_route
    AND NOT EXISTS (
      SELECT 1 FROM process_calculator_mappings m2
      WHERE m2.process_group = pcr.process_group
        AND m2.process_route = pcr.process_route
        AND m2.operation = pcr.operation
        AND m2.is_active = true
    );

  GET DIAGNOSTICS repaired_count = ROW_COUNT;

  -- Diagnostic (non-fatal): rows that still have operation = process_route after
  -- the repair either belong to a process_group/process_route with NO active
  -- mappings row at all (nothing to repair from), or the route+operation-name
  -- duplication is actually legitimate (e.g. a route whose only operation really
  -- does share its name) — worth a manual look, not worth hard-failing over.
  SELECT COUNT(*) INTO still_unmatched
  FROM process_cost_records
  WHERE is_active = true
    AND operation = process_route
    AND NOT EXISTS (
      SELECT 1 FROM process_calculator_mappings m
      WHERE m.process_group = process_cost_records.process_group
        AND m.process_route = process_cost_records.process_route
        AND m.operation = process_cost_records.operation
        AND m.is_active = true
    );

  RAISE NOTICE
    'Migration 373: repaired % row(s) where operation duplicated process_route. % active row(s) still have operation = process_route with no real mapping match — check process_group/process_route for these manually.',
    repaired_count, still_unmatched;
END $$;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT id, process_group, process_route, operation FROM process_cost_records
-- WHERE is_active = true AND operation = process_route;
-- Expected: 0 rows, or only legitimate same-name route/operation pairs.
