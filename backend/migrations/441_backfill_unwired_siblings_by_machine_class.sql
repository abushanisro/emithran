-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 441: Backfill calculator_id for Sheet Metal rows whose machine
-- class already has a real, wired calculator on a sibling row (2026-08-08)
--
-- Confirmed via a live query (not just migration-file inference) against
-- process_calculator_mappings:
--   Bending/Floating /Forming / Hemming   — machine_class='press_brake', calculator_id=NULL
--   Bending/Floating /Forming / Flanging  — machine_class='press_brake', calculator_id=NULL
--   Finishing / Deburr                    — machine_class='deburring',  calculator_id='cc4291f1-...' (already wired)
--   Finishing / Edge Finish               — machine_class='deburring',  calculator_id=NULL
--
-- Hemming and Flanging are real press-brake-family forming operations (tight-
-- radius edge folds/flanges, done on the same press brake as Bend Brake/
-- Stage Tool Bending, which already resolve to "Sheet Metal - Bending
-- Manufacturing") — there is no dedicated Hemming/Flanging calculator, but
-- leaving them permanently unwired when a real, already-correct calculator
-- for their exact machine_class exists on a sibling row is a worse, more
-- silent gap than linking them to it. Same reasoning for Edge Finish against
-- Deburr's already-wired "cc4291f1" deburring calculator (physics_key=
-- 'deburring', migration 056) — same machine_class, same real formula
-- applies (per-metre/per-pierce manual deburr rate), just a different
-- display label on the process catalog.
--
-- Generalized by machine_class rather than hardcoded to these four rows, so
-- any OTHER Sheet Metal row with the same "sibling already wired, this one
-- isn't" shape gets fixed too — self-correcting for the whole bug class,
-- same philosophy as migration 440's case-insensitive backfill (which this
-- doesn't overlap with: 440 matches by same-spelling-different-case
-- operation name; this matches by same machine_class regardless of
-- operation name or spelling).
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE process_calculator_mappings orphan
SET calculator_id = sibling.calculator_id,
    calculator_name = sibling.calculator_name
FROM process_calculator_mappings sibling
WHERE orphan.process_group = 'Sheet Metal'
  AND sibling.process_group = orphan.process_group
  AND sibling.machine_class = orphan.machine_class
  AND sibling.calculator_id IS NOT NULL
  AND orphan.calculator_id IS NULL
  AND orphan.machine_class IS NOT NULL
  AND orphan.is_active = true;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT process_route, operation, machine_class, calculator_id
-- FROM process_calculator_mappings
-- WHERE process_group = 'Sheet Metal'
--   AND ((process_route = 'Bending/Floating /Forming' AND operation IN ('Hemming','Flanging'))
--     OR (process_route = 'Finishing' AND operation IN ('Deburr','Edge Finish')))
-- ORDER BY process_route, operation;
-- Expect all 4 rows to now show the same calculator_id as their wired sibling
-- (press_brake's "Sheet Metal - Bending Manufacturing" for Hemming/Flanging;
-- 'cc4291f1-15fc-4038-88bc-c74c3480f168' for Edge Finish, matching Deburr).
