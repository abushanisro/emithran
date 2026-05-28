-- Migration 131: Add unique constraint to lsr_records + USD LHR cols to mhr_records
-- Run this in Supabase SQL Editor.

-- ─── lsr_records: unique constraint for upsert support ───────────────────────
-- First clean up any duplicate (user_id, labour_code) rows keeping the latest
DELETE FROM lsr_records a
USING lsr_records b
WHERE a.ctid < b.ctid
  AND a.user_id = b.user_id
  AND a.labour_code = b.labour_code;

ALTER TABLE lsr_records
  ADD CONSTRAINT uq_lsr_user_labour_code UNIQUE (user_id, labour_code);

-- ─── mhr_records: per-machine USD LHR columns ────────────────────────────────
ALTER TABLE mhr_records
  ADD COLUMN IF NOT EXISTS usd_labor_rate_per_hr NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS usd_lhr_base          NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS usd_lhr_burden        NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS usd_lhr_total         NUMERIC(10, 4);
