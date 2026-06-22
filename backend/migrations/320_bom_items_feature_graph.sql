-- Migration 320: Add manufacturing feature graph columns to bom_items
-- Adds: hole_count, pierce_count, flat_pattern_area_mm2, feature_graph (jsonb),
--       family_classification (denormalised from featureGraph for SQL filtering),
--       family_confidence (denormalised for ranking/routing rules)
-- All nullable — no backfill needed. Existing rows get null.

ALTER TABLE bom_items
  ADD COLUMN IF NOT EXISTS hole_count             integer,
  ADD COLUMN IF NOT EXISTS pierce_count           integer,
  ADD COLUMN IF NOT EXISTS flat_pattern_area_mm2  numeric(12,2),
  ADD COLUMN IF NOT EXISTS feature_graph          jsonb,
  ADD COLUMN IF NOT EXISTS family_classification  varchar(50),
  ADD COLUMN IF NOT EXISTS family_confidence      numeric(4,3);

-- Index for family-based queries (cost routing, DFM, supplier matching)
CREATE INDEX IF NOT EXISTS idx_bom_items_family_classification
  ON bom_items (family_classification)
  WHERE family_classification IS NOT NULL;
