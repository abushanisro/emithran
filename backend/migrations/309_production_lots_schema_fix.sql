-- ============================================================================
-- Migration 309: Fix production_lots schema drift
-- The table was created from 000_consolidated_production_schema.sql which used
-- different column names than the service expects. Add all missing columns.
-- ============================================================================

-- production_quantity: service uses this; consolidated schema used "quantity"
ALTER TABLE production_lots
  ADD COLUMN IF NOT EXISTS production_quantity INTEGER;

UPDATE production_lots
  SET production_quantity = quantity
  WHERE production_quantity IS NULL
    AND quantity IS NOT NULL;

-- created_by: service uses this; consolidated schema used "user_id"
ALTER TABLE production_lots
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT;

UPDATE production_lots
  SET created_by = user_id
  WHERE created_by IS NULL
    AND user_id IS NOT NULL;

-- Other missing columns the service inserts
ALTER TABLE production_lots
  ADD COLUMN IF NOT EXISTS lot_type         VARCHAR(50)    DEFAULT 'standard'
    CHECK (lot_type IN ('standard', 'prototype', 'rework', 'urgent')),
  ADD COLUMN IF NOT EXISTS total_material_cost  DECIMAL(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_process_cost   DECIMAL(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_estimated_cost DECIMAL(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remarks          TEXT,
  ADD COLUMN IF NOT EXISTS organization_id  UUID;

-- Index for created_by lookups
CREATE INDEX IF NOT EXISTS idx_production_lots_created_by
  ON production_lots(created_by);
