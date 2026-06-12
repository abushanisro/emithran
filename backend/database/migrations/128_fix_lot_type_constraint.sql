-- Migration 128: Fix production_lots lot_type check constraint
-- Migration 086 defined lot_type IN ('prototype', 'standard', 'custom') which is
-- missing 'rework' and 'urgent', and has a spurious 'custom' value.
-- The service and DTO both expect ('standard', 'prototype', 'rework', 'urgent').

ALTER TABLE production_lots
  DROP CONSTRAINT IF EXISTS production_lots_lot_type_check;

ALTER TABLE production_lots
  ADD CONSTRAINT production_lots_lot_type_check
    CHECK (lot_type IN ('standard', 'prototype', 'rework', 'urgent'));

-- Migrate any existing 'custom' rows to 'standard' before the constraint lands
UPDATE production_lots
  SET lot_type = 'standard'
  WHERE lot_type = 'custom';

INSERT INTO schema_migrations (version, description)
VALUES ('128', 'Fix lot_type check constraint to match service enum')
ON CONFLICT (version) DO NOTHING;
