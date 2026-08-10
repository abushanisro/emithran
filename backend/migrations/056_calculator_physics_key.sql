-- ============================================================================
-- Migration 056: physics_key column — physics-backed calculator execution
-- (2026-08-02)
--
-- Adds the mechanism for calculators.service.ts's execute() to dispatch to a
-- real TypeScript physics function (backend/src/modules/calculators/
-- physics-registry.ts) instead of evaluating a DB-stored formula string, for
-- calculators where a real, already-verified formula exists elsewhere in the
-- codebase (cost-engine.ts / default-rates.ts). Eliminates the possibility
-- of the interactive calculator's numbers drifting from the live cost
-- engine's numbers for these two processes, since both now call the exact
-- same function.
--
-- calculator_fields.default_value formula strings are left untouched — they
-- still serve as the human-readable "Why: {formula}" caption in the UI, just
-- no longer drive the actual computed value for physics-backed calculators.
-- ============================================================================

ALTER TABLE calculators ADD COLUMN IF NOT EXISTS physics_key TEXT NULL;

UPDATE calculators SET physics_key = 'tapping' WHERE id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf';
UPDATE calculators SET physics_key = 'deburring' WHERE id = 'cc4291f1-15fc-4038-88bc-c74c3480f168';

-- Verification:
-- SELECT id, name, physics_key FROM calculators WHERE physics_key IS NOT NULL;
