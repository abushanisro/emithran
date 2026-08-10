-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 440: Backfill case-duplicate Sheet Metal mapping rows
-- (2026-08-08)
--
-- Root cause found while auditing Sheet Metal's Bending/Floating /Forming
-- route: migration 344 re-inserted three operations with DIFFERENT
-- capitalization than the canonical rows migration 024 had already seeded —
-- 'Laser Punch' (canonical: 'Laser Puch', a typo migrations 368/369 target
-- literally), 'Progressive Die' (canonical: 'Progressive die', lowercase
-- 'd'), 'Stretch Forming' (canonical: 'Stretch forming', lowercase 'f').
-- Because process_calculator_mappings matching is case-sensitive, every
-- later migration that assigns machine_class/calculator_id by matching the
-- canonical spelling silently skipped these differently-cased duplicates —
-- they may still be sitting active in the live catalog with machine_class
-- and calculator_id both NULL, right alongside a fully-wired sibling row
-- for the "same" real operation.
--
-- This backfills any Sheet Metal row whose machine_class/calculator_id is
-- still NULL by copying both from a sibling row in the SAME process_route
-- whose operation matches case-INsensitively — self-correcting for exactly
-- this bug class, not hardcoded to the three names found in the migration
-- history (in case the live catalog has other, similarly-cased duplicates
-- from a source I didn't grep). A row with no case-insensitive match at all
-- is left untouched, not guessed at — that's a genuinely different gap
-- (see migration 441 and the accompanying report for Roll Forming/Stretch
-- Forming's REAL absence of any calculator, which this migration cannot
-- fix — there is no wired sibling to copy from for those).
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE process_calculator_mappings orphan
SET machine_class = sibling.machine_class,
    calculator_id = sibling.calculator_id,
    calculator_name = sibling.calculator_name
FROM process_calculator_mappings sibling
WHERE orphan.process_group = 'Sheet Metal'
  AND sibling.process_group = orphan.process_group
  AND sibling.process_route = orphan.process_route
  AND lower(sibling.operation) = lower(orphan.operation)
  AND sibling.operation <> orphan.operation
  AND orphan.machine_class IS NULL
  AND sibling.machine_class IS NOT NULL;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT process_route, operation, machine_class, calculator_id, is_active
-- FROM process_calculator_mappings
-- WHERE process_group = 'Sheet Metal' AND process_route = 'Bending/Floating /Forming'
-- ORDER BY operation;
-- Any two rows differing only by case should now show identical
-- machine_class/calculator_id. Rows still NULL after this are a real
-- calculator gap, not a case-matching bug — do not backfill those by hand.
