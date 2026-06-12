-- Migration: Fix numeric precision for material_utilization_rate and scrap_rate
-- These columns were DECIMAL(5,2) which only allows up to 999.99,
-- but calculated values can exceed this range (e.g. utilization rate > 1000%).

ALTER TABLE raw_material_cost_records
  ALTER COLUMN material_utilization_rate TYPE DECIMAL(15, 4),
  ALTER COLUMN scrap_rate TYPE DECIMAL(15, 4);
