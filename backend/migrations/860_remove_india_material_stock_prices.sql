-- ============================================================================
-- Migration 860: remove the India stock prices
-- ============================================================================
-- India was the only location migration 833 loaded. The Raw Materials page now
-- shows stock prices for the USA cost region only, and India is no longer a cost
-- region. This deletes the India rows of material_stock_prices.
--
-- Note: re-running migration 833 would load them again; do not re-run it.
-- Idempotent: a second run deletes nothing.
-- ============================================================================

DELETE FROM material_stock_prices
WHERE location = 'India';

NOTIFY pgrst, 'reload schema';

-- Verify (expect 0): SELECT count(*) FROM material_stock_prices WHERE location = 'India';
