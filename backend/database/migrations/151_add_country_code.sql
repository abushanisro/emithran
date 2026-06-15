-- Migration 151: Add country_code to master tables for multi-country cost engineering
--
-- Architecture intent:
--   raw_materials  → 'GLOBAL' (commodity pricing reused across all scenarios)
--   mhr_records    → 'IN'     (India shop rates today; add DE/CN/US rows later)
--   lsr_records    → 'IN'     (India labour bands today; add DE/CN/US rows later)
--
-- This enables scenario-based costing: same global material, different country
-- labour and machine economics, normalized via ExchangeRateService.

ALTER TABLE raw_materials
  ADD COLUMN IF NOT EXISTS country_code CHAR(2) DEFAULT 'GL';

ALTER TABLE mhr_records
  ADD COLUMN IF NOT EXISTS country_code CHAR(2) DEFAULT 'IN';

ALTER TABLE lsr_records
  ADD COLUMN IF NOT EXISTS country_code CHAR(2) DEFAULT 'IN';

-- Back-fill existing rows
UPDATE raw_materials SET country_code = 'GL' WHERE country_code IS NULL;
UPDATE mhr_records    SET country_code = 'IN' WHERE country_code IS NULL;
UPDATE lsr_records    SET country_code = 'IN' WHERE country_code IS NULL;

-- Indexes for scenario-based filtering (retrieve only rows matching a target country)
CREATE INDEX IF NOT EXISTS idx_mhr_records_country_code ON mhr_records (country_code);
CREATE INDEX IF NOT EXISTS idx_lsr_records_country_code ON lsr_records (country_code);
CREATE INDEX IF NOT EXISTS idx_raw_materials_country_code ON raw_materials (country_code);
