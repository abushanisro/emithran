-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 438: Fix calc_category so Sheet Metal calculators actually appear
-- under the "Sheet Metal" filter tab (2026-08-08)
--
-- Root cause: the Calculators page (app/(dashboard)/calculators/page.tsx)
-- has a "Sheet Metal" filter tab that queries calculators WHERE
-- calc_category = 'sheet_metal'. Every sheet-metal calculator ever built in
-- this app — going all the way back to the very first ones (migrations
-- 007-019) through every one built this session (049-054) — was created
-- with calc_category = 'process' instead, a copy-pasted literal that was
-- never actually 'sheet_metal'. Confirmed live: clicking the "Sheet Metal"
-- tab shows "0 calculators" despite 15+ real, working, registered sheet-
-- metal calculators existing (they're all just invisible under that tab —
-- they still work fine via process_calculator_mappings/resolvePhysicsQuantity,
-- this is a management-UI visibility bug, not a costing bug).
--
-- Matches by name prefix ('Sheet Metal%', case-insensitive) rather than by
-- migration file origin, since that's the real, current signal for "is this
-- a sheet-metal calculator" — every sheet-metal calculator in this codebase
-- is consistently named "Sheet Metal - <Process>" or "Sheet Metal <Process>".
-- Does not touch calc_category for any other domain (machining, injection
-- molding, post processing, etc.) — those have no calc_category bug reported
-- and are out of scope here.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE calculators
SET calc_category = 'sheet_metal'
WHERE name ILIKE 'Sheet Metal%'
  AND calc_category IS DISTINCT FROM 'sheet_metal';

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT name, calc_category FROM calculators WHERE name ILIKE 'Sheet Metal%' ORDER BY name;
-- Expect every row's calc_category = 'sheet_metal'.
-- SELECT count(*) FROM calculators WHERE calc_category = 'sheet_metal';
-- Expect 15+ (matches the "Sheet Metal" tab's count on the Calculators page after this runs).
