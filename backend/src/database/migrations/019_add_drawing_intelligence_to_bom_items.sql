-- Drawing intelligence: persist drawing-extracted data to bom_items
-- Fields promoted to first-class columns are used by process plan generator for route selection.
-- All other structured data (threads, GD&T, tolerances, revision, notes) lives in drawing_intelligence JSONB.
ALTER TABLE bom_items
  ADD COLUMN IF NOT EXISTS surface_finish_ra          NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS surface_finish_confidence  NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS heat_treatment             TEXT,
  ADD COLUMN IF NOT EXISTS coating                    TEXT,
  ADD COLUMN IF NOT EXISTS coating_confidence         NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS complexity                 TEXT CHECK (complexity IN ('simple', 'medium', 'complex')),
  ADD COLUMN IF NOT EXISTS tightest_tolerance_mm      NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS tolerance_confidence       NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS drawing_intelligence       JSONB;
