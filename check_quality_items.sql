-- Check current state of quality_approved_items table
SELECT 
    COUNT(*) as total_items,
    COUNT(CASE WHEN approval_status = 'approved' THEN 1 END) as approved_items,
    COUNT(CASE WHEN delivery_ready = true THEN 1 END) as delivery_ready_items
FROM quality_approved_items;

-- Check if any BOM items exist
SELECT COUNT(*) as total_bom_items FROM bom_items;

-- Sample quality approved items
SELECT * FROM quality_approved_items LIMIT 5;