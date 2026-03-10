-- Quick fix to add cost data to raw materials for testing
-- This will add sample cost data to materials that don't have any

-- Update raw materials with sample costs for testing
UPDATE raw_materials 
SET 
    cost = CASE 
        WHEN material_group = 'Plastic & Rubber' THEN ROUND((RANDOM() * 100 + 50)::numeric, 2)
        WHEN material_group = 'Ferrous & Non-Ferrous' THEN ROUND((RANDOM() * 150 + 80)::numeric, 2)
        ELSE ROUND((RANDOM() * 80 + 40)::numeric, 2)
    END,
    currency = 'INR'
WHERE cost IS NULL OR cost = 0;

-- Alternative: Set a specific cost for testing
-- UPDATE raw_materials SET cost = 75.50, currency = 'INR' WHERE material ILIKE '%ABS%';

-- Check the updated costs
SELECT 
    material_group,
    material,
    cost,
    currency,
    country
FROM raw_materials 
WHERE cost > 0
ORDER BY material_group, material
LIMIT 20;