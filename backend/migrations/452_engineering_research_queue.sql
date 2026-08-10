-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 452: Engineering Research Queue — schema (2026-08-09)
--
-- Phase 1 of the "Engineering Data Autopilot": today, closing a lookup_coverage_gaps
-- row (migration 429) means someone manually researches a source and hand-writes a
-- migration — slow, and every case gets re-litigated from scratch. This introduces a
-- governed pipeline: a gap becomes a research job, real sources become proposals
-- with full provenance/confidence, and a human explicitly approves + separately
-- seeds a proposal before it ever touches a real sm_lookup_* table. Nothing here
-- auto-writes production costing data.
--
-- Two hard rules baked into this schema (not just service-layer convention):
--   1. research_cutoff defaults to 2026-07-31 for this phase — a fixed
--      reproducibility anchor, not a free per-job date (explicit user instruction).
--   2. A proposal whose source data is a genuine RANGE (value_min/value_max) can
--      NEVER be seeded into a point-only sm_lookup_* column — every such table's
--      value column is a plain NUMERIC today (confirmed: sm_lookup_laser_cut,
--      sm_lookup_manual_stroke, etc.), so seeding a range would mean picking a
--      point from it (midpoint/min/max), which is exactly the kind of fabricated
--      precision this whole feature exists to prevent. The
--      'approved_awaiting_range_capable_calculator' status exists so that outcome
--      is visible and tracked, not silently blocked or silently forced through.
--      Enforced in the engineering-research service's seedProposal(), not just
--      documented here — this migration only makes the state representable.
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS engineering_research_jobs (
  id                    BIGSERIAL PRIMARY KEY,
  gap_id                BIGINT REFERENCES lookup_coverage_gaps(id),  -- nullable: ad-hoc jobs allowed
  table_name            TEXT NOT NULL,        -- target sm_lookup_* table this job is researching
  process                TEXT,
  machine_class          TEXT,
  missing_inputs         JSONB NOT NULL DEFAULT '{}',   -- copied from the gap at creation time, e.g. {"thickness_mm":1.5,"tonnage":5}
  required_parameters    JSONB NOT NULL,       -- e.g. ["material","thickness_mm","laser_power_w","assist_gas","cutting_speed_m_per_min"]
  research_cutoff        DATE NOT NULL DEFAULT '2026-07-31',
  status                 TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','researching','completed','closed')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erj_status ON engineering_research_jobs(status);
CREATE INDEX IF NOT EXISTS idx_erj_table_name ON engineering_research_jobs(table_name);
CREATE INDEX IF NOT EXISTS idx_erj_gap_id ON engineering_research_jobs(gap_id);

CREATE TABLE IF NOT EXISTS engineering_research_proposals (
  id                    BIGSERIAL PRIMARY KEY,
  job_id                BIGINT NOT NULL REFERENCES engineering_research_jobs(id) ON DELETE CASCADE,

  -- The value itself — exactly one of these two shapes is populated, never both:
  --   proposed_row: the source gave a genuine single point → column->value map
  --                 ready to INSERT into table_name if/when seeded.
  --   value_min/value_max: the source gave a range → stored faithfully, never
  --                 collapsed to a point. See rule 2 above.
  proposed_row          JSONB,
  value_min             NUMERIC,
  value_max             NUMERIC,
  unit                  TEXT,

  -- What this value is valid for, in words — not every scope dimension applies to
  -- every table, so these are free text rather than forcing a rigid column set.
  material_scope        TEXT,
  machine_scope         TEXT,
  tool_scope             TEXT,
  applicability          TEXT,

  -- Provenance — every proposal must be able to answer "where did this come from,
  -- and when." source_name/retrieved_date are mandatory (enforced in the service);
  -- the rest are filled in whenever the source actually provides them.
  source_name           TEXT NOT NULL,
  source_url            TEXT,
  source_document       TEXT,
  manufacturer          TEXT,
  part_number           TEXT,
  publication_date      DATE,
  retrieved_date        DATE NOT NULL,
  research_cutoff       DATE NOT NULL DEFAULT '2026-07-31',

  -- Confidence — same 0-1 convention already used by bom_items.material_confidence
  -- (migration 081), not a new scale.
  confidence            NUMERIC(4,2) CHECK (confidence BETWEEN 0 AND 1),

  -- validation_status — see this migration's header for 'approved_awaiting_range_
  -- capable_calculator'. 'unsupported' means a real, honest "no credible source
  -- found" finding, not a placeholder — it is a valid, useful outcome, not a gap
  -- in the research.
  validation_status     TEXT NOT NULL
                          CHECK (validation_status IN (
                            'verified','review','conflict','unsupported',
                            'approved_awaiting_range_capable_calculator'
                          )),
  conflict_notes        TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at           TIMESTAMPTZ,
  approved_by           UUID,
  rejected_at           TIMESTAMPTZ,
  rejection_reason      TEXT,
  seeded_at             TIMESTAMPTZ,
  seeded_row_id         BIGINT,

  CONSTRAINT proposal_value_shape CHECK (
    (proposed_row IS NOT NULL AND value_min IS NULL AND value_max IS NULL)
    OR (proposed_row IS NULL AND value_min IS NOT NULL AND value_max IS NOT NULL)
    OR (validation_status = 'unsupported' AND proposed_row IS NULL AND value_min IS NULL AND value_max IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_erp_job_id ON engineering_research_proposals(job_id);
CREATE INDEX IF NOT EXISTS idx_erp_validation_status ON engineering_research_proposals(validation_status);

-- Public read (matches lookup_coverage_gaps' own RLS convention, migration 429) —
-- writes go through the backend service using the service-role client, same as
-- the rest of this app's Supabase access pattern.
ALTER TABLE engineering_research_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering_research_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY erj_select_all ON engineering_research_jobs FOR SELECT USING (true);
CREATE POLICY erp_select_all ON engineering_research_proposals FOR SELECT USING (true);

-- Verification:
-- SELECT * FROM engineering_research_jobs;
-- SELECT * FROM engineering_research_proposals;
-- \d engineering_research_jobs
-- \d engineering_research_proposals
