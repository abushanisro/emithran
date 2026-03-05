-- Fix corrupted dock audit data in delivery orders
-- Replace empty arrays with NULL so the frontend will use defaults

UPDATE delivery_orders 
SET dock_audit = NULL 
WHERE dock_audit IS NOT NULL 
  AND (
    -- Check if dock_audit is an array of empty arrays
    dock_audit::text LIKE '%[],[],[],[]%'
    OR
    -- Check if dock_audit contains only empty arrays
    jsonb_array_length(dock_audit) > 0 
    AND NOT EXISTS (
      SELECT 1 
      FROM jsonb_array_elements(dock_audit) AS elem
      WHERE elem != '[]'::jsonb 
        AND elem != '{}'::jsonb
        AND jsonb_typeof(elem) = 'object'
        AND elem ? 'activity'
    )
  );

-- Verify the fix
SELECT 
  COUNT(*) as total_orders,
  COUNT(dock_audit) as orders_with_dock_audit,
  COUNT(CASE WHEN dock_audit IS NOT NULL AND jsonb_typeof(dock_audit) = 'array' AND jsonb_array_length(dock_audit) > 0 THEN 1 END) as orders_with_valid_dock_audit
FROM delivery_orders;                                                                                                                             