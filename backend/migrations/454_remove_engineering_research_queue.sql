-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 454: Remove the Engineering Research Queue schema (2026-08-09)
--
-- Reverses migrations 452/453. The user's direction: this quote-level part
-- needs three real engineering-data gaps closed (Quattro laser power/cut
-- speed, 5T hole-flanging stroke time, 60T Roper Whitney press-brake stroke
-- time) — not a whole approval/provenance pipeline built around them. The
-- research already done this session (Burring/Press Brake stroke time is
-- NOT tonnage-driven per any real source found — see this session's
-- project memory note) is preserved there, not lost by dropping these tables.
--
-- Does NOT touch lookup_coverage_gaps itself (migration 429) or
-- lookup_table_policy (migration 427) — both predate this session's research-
-- queue work and remain part of the existing, kept Manufacturing Physics
-- Calculator architecture. Only the research_job_id link column (added by
-- 453) and the two new tables (added by 452) are removed here.
-- ════════════════════════════════════════════════════════════════════════════════

ALTER TABLE lookup_coverage_gaps
  DROP COLUMN IF EXISTS research_job_id;

DROP TABLE IF EXISTS engineering_research_proposals;
DROP TABLE IF EXISTS engineering_research_jobs;

-- Verification:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'lookup_coverage_gaps'; -- expect no research_job_id
-- SELECT to_regclass('engineering_research_jobs'), to_regclass('engineering_research_proposals'); -- expect both NULL
