-- Debug delivery orders to understand what's happening

-- 1. Check if delivery_orders table exists and has data
SELECT COUNT(*) as total_delivery_orders FROM delivery_orders;

-- 2. Check recent delivery orders
SELECT 
    id, 
    order_number, 
    project_id, 
    status, 
    created_at,
    delivery_address_id
FROM delivery_orders 
ORDER BY created_at DESC 
LIMIT 10;

-- 3. Check for the specific project ID from the logs
SELECT 
    id, 
    order_number, 
    status, 
    created_at
FROM delivery_orders 
WHERE project_id = 'bc7f8e60-fd5c-41af-8ac4-4d2882834daf'
ORDER BY created_at DESC;

-- 4. Check if there are any delivery orders at all
SELECT COUNT(*) as count, project_id FROM delivery_orders GROUP BY project_id;

-- 5. Check the most recently created delivery order
SELECT * FROM delivery_orders ORDER BY created_at DESC LIMIT 1;

-- 6. Find the UUID for specific order number
SELECT id, order_number, project_id, status FROM delivery_orders 
WHERE order_number = 'DO-1772575707009-0AVG';