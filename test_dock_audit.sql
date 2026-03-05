-- Test dock audit data persistence
-- This script checks if dock audit data is being saved and retrieved correctly

-- First, let's see the current delivery_orders table structure
\d delivery_orders;

-- Check if dock_audit column exists and its type
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'delivery_orders' 
AND column_name IN ('dock_audit', 'checked_by', 'checked_at');

-- Check recent delivery orders and their dock audit data
SELECT 
    id,
    order_number,
    created_at,
    dock_audit,
    checked_by,
    checked_at
FROM delivery_orders 
ORDER BY created_at DESC 
LIMIT 5;

-- Check if there are any delivery orders with dock audit data
SELECT 
    COUNT(*) as total_orders,
    COUNT(dock_audit) as orders_with_dock_audit,
    COUNT(checked_by) as orders_with_checked_by
FROM delivery_orders;