-- Migration 342: Rename lsr_records → lhr_records and lsr_benchmark_rates → lhr_benchmark_rates
-- Rationale: Both tables have always stored Labour Hour Rate (LHR) data.
-- "LSR" (Labour Standard Rate) was a misnomer across all labour tables.
-- This migration corrects all naming without touching any data.
-- All application code updated in the same commit.
--
-- Safe to run multiple times (IF EXISTS guards on every statement).

-- ── 1. Rename the table ──────────────────────────────────────────────────────
ALTER TABLE IF EXISTS lsr_records RENAME TO lhr_records;

-- ── 2. Rename indexes ────────────────────────────────────────────────────────
ALTER INDEX IF EXISTS idx_lsr_records_user_id     RENAME TO idx_lhr_records_user_id;
ALTER INDEX IF EXISTS idx_lsr_records_labour_code RENAME TO idx_lhr_records_labour_code;
ALTER INDEX IF EXISTS idx_lsr_records_labour_type RENAME TO idx_lhr_records_labour_type;
ALTER INDEX IF EXISTS idx_lsr_records_location    RENAME TO idx_lhr_records_location;
ALTER INDEX IF EXISTS idx_lsr_records_created_at  RENAME TO idx_lhr_records_created_at;

-- ── 3. Rename trigger + backing function ────────────────────────────────────
DROP TRIGGER IF EXISTS trigger_update_lsr_updated_at ON lhr_records;
DROP TRIGGER IF EXISTS trigger_update_lhr_updated_at ON lhr_records;

CREATE OR REPLACE FUNCTION update_lhr_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_lhr_updated_at
  BEFORE UPDATE ON lhr_records
  FOR EACH ROW
  EXECUTE FUNCTION update_lhr_updated_at();

-- ── 4. Rename RLS policies ───────────────────────────────────────────────────
-- Drop old (stale-named) policies; then recreate under correct names.
-- All CREATE POLICY calls are guarded in DO blocks so re-runs are safe.
DROP POLICY IF EXISTS "Users can view their own LSR records"   ON lhr_records;
DROP POLICY IF EXISTS "Users can create their own LSR records" ON lhr_records;
DROP POLICY IF EXISTS "Users can update their own LSR records" ON lhr_records;
DROP POLICY IF EXISTS "Users can delete their own LSR records" ON lhr_records;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lhr_records' AND policyname = 'Users can view their own LHR records') THEN
    CREATE POLICY "Users can view their own LHR records"
      ON lhr_records FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lhr_records' AND policyname = 'Users can create their own LHR records') THEN
    CREATE POLICY "Users can create their own LHR records"
      ON lhr_records FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lhr_records' AND policyname = 'Users can update their own LHR records') THEN
    CREATE POLICY "Users can update their own LHR records"
      ON lhr_records FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lhr_records' AND policyname = 'Users can delete their own LHR records') THEN
    CREATE POLICY "Users can delete their own LHR records"
      ON lhr_records FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- ── 5. Rename lsr_id → lhr_id in process_cost_records ──────────────────────
-- This column is a loose FK to lhr_records; renaming it closes the naming gap.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'process_cost_records' AND column_name = 'lsr_id'
  ) THEN
    ALTER TABLE process_cost_records RENAME COLUMN lsr_id TO lhr_id;
  END IF;
END $$;

-- ── 6. Rename lsr_benchmark_rates → lhr_benchmark_rates ────────────────────
-- This table stores global benchmark LHR values per location/process-group.
-- Migration 340 created it as lsr_benchmark_rates; 341 backfilled it.
-- Rename here so the table name aligns with the corrected LHR nomenclature.
ALTER TABLE IF EXISTS lsr_benchmark_rates RENAME TO lhr_benchmark_rates;

-- Drop old RLS policies (if they exist on the now-renamed table).
DROP POLICY IF EXISTS "Public read for lsr_benchmark_rates" ON lhr_benchmark_rates;

-- Recreate with correct name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'lhr_benchmark_rates' AND policyname = 'Public read for lhr_benchmark_rates'
  ) THEN
    CREATE POLICY "Public read for lhr_benchmark_rates"
      ON lhr_benchmark_rates FOR SELECT
      USING (true);
  END IF;
END $$;

-- ── 7. Update table comments ─────────────────────────────────────────────────
COMMENT ON TABLE lhr_records IS 'Labour Hour Rate (LHR) database for manufacturing labour cost analysis';
COMMENT ON COLUMN lhr_records.lhr IS 'Labour Hour Rate (LHR) — cost per hour in local currency';
COMMENT ON TABLE lhr_benchmark_rates IS 'Global benchmark LHR values per location and process group for cost comparison';
