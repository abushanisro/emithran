-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 410: Hole Extrusion (Burring) — real max_tonnage capability (2026-08-05)
--
-- The "Why:" line for this machine class was falling back to generic
-- boilerplate ("No dimensional constraints for this process ... conservative
-- class defaults applied") because migration 409's real mhr_records rows had
-- no capability columns populated at all — hydrateCapability() in selector.ts
-- only produces a specific tonnage-based reason when a real max_tonnage value
-- is on file (see the new 'hole_forming' case added to isCapable/fitScore/
-- buildReasons in this same change).
--
-- Populating the REAL tonnage already cited in migration 409's research, not a
-- new number:
--   USA:     Whitney Jensen — explicitly "10 Ton Punch Press"
--   China:   FTC105-10T — the "10T" in the model number
--   Germany/France/W. Europe/E. Europe: Fresan FP10P — "10 tons (100kN)"
--   Mexico:  search was specifically for 10-ton industrial presses
--
-- India is deliberately left NULL: the real citation (dedicated flanging-
-- machine market survey) did not include a confirmed tonnage spec for the
-- specific machines in that price range — leaving it unset (falls through to
-- the conservative 5t class default, migration in seed-registry.ts) is more
-- honest than asserting a tonnage figure with no real source.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE mhr_records
SET max_tonnage = 10
WHERE commodity_code = 'SM-BURR-FORM'
  AND location IN ('USA', 'China', 'Germany', 'France', 'W. Europe', 'E. Europe', 'Mexico');

-- ── Verification ───────────────────────────────────────────────────────────────
-- SELECT location, machine_name, max_tonnage FROM mhr_records
--   WHERE commodity_code = 'SM-BURR-FORM' ORDER BY location;
-- Expect max_tonnage=10 for all except India (NULL).
