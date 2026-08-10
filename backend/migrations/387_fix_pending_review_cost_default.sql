-- ===================================================================================
-- Migration 387: Fix cost=0 default on PENDING_REVIEW rows (2026-07-30)
--
-- Migrations 384 and 386 inserted the 6101 and SECC rows without explicitly
-- setting the `cost` column, which defaulted to 0 instead of NULL. The
-- regional cost columns (cost_india, cost_usa, etc.) were correctly left
-- NULL, which is why the material-picker detail panel correctly showed
-- "No cost data in database" -- but anything elsewhere in the app that reads
-- the generic `cost` column instead of the regional ones would see a false
-- $0.00 price instead of "unknown." Same failure mode this whole thread has
-- been about: a value that looks real but isn't.
--
-- Fix: set cost = NULL explicitly for any row still flagged PENDING_REVIEW.
-- Scoped to price_source = 'PENDING_REVIEW' so this can't touch any
-- legitimately-priced row.
-- ===================================================================================

UPDATE raw_materials
SET cost = NULL
WHERE price_source = 'PENDING_REVIEW';

-- Verification:
-- SELECT material, cost, cost_india, cost_usa, price_source
--   FROM raw_materials WHERE price_source = 'PENDING_REVIEW';
