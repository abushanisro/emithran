-- Migration 343: Enhance process_cost_records for Auto Plan + Manual Override architecture
-- ════════════════════════════════════════════════════════════════════════════════
-- Adds three columns that support the aPriori-style "Auto is default; Override is explicit" UX:
--
--   location      — factory location when the route was applied (India, USA, China, etc.)
--                   Needed because the dialog re-opens and must know which Digital Factory to
--                   filter MHR/LHR by. Previously undefined → dialog showed wrong rate set.
--
--   is_override   — FALSE for every AI/engine-generated row; set to TRUE when an engineer
--                   manually edits a value. Rendered as [Auto] (green) vs [Override] (amber)
--                   chip in the Process Planning table. Diagnostic signal for cost audits.
--
--   timing_source — provenance of the cycle time: 'calculator' | 'feature_geometry' |
--                   'machining_rules' | 'ai_hint' | 'geometry_estimate' | 'default'
--                   Displayed as a small badge next to the cycle time field so engineers
--                   know whether the time came from a calibrated calculator or a fallback.
--
-- Safe to re-run — uses ADD COLUMN IF NOT EXISTS.
-- ════════════════════════════════════════════════════════════════════════════════

ALTER TABLE process_cost_records
  ADD COLUMN IF NOT EXISTS location       TEXT,
  ADD COLUMN IF NOT EXISTS is_override    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS timing_source  TEXT;

-- No backfill: location is not stored on bom_items (it lives on the project).
-- Existing rows will have NULL location, which is correct — they pre-date this tracking.
-- New rows receive location from the generation brief at apply-route time.
