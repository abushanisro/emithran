-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 428: Calculator versioning (2026-08-07)
--
-- Part of the "Manufacturing Physics Calculator" architecture (Workstream 1f).
-- A calculator's formula/fields are not silently mutable — changing what
-- "Cycle Time" or "Theoretical Force" means for a process is a new version,
-- not an in-place edit, so a historical quote stays traceable to the exact
-- formula that produced it even after the calculator evolves.
--
-- This is the minimum viable mechanism: a version counter on `calculators`
-- (bumped whenever its fields/formulas change) plus a `calculator_version`
-- column on `process_cost_records` recording which version actually computed
-- each persisted line. A full `calculator_versions` history table (storing
-- prior field/formula snapshots) is a reasonable follow-on, not required to
-- satisfy the traceability requirement — deferred, not built here.
-- ════════════════════════════════════════════════════════════════════════════════

ALTER TABLE calculators
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN calculators.version IS
  'Bumped whenever this calculator''s fields/formulas change. Never edit a field''s formula in place without incrementing this — a historical quote must stay traceable to the exact version that computed it.';

ALTER TABLE process_cost_records
  ADD COLUMN IF NOT EXISTS calculator_id UUID REFERENCES calculators(id),
  ADD COLUMN IF NOT EXISTS calculator_version INTEGER;

COMMENT ON COLUMN process_cost_records.calculator_id IS
  'The real, registry-resolved calculator (process_calculator_mappings.calculator_id) that computed this line''s cycle time, when it went through the Manufacturing Physics Calculator pipeline. NULL for lines computed before this architecture, or for processes not yet migrated onto it.';
COMMENT ON COLUMN process_cost_records.calculator_version IS
  'The calculators.version value at the moment this line was computed — lets a historical quote stay traceable even after the calculator''s formula later changes.';

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT id, name, version FROM calculators ORDER BY name;
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'process_cost_records' AND column_name LIKE 'calculator%';
