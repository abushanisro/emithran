-- Migration: 015_update_requested_delivery_to_datetime.sql
-- Update requested_delivery_date from DATE to TIMESTAMP to support both date and time

-- Step 1: Drop the materialized view that depends on the column
DROP MATERIALIZED VIEW IF EXISTS delivery_performance_metrics;

-- Step 2: Add new column with TIMESTAMP type
ALTER TABLE delivery_orders ADD COLUMN requested_delivery_datetime TIMESTAMP;

-- Step 3: Migrate existing data (preserve existing dates by setting time to 00:00)
UPDATE delivery_orders 
SET requested_delivery_datetime = requested_delivery_date::TIMESTAMP 
WHERE requested_delivery_date IS NOT NULL;

-- Step 4: Drop the old DATE column
ALTER TABLE delivery_orders DROP COLUMN requested_delivery_date;

-- Step 5: Rename new column to match expected name
ALTER TABLE delivery_orders RENAME COLUMN requested_delivery_datetime TO requested_delivery_date;

-- Step 6: Update the constraint to work with TIMESTAMP instead of DATE
ALTER TABLE delivery_orders DROP CONSTRAINT IF EXISTS valid_delivery_dates;

ALTER TABLE delivery_orders ADD CONSTRAINT valid_delivery_dates 
CHECK (
  estimated_delivery_date IS NULL OR 
  requested_delivery_date IS NULL OR 
  estimated_delivery_date::DATE >= requested_delivery_date::DATE
);

-- Step 7: Add index for better query performance on the new timestamp column
CREATE INDEX IF NOT EXISTS idx_delivery_orders_requested_delivery_date 
ON delivery_orders(requested_delivery_date);

-- Step 8: Recreate the materialized view with updated column reference
CREATE MATERIALIZED VIEW delivery_performance_metrics AS
SELECT 
  DATE_TRUNC('month', dord.created_at) as month,
  COUNT(*) as total_deliveries,
  COUNT(*) FILTER (WHERE dord.status = 'delivered') as successful_deliveries,
  COUNT(*) FILTER (WHERE dord.actual_delivery_date <= dord.requested_delivery_date::DATE) as on_time_deliveries,
  AVG(dord.total_delivery_cost_inr) as avg_delivery_cost,
  AVG(CASE 
    WHEN dord.actual_delivery_date IS NOT NULL AND dord.requested_delivery_date IS NOT NULL 
    THEN EXTRACT(DAY FROM (dord.actual_delivery_date::timestamp - dord.requested_delivery_date::timestamp))
    ELSE NULL
  END) as avg_delay_days,
  dord.carrier_id,
  carriers.name as carrier_name
FROM delivery_orders dord
LEFT JOIN carriers ON dord.carrier_id = carriers.id
WHERE dord.status != 'cancelled'
GROUP BY DATE_TRUNC('month', dord.created_at), dord.carrier_id, carriers.name;

-- Add comments for documentation
COMMENT ON COLUMN delivery_orders.requested_delivery_date IS 'Requested delivery date and time (TIMESTAMP format)';