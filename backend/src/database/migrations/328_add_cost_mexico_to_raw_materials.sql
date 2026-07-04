-- Migration 328: Add Mexico as a Digital Factory location.
-- Nullable, matches the existing cost_china/cost_germany/cost_w_europe pattern —
-- falls back to MATERIAL_DEFAULTS in the cost engine until populated, same as any
-- other location with sparse per-material regional pricing.

ALTER TABLE raw_materials
  ADD COLUMN IF NOT EXISTS cost_mexico NUMERIC(12,4);
