-- Add multi-currency and fully-burdened rate fields to mhr_records
ALTER TABLE mhr_records
  ADD COLUMN IF NOT EXISTS currency                    TEXT,
  ADD COLUMN IF NOT EXISTS currency_symbol             TEXT,
  ADD COLUMN IF NOT EXISTS mhr_usd_per_hour            NUMERIC,
  ADD COLUMN IF NOT EXISTS fully_burdened_local_per_hr NUMERIC,
  ADD COLUMN IF NOT EXISTS fully_burdened_usd_per_hr   NUMERIC,
  ADD COLUMN IF NOT EXISTS lhr_usd_effective           NUMERIC;

-- Add multi-currency and employer burden fields to lsr_records
ALTER TABLE lsr_records
  ADD COLUMN IF NOT EXISTS currency                    TEXT,
  ADD COLUMN IF NOT EXISTS currency_symbol             TEXT,
  ADD COLUMN IF NOT EXISTS employer_burden_percentage  NUMERIC,
  ADD COLUMN IF NOT EXISTS lhr_usd_effective           NUMERIC;
