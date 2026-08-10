-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 453: Link lookup_coverage_gaps to engineering_research_jobs (2026-08-09)
--
-- Lets the Lookup Coverage dashboard show "research in progress" (and later,
-- "resolved via job #N") for a gap instead of it just sitting in the open list
-- with no indication anyone is working on it. Nullable — a gap with no job yet
-- is simply NULL here, same as before this migration.
-- ════════════════════════════════════════════════════════════════════════════════

ALTER TABLE lookup_coverage_gaps
  ADD COLUMN IF NOT EXISTS research_job_id BIGINT REFERENCES engineering_research_jobs(id);

CREATE INDEX IF NOT EXISTS idx_lcg_research_job_id ON lookup_coverage_gaps(research_job_id);

-- Verification:
-- SELECT id, process, machine_class, status, research_job_id FROM lookup_coverage_gaps;
