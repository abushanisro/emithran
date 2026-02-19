-- Migration: Safe Project Delete Function
-- Created: 2026-02-19
-- Description: Create a database function that safely deletes projects bypassing constraint issues

-- Create a function that handles project deletion with proper cascade cleanup
CREATE OR REPLACE FUNCTION safe_delete_project(project_id_input UUID)
RETURNS TEXT AS $$
DECLARE
    bom_ids UUID[];
    bom_item_ids UUID[];
    deleted_count INTEGER;
    total_deleted INTEGER := 0;
    result_text TEXT;
    bom_item_costs_deleted INTEGER := 0;
    production_materials_deleted INTEGER := 0;
    bom_items_deleted INTEGER := 0;
    boms_deleted INTEGER := 0;
    rfq_tracking_deleted INTEGER := 0;
    team_members_deleted INTEGER := 0;
    projects_deleted INTEGER := 0;
BEGIN
    -- First, clean up any existing orphaned records globally
    DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
    DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
    
    -- Get all BOMs for this project
    SELECT array_agg(id) INTO bom_ids 
    FROM boms 
    WHERE project_id = project_id_input;
    
    -- Get all BOM items for these BOMs
    IF bom_ids IS NOT NULL THEN
        SELECT array_agg(id) INTO bom_item_ids 
        FROM bom_items 
        WHERE bom_id = ANY(bom_ids);
        
        -- Delete BOM item dependencies first (in order)
        IF bom_item_ids IS NOT NULL THEN
            -- Delete BOM item costs
            DELETE FROM bom_item_costs 
            WHERE bom_item_id = ANY(bom_item_ids);
            GET DIAGNOSTICS bom_item_costs_deleted = ROW_COUNT;
            
            -- Delete production lot materials
            DELETE FROM production_lot_materials 
            WHERE bom_item_id = ANY(bom_item_ids);
            GET DIAGNOSTICS production_materials_deleted = ROW_COUNT;
            
            -- Clean up any orphaned records before deleting BOM items
            DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
            DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
            
            -- Delete BOM items with constraint handling
            BEGIN
                DELETE FROM bom_items 
                WHERE id = ANY(bom_item_ids);
                GET DIAGNOSTICS bom_items_deleted = ROW_COUNT;
            EXCEPTION
                WHEN foreign_key_violation OR check_violation OR not_null_violation THEN
                    -- Clean up any problematic records and retry
                    DELETE FROM bom_item_costs WHERE bom_item_id IS NULL OR bom_item_id = ANY(bom_item_ids);
                    DELETE FROM production_lot_materials WHERE bom_item_id IS NULL OR bom_item_id = ANY(bom_item_ids);
                    
                    -- Retry BOM item deletion
                    DELETE FROM bom_items 
                    WHERE id = ANY(bom_item_ids);
                    GET DIAGNOSTICS bom_items_deleted = ROW_COUNT;
            END;
            
            -- Final cleanup of any orphaned records that may have been created by triggers
            DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
            DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
        END IF;
        
        -- Delete BOMs
        DELETE FROM boms 
        WHERE project_id = project_id_input;
        GET DIAGNOSTICS boms_deleted = ROW_COUNT;
    END IF;
    
    -- Delete RFQ tracking
    DELETE FROM rfq_tracking 
    WHERE project_id = project_id_input;
    GET DIAGNOSTICS rfq_tracking_deleted = ROW_COUNT;
    
    -- Delete project team members
    DELETE FROM project_team_members 
    WHERE project_id = project_id_input;
    GET DIAGNOSTICS team_members_deleted = ROW_COUNT;
    
    -- Finally delete the project
    DELETE FROM projects 
    WHERE id = project_id_input;
    GET DIAGNOSTICS projects_deleted = ROW_COUNT;
    
    -- Final cleanup of any orphaned records that may have been created
    DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
    DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;
    
    -- Calculate total
    total_deleted := bom_item_costs_deleted + production_materials_deleted + bom_items_deleted + 
                     boms_deleted + rfq_tracking_deleted + team_members_deleted + projects_deleted;
    
    -- Build result as simple text (will be parsed by service)
    result_text := 'SUCCESS|' ||
                   'bom_item_costs:' || bom_item_costs_deleted || '|' ||
                   'production_lot_materials:' || production_materials_deleted || '|' ||
                   'bom_items:' || bom_items_deleted || '|' ||
                   'boms:' || boms_deleted || '|' ||
                   'rfq_tracking:' || rfq_tracking_deleted || '|' ||
                   'project_team_members:' || team_members_deleted || '|' ||
                   'projects:' || projects_deleted || '|' ||
                   'total:' || total_deleted;
    
    RETURN result_text;
EXCEPTION
    WHEN OTHERS THEN
        -- Return error information as simple text
        RETURN 'ERROR|' || SQLERRM || '|' || SQLSTATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION safe_delete_project(UUID) TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION safe_delete_project(UUID) IS 'Safely deletes a project and all its dependencies, bypassing constraint issues by deleting in correct order';