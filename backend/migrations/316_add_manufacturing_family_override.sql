-- Migration 316: Add manufacturing_family_override to bom_items
-- Allows users to pin a manufacturing family when the auto-classifier is wrong.
-- Setting this bypasses the ScopeClassifierService entirely.

ALTER TABLE bom_items
ADD COLUMN IF NOT EXISTS manufacturing_family_override TEXT
  CHECK (manufacturing_family_override IN ('sheet_metal', 'cnc_turned', 'cnc_milled'));

COMMENT ON COLUMN bom_items.manufacturing_family_override IS
  'User-set override for the manufacturing family classifier. NULL = auto-detect. '
  'Valid values: sheet_metal, cnc_turned, cnc_milled.';
