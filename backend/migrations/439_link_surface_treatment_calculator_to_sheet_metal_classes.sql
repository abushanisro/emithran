-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 439: Link the real Surface Treatment calculator to the Sheet
-- Metal catalog's own powder_coat/anodize/chem_treatment rows (2026-08-08)
--
-- Root cause found while auditing Sheet Metal's Surface Treatment route
-- (Powder Coat / Paint / Anodize): migration 433 built a real, working
-- "Post Processing - Surface Treatment" calculator and linked it to a NEW,
-- generic process_calculator_mappings row (machine_class='surface_treatment')
-- — deliberately, per that migration's own comment, without touching the
-- PRE-EXISTING Sheet Metal rows (machine_class IN 'powder_coat','anodize',
-- 'chem_treatment', set by migration 369). Those three rows still have
-- calculator_id = NULL, even though the SAME formula (area × rate vs.
-- amortized min-lot) applies to them — Surface Treatment lines are always
-- costed via the generic 'surface_treatment' machine class at runtime
-- (cost-surface-treatment.ts hardcodes it), so this was never a COSTING gap
-- — but it left these three catalog rows looking permanently unwired to
-- anyone browsing the Process page or opening them via the interactive
-- calculator dialog directly, a real UI-visible inconsistency between what
-- the database's own routing catalog shows and what the app's cost engine
-- actually resolves.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE process_calculator_mappings
SET calculator_id = (SELECT id FROM calculators WHERE name = 'Post Processing - Surface Treatment' LIMIT 1)
WHERE process_group = 'Sheet Metal'
  AND process_route = 'Surface Treatment'
  AND machine_class IN ('powder_coat', 'anodize', 'chem_treatment')
  AND calculator_id IS NULL;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT process_route, operation, machine_class, calculator_id
-- FROM process_calculator_mappings
-- WHERE process_group = 'Sheet Metal' AND process_route = 'Surface Treatment';
-- Expect calculator_id populated (matching 'Post Processing - Surface
-- Treatment') for Powder Coat, Paint, Anodize.
