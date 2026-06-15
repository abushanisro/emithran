-- Migration 155: Add is_global flag to master tables + make user_id nullable on raw_materials
--
-- Industry standard pattern for multi-tenant SaaS with shared library data:
--   user_id = NULL, is_global = TRUE   → system/benchmark records (visible to all users)
--   user_id = <uuid>, is_global = FALSE → user-specific records (visible to owner only)
--
-- mhr_records already has user_id effectively nullable in this deployment.
-- raw_materials had user_id NOT NULL — we drop that constraint here.
--
-- RLS guidance (apply per table in Supabase dashboard or via policy statements):
--   SELECT: user_id = auth.uid() OR is_global = TRUE
--   INSERT: user_id = auth.uid() (users can only create their own records)
--   UPDATE: user_id = auth.uid() (users can only edit their own records)

-- ── Schema changes ────────────────────────────────────────────────────────────

ALTER TABLE raw_materials
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE mhr_records
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE lsr_records
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE calculators
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Mark existing user-specific records ──────────────────────────────────────
-- All pre-existing records remain is_global = FALSE (user-specific) — default handles this.

-- ── Back-fill benchmark seed records inserted by migrations 152 and 153 ──────
UPDATE mhr_records
  SET is_global = TRUE
  WHERE source_type = 'BENCHMARK';

UPDATE lsr_records
  SET is_global = TRUE
  WHERE labour_code LIKE 'LHR-IN-%';

-- ── Indexes for RLS and retrieval performance ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_raw_materials_is_global ON raw_materials (is_global);
CREATE INDEX IF NOT EXISTS idx_mhr_records_is_global   ON mhr_records   (is_global);
CREATE INDEX IF NOT EXISTS idx_lsr_records_is_global   ON lsr_records   (is_global);
CREATE INDEX IF NOT EXISTS idx_calculators_is_global   ON calculators   (is_global);
