-- ============================================================================
-- MIGRATION 075: Add Currency Column to Raw Materials
-- ============================================================================
-- Adds currency column to support multi-currency cost tracking
-- ============================================================================

-- Add currency column to raw_materials table
ALTER TABLE raw_materials 
ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'INR';

-- Add helpful comment
COMMENT ON COLUMN raw_materials.currency IS 'Currency code (INR, USD, EUR, etc.) for cost field';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_raw_materials_currency ON raw_materials(currency);

-- Add constraint for valid currency codes
ALTER TABLE raw_materials 
ADD CONSTRAINT check_valid_currency 
CHECK (currency IS NULL OR currency IN ('INR', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'AUD', 'CHF', 'SEK'));

-- Migration completed successfully