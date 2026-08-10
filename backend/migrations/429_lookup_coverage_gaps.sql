-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 429: lookup_coverage_gaps — structured, accumulating gap backlog
-- (2026-08-07)
--
-- Part of the "Manufacturing Physics Calculator" architecture (Workstream 1c).
-- Two distinct gap types, per the architecture's own rule that they have
-- different owners/triage:
--   missing_lookup       — the process/calculator is correctly designed for
--                           this case; a specific data row for these exact
--                           inputs just hasn't been seeded yet (a real,
--                           EXACT_MATCH/RANGE miss, or an INTERPOLATE request
--                           outside the seeded range). Actionable: "add this
--                           row with real, sourced data."
--   unsupported_operation — the calculator/process fundamentally doesn't
--                           model this case at all yet (no calculator
--                           registered for this machine_class, or inputs
--                           fall outside any formula's valid range).
--                           Actionable: "needs new calculator capability."
--
-- Without this table, a gap is a one-off runtime message the engineer sees
-- once and forgets — this turns it into an accumulating, queryable backlog:
-- how many times has this exact gap actually been hit in practice (weighting
-- which gaps matter most), not just a theoretical coverage percentage.
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lookup_coverage_gaps (
  id                  BIGSERIAL PRIMARY KEY,
  gap_type            TEXT NOT NULL CHECK (gap_type IN ('missing_lookup', 'unsupported_operation')),
  table_name          TEXT,                    -- the sm_lookup_* table involved; NULL for unsupported_operation with no specific table
  process              TEXT NOT NULL,           -- e.g. 'Press Brake'
  machine_class        TEXT NOT NULL,
  missing_inputs       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- e.g. {"thickness_mm": 1.5, "tonnage": 2.76, "complexity": "simple"}
  suggested_sources    TEXT[],                  -- e.g. ['Amada Process Handbook', 'Salvagnini Bending Manual']
  reason               TEXT,                    -- populated for unsupported_operation
  required_capability  TEXT,                    -- populated for unsupported_operation
  priority             TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'wontfix')),
  occurrence_count     INTEGER NOT NULL DEFAULT 1,
  first_seen           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Dedupe key: same gap_type + table + process + machine_class + exact
  -- missing_inputs should accumulate occurrence_count, not create a new row
  -- each time. jsonb has no natural btree equality for a UNIQUE constraint,
  -- so cast to text for the dedupe index.
  dedupe_key           TEXT GENERATED ALWAYS AS (
    gap_type || '::' || coalesce(table_name, '') || '::' || process || '::' || machine_class || '::' || missing_inputs::text
  ) STORED
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lookup_coverage_gaps_dedupe ON lookup_coverage_gaps (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_lookup_coverage_gaps_status ON lookup_coverage_gaps (status);
CREATE INDEX IF NOT EXISTS idx_lookup_coverage_gaps_table ON lookup_coverage_gaps (table_name);

ALTER TABLE lookup_coverage_gaps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lookup_coverage_gaps_read ON lookup_coverage_gaps;
CREATE POLICY lookup_coverage_gaps_read ON lookup_coverage_gaps FOR SELECT USING (true);
-- Insert/update happens via the backend's service-role client (upsert-on-gap),
-- not directly by end users — no public write policy needed.

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT gap_type, table_name, process, machine_class, missing_inputs, occurrence_count, status
--   FROM lookup_coverage_gaps ORDER BY occurrence_count DESC;
