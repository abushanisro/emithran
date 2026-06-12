-- Fix delivery_orders FK constraints to use ON DELETE SET NULL
-- This allows a delivery_address to be deleted even when referenced by orders.
-- The address columns on existing orders will be set to NULL instead of blocking the delete.

-- 1. Drop the existing FK constraints (Postgres auto-names them table_column_fkey)
ALTER TABLE delivery_orders
  DROP CONSTRAINT IF EXISTS delivery_orders_delivery_address_id_fkey,
  DROP CONSTRAINT IF EXISTS delivery_orders_billing_address_id_fkey;

-- 2. delivery_address_id must allow NULL now (was NOT NULL) so SET NULL can work
ALTER TABLE delivery_orders
  ALTER COLUMN delivery_address_id DROP NOT NULL;

-- 3. Re-add both FKs with ON DELETE SET NULL
ALTER TABLE delivery_orders
  ADD CONSTRAINT delivery_orders_delivery_address_id_fkey
    FOREIGN KEY (delivery_address_id) REFERENCES delivery_addresses(id) ON DELETE SET NULL,
  ADD CONSTRAINT delivery_orders_billing_address_id_fkey
    FOREIGN KEY (billing_address_id) REFERENCES delivery_addresses(id) ON DELETE SET NULL;
