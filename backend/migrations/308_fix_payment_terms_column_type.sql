-- ============================================================================
-- Migration 308: Fix payment_terms columns — change NUMERIC to TEXT
-- Migration 307 incorrectly created these as NUMERIC; they hold strings
-- like "50% ADP +50% AD", "30 Days credit", etc.
-- ============================================================================

ALTER TABLE part_wise_cost_base_data
  ALTER COLUMN base_payment_terms TYPE TEXT USING base_payment_terms::TEXT;

ALTER TABLE part_wise_cost_analysis
  ALTER COLUMN payment_terms TYPE TEXT USING payment_terms::TEXT;
