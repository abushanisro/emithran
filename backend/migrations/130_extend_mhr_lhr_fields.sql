-- Migration 130: Extend mhr_records and lsr_records with India 2026 fields
-- Run this in Supabase SQL Editor before restarting the backend.

-- ─── mhr_records ─────────────────────────────────────────────────────────────
ALTER TABLE mhr_records
  ADD COLUMN IF NOT EXISTS process_group         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS process_category      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS machine_class         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS automation_level      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS operators             SMALLINT    DEFAULT 1,
  ADD COLUMN IF NOT EXISTS wage_grade            VARCHAR(20),
  ADD COLUMN IF NOT EXISTS machine_price_usd     NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS manufacturer_country  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS setup_time_hr         NUMERIC(5,  2),
  ADD COLUMN IF NOT EXISTS lhr_inr_per_hr        NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS specs                 JSONB       DEFAULT '{}';

-- Back-fill process_group from commodity_code for pre-existing records
UPDATE mhr_records
SET    process_group = commodity_code
WHERE  process_group IS NULL AND commodity_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mhr_process_group ON mhr_records(user_id, process_group);
CREATE INDEX IF NOT EXISTS idx_mhr_wage_grade    ON mhr_records(wage_grade);
CREATE INDEX IF NOT EXISTS idx_mhr_specs_gin     ON mhr_records USING GIN(specs);

-- ─── lsr_records ─────────────────────────────────────────────────────────────
ALTER TABLE lsr_records
  ADD COLUMN IF NOT EXISTS process_group         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS machine_name          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS machine_description   TEXT,
  ADD COLUMN IF NOT EXISTS manufacturer          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS manufacturer_country  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS wage_grade            VARCHAR(20),
  ADD COLUMN IF NOT EXISTS operators             SMALLINT    DEFAULT 1,
  ADD COLUMN IF NOT EXISTS shifts_per_day        NUMERIC(5,  2),
  ADD COLUMN IF NOT EXISTS hours_per_shift       NUMERIC(5,  2),
  ADD COLUMN IF NOT EXISTS working_days_per_year NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS total_hrs_per_year    NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS usd_labor_rate_per_hr NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS usd_lhr_base          NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS usd_lhr_burden        NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS usd_lhr_total         NUMERIC(10, 4);

CREATE INDEX IF NOT EXISTS idx_lsr_process_group ON lsr_records(user_id, process_group);
CREATE INDEX IF NOT EXISTS idx_lsr_machine_name  ON lsr_records(user_id, machine_name);
CREATE INDEX IF NOT EXISTS idx_lsr_wage_grade    ON lsr_records(wage_grade);
