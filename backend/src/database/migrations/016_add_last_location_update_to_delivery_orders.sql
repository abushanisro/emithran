-- Add last_location_update column to delivery_orders
-- This column tracks when the delivery location was last updated from a tracking event

ALTER TABLE delivery_orders
ADD COLUMN IF NOT EXISTS last_location_update TIMESTAMP WITH TIME ZONE;
