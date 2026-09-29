-- ============================================================================
-- Migration 814a: restore mhr_records.specs (jsonb)
--
-- Run this BEFORE 815, 818, 820 and 824 - all four insert into specs and
-- fail with "column specs of relation mhr_records does not exist".
--
-- Migration 563 dropped specs because, at the time, no live calculation read
-- it. That is no longer true: the real machine files in memory/ carry
-- process-specific rates and capability with no dedicated column (band saw
-- stock envelope, forging press data, packaging carton rates, sealing time,
-- ultrasonic scan rate, plating / coating cost per area, engrave speed, dryer
-- stage length). Band saw and forging data is stored for provenance only; the
-- secondary-process and surface-treatment data is priced from specs by:
--   costing/secondary/secondary-process-engine.ts
--   costing/surface/surface-treatment-engine.ts
-- mhr.service.ts / mhr DTOs also still read and write specs on create,
-- update and Excel import.
--
-- Additive and idempotent: existing rows get NULL (the value mhr.service
-- writes for an empty specs object). Nothing else in 563 is reverted.
-- ============================================================================

ALTER TABLE mhr_records
  ADD COLUMN IF NOT EXISTS specs JSONB;

NOTIFY pgrst, 'reload schema';

-- Verify (expect one row, data_type jsonb):
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'mhr_records' AND column_name = 'specs';
