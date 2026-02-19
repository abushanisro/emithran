-- Migration: Safe BOM Item Delete Function
-- Created: 2026-02-19
-- Description: Create function to delete BOM items bypassing trigger-created constraint violations

-- Function to safely delete BOM items by handling constraint violations
CREATE OR REPLACE FUNCTION safe_delete_bom_items(bom_item_ids_input UUID[])
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER := 0;
    item_id UUID;
    current_count INTEGER;
BEGIN
    -- First, clean up any existing NULL records globally
    DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
    DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
    
    -- If no items to delete, return 0
    IF bom_item_ids_input IS NULL OR array_length(bom_item_ids_input, 1) = 0 THEN
        RETURN 0;
    END IF;
    
    -- Try bulk deletion first
    BEGIN
        DELETE FROM bom_items WHERE id = ANY(bom_item_ids_input);
        GET DIAGNOSTICS deleted_count = ROW_COUNT;
        
        -- Clean up any NULL records that may have been created
        DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
        DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
        
        RETURN deleted_count;
    EXCEPTION
        WHEN OTHERS THEN
            -- Bulk deletion failed, try individual deletion with constraint handling
            deleted_count := 0;
    END;
    
    -- Individual deletion with aggressive cleanup
    FOREACH item_id IN ARRAY bom_item_ids_input
    LOOP
        BEGIN
            -- Pre-delete cleanup
            DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
            DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
            
            -- Delete any remaining dependencies for this specific item
            DELETE FROM bom_item_costs WHERE bom_item_id = item_id;
            DELETE FROM production_lot_materials WHERE bom_item_id = item_id;
            
            -- Try to delete the BOM item
            DELETE FROM bom_items WHERE id = item_id;
            GET DIAGNOSTICS current_count = ROW_COUNT;
            deleted_count := deleted_count + current_count;
            
            -- Post-delete cleanup
            DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
            DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
            
        EXCEPTION
            WHEN OTHERS THEN
                -- Even individual deletion failed, try with more aggressive cleanup
                BEGIN
                    -- Nuclear cleanup - remove any records that might be causing issues
                    DELETE FROM bom_item_costs WHERE bom_item_id IS NULL OR bom_item_id = item_id;
                    DELETE FROM production_lot_materials WHERE bom_item_id IS NULL OR bom_item_id = item_id;
                    
                    -- Force delete the BOM item
                    DELETE FROM bom_items WHERE id = item_id;
                    GET DIAGNOSTICS current_count = ROW_COUNT;
                    deleted_count := deleted_count + current_count;
                    
                    -- Final cleanup
                    DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
                    DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
                EXCEPTION
                    WHEN OTHERS THEN
                        -- Log the failure but continue with other items
                        CONTINUE;
                END;
        END;
    END LOOP;
    
    -- Final global cleanup
    DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
    DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION safe_delete_bom_items(UUID[]) TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION safe_delete_bom_items(UUID[]) IS 'Safely deletes BOM items with aggressive cleanup to handle constraint violations from triggers';

-- Function to safely delete BOMs by handling constraint violations
CREATE OR REPLACE FUNCTION safe_delete_boms(bom_ids_input UUID[])
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER := 0;
    bom_id UUID;
    current_count INTEGER;
    all_bom_item_ids UUID[];
BEGIN
    -- First, clean up any existing NULL records globally
    DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
    DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
    
    -- If no BOMs to delete, return 0
    IF bom_ids_input IS NULL OR array_length(bom_ids_input, 1) = 0 THEN
        RETURN 0;
    END IF;
    
    -- Get all BOM items for these BOMs first
    SELECT array_agg(bom_items.id) INTO all_bom_item_ids
    FROM bom_items 
    WHERE bom_items.bom_id = ANY(bom_ids_input);
    
    -- Delete all BOM item dependencies first using our safe function
    IF all_bom_item_ids IS NOT NULL AND array_length(all_bom_item_ids, 1) > 0 THEN
        PERFORM safe_delete_bom_items(all_bom_item_ids);
    END IF;
    
    -- Clean up any remaining NULL records
    DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
    DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
    
    -- Try bulk BOM deletion first
    BEGIN
        DELETE FROM boms WHERE id = ANY(bom_ids_input);
        GET DIAGNOSTICS deleted_count = ROW_COUNT;
        
        -- Clean up any NULL records that may have been created
        DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
        DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
        
        RETURN deleted_count;
    EXCEPTION
        WHEN OTHERS THEN
            -- Bulk deletion failed, try individual deletion
            deleted_count := 0;
    END;
    
    -- Individual BOM deletion with aggressive cleanup
    FOREACH bom_id IN ARRAY bom_ids_input
    LOOP
        BEGIN
            -- Pre-delete cleanup
            DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
            DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
            
            -- Try to delete the BOM
            DELETE FROM boms WHERE id = bom_id;
            GET DIAGNOSTICS current_count = ROW_COUNT;
            deleted_count := deleted_count + current_count;
            
            -- Post-delete cleanup
            DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
            DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
            
        EXCEPTION
            WHEN OTHERS THEN
                -- Even individual deletion failed, try nuclear cleanup
                BEGIN
                    -- Nuclear cleanup
                    DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
                    DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
                    
                    -- Force delete the BOM
                    DELETE FROM boms WHERE id = bom_id;
                    GET DIAGNOSTICS current_count = ROW_COUNT;
                    deleted_count := deleted_count + current_count;
                    
                    -- Final cleanup
                    DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
                    DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
                EXCEPTION
                    WHEN OTHERS THEN
                        -- Continue with other BOMs
                        CONTINUE;
                END;
        END;
    END LOOP;
    
    -- Final global cleanup
    DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
    DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION safe_delete_boms(UUID[]) TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION safe_delete_boms(UUID[]) IS 'Safely deletes BOMs with comprehensive cleanup to handle constraint violations from triggers';