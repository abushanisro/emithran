-- Migration: Fix Cost Sync Triggers to Prevent NULL bom_item_id During Deletion
-- Created: 2026-02-19
-- Description: Modify cost synchronization triggers to handle deletion scenarios properly

-- ISSUE: Cost sync triggers create NULL bom_item_id records during cascade deletion
-- SOLUTION: Add validation to ensure bom_item_id exists before syncing costs

-- ============================================================================
-- 1. Fix Raw Material Cost Sync Trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_raw_material_cost_to_bom_item()
RETURNS TRIGGER AS $$
DECLARE
    v_bom_item_exists BOOLEAN := false;
BEGIN
    -- Skip if bom_item_id is NULL
    IF NEW.bom_item_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- Check if the bom_item still exists (defensive programming for deletion scenarios)
    SELECT EXISTS(SELECT 1 FROM bom_items WHERE id = NEW.bom_item_id)
    INTO v_bom_item_exists;
    
    -- Skip sync if bom_item has been deleted (happens during cascade deletion)
    IF NOT v_bom_item_exists THEN
        RETURN NEW;
    END IF;
    
    -- Calculate total material cost from supplier data
    WITH material_totals AS (
        SELECT 
            SUM(
                CASE 
                    WHEN NEW.currency_code = 'INR' THEN NEW.total_cost_per_part_inr
                    WHEN NEW.currency_code = 'USD' THEN NEW.total_cost_per_part_usd * 83
                    ELSE NEW.total_cost_per_part_inr
                END
            ) as total_material_cost_inr
    )
    -- Update or insert the bom_item_cost record
    INSERT INTO bom_item_costs (
        bom_item_id, 
        user_id, 
        raw_material_cost, 
        own_cost, 
        total_cost, 
        unit_cost
    )
    SELECT 
        NEW.bom_item_id,
        NEW.user_id,
        COALESCE(mt.total_material_cost_inr, 0),
        COALESCE(mt.total_material_cost_inr, 0),
        COALESCE(mt.total_material_cost_inr, 0),
        COALESCE(mt.total_material_cost_inr, 0)
    FROM material_totals mt
    ON CONFLICT (bom_item_id, user_id)
    DO UPDATE SET
        raw_material_cost = COALESCE(EXCLUDED.raw_material_cost, 0),
        own_cost = COALESCE(EXCLUDED.raw_material_cost, 0) + COALESCE(bom_item_costs.process_cost, 0),
        total_cost = COALESCE(EXCLUDED.raw_material_cost, 0) + COALESCE(bom_item_costs.process_cost, 0) + COALESCE(bom_item_costs.direct_children_cost, 0),
        unit_cost = COALESCE(EXCLUDED.raw_material_cost, 0) + COALESCE(bom_item_costs.process_cost, 0) + COALESCE(bom_item_costs.direct_children_cost, 0),
        is_stale = false,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. Fix Packaging/Logistics Cost Sync Trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_packaging_logistics_cost_to_bom_item()
RETURNS TRIGGER AS $$
DECLARE
    v_bom_item_exists BOOLEAN := false;
BEGIN
    -- Skip if bom_item_id is NULL
    IF NEW.bom_item_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- Check if the bom_item still exists
    SELECT EXISTS(SELECT 1 FROM bom_items WHERE id = NEW.bom_item_id)
    INTO v_bom_item_exists;
    
    -- Skip sync if bom_item has been deleted
    IF NOT v_bom_item_exists THEN
        RETURN NEW;
    END IF;
    
    -- Update or insert packaging cost
    INSERT INTO bom_item_costs (
        bom_item_id, 
        user_id, 
        raw_material_cost,
        own_cost, 
        total_cost, 
        unit_cost
    )
    VALUES (
        NEW.bom_item_id,
        NEW.user_id,
        COALESCE(NEW.total_cost_per_part_inr, 0),
        COALESCE(NEW.total_cost_per_part_inr, 0),
        COALESCE(NEW.total_cost_per_part_inr, 0),
        COALESCE(NEW.total_cost_per_part_inr, 0)
    )
    ON CONFLICT (bom_item_id, user_id)
    DO UPDATE SET
        raw_material_cost = COALESCE(NEW.total_cost_per_part_inr, 0),
        own_cost = COALESCE(NEW.total_cost_per_part_inr, 0) + COALESCE(bom_item_costs.process_cost, 0),
        total_cost = COALESCE(NEW.total_cost_per_part_inr, 0) + COALESCE(bom_item_costs.process_cost, 0) + COALESCE(bom_item_costs.direct_children_cost, 0),
        unit_cost = COALESCE(NEW.total_cost_per_part_inr, 0) + COALESCE(bom_item_costs.process_cost, 0) + COALESCE(bom_item_costs.direct_children_cost, 0),
        is_stale = false,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. Fix Procured Parts Cost Sync Trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_procured_parts_cost_to_bom_item()
RETURNS TRIGGER AS $$
DECLARE
    v_bom_item_exists BOOLEAN := false;
BEGIN
    -- Skip if bom_item_id is NULL
    IF NEW.bom_item_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- Check if the bom_item still exists
    SELECT EXISTS(SELECT 1 FROM bom_items WHERE id = NEW.bom_item_id)
    INTO v_bom_item_exists;
    
    -- Skip sync if bom_item has been deleted
    IF NOT v_bom_item_exists THEN
        RETURN NEW;
    END IF;
    
    -- Update or insert procured parts cost
    INSERT INTO bom_item_costs (
        bom_item_id, 
        user_id, 
        raw_material_cost,
        own_cost, 
        total_cost, 
        unit_cost
    )
    VALUES (
        NEW.bom_item_id,
        NEW.user_id,
        COALESCE(NEW.total_cost_per_part_inr, 0),
        COALESCE(NEW.total_cost_per_part_inr, 0),
        COALESCE(NEW.total_cost_per_part_inr, 0),
        COALESCE(NEW.total_cost_per_part_inr, 0)
    )
    ON CONFLICT (bom_item_id, user_id)
    DO UPDATE SET
        raw_material_cost = COALESCE(NEW.total_cost_per_part_inr, 0),
        own_cost = COALESCE(NEW.total_cost_per_part_inr, 0) + COALESCE(bom_item_costs.process_cost, 0),
        total_cost = COALESCE(NEW.total_cost_per_part_inr, 0) + COALESCE(bom_item_costs.process_cost, 0) + COALESCE(bom_item_costs.direct_children_cost, 0),
        unit_cost = COALESCE(NEW.total_cost_per_part_inr, 0) + COALESCE(bom_item_costs.process_cost, 0) + COALESCE(bom_item_costs.direct_children_cost, 0),
        is_stale = false,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. Fix Child Part Cost Sync Trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_child_part_cost_to_bom_item()
RETURNS TRIGGER AS $$
DECLARE
    v_bom_item_exists BOOLEAN := false;
BEGIN
    -- Skip if bom_item_id is NULL
    IF NEW.bom_item_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- Check if the bom_item still exists
    SELECT EXISTS(SELECT 1 FROM bom_items WHERE id = NEW.bom_item_id)
    INTO v_bom_item_exists;
    
    -- Skip sync if bom_item has been deleted
    IF NOT v_bom_item_exists THEN
        RETURN NEW;
    END IF;
    
    -- Update or insert child part cost
    INSERT INTO bom_item_costs (
        bom_item_id, 
        user_id, 
        direct_children_cost,
        own_cost, 
        total_cost, 
        unit_cost
    )
    VALUES (
        NEW.bom_item_id,
        NEW.user_id,
        COALESCE(NEW.total_cost_per_part_inr, 0),
        COALESCE(NEW.total_cost_per_part_inr, 0),
        COALESCE(NEW.total_cost_per_part_inr, 0),
        COALESCE(NEW.total_cost_per_part_inr, 0)
    )
    ON CONFLICT (bom_item_id, user_id)
    DO UPDATE SET
        direct_children_cost = COALESCE(NEW.total_cost_per_part_inr, 0),
        own_cost = COALESCE(bom_item_costs.raw_material_cost, 0) + COALESCE(bom_item_costs.process_cost, 0),
        total_cost = COALESCE(bom_item_costs.raw_material_cost, 0) + COALESCE(bom_item_costs.process_cost, 0) + COALESCE(NEW.total_cost_per_part_inr, 0),
        unit_cost = COALESCE(bom_item_costs.raw_material_cost, 0) + COALESCE(bom_item_costs.process_cost, 0) + COALESCE(NEW.total_cost_per_part_inr, 0),
        is_stale = false,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. Fix BOM Totals Update Trigger (from Process Cost System)
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_process_cost_to_bom_item()
RETURNS TRIGGER AS $$
DECLARE
    v_bom_item_exists BOOLEAN := false;
BEGIN
    -- Skip if bom_item_id is NULL
    IF NEW.bom_item_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- Check if the bom_item still exists
    SELECT EXISTS(SELECT 1 FROM bom_items WHERE id = NEW.bom_item_id)
    INTO v_bom_item_exists;
    
    -- Skip sync if bom_item has been deleted
    IF NOT v_bom_item_exists THEN
        RETURN NEW;
    END IF;
    
    -- Update or insert process cost
    INSERT INTO bom_item_costs (
        bom_item_id, 
        user_id, 
        process_cost, 
        own_cost, 
        total_cost, 
        unit_cost
    )
    VALUES (
        NEW.bom_item_id,
        NEW.user_id,
        COALESCE(NEW.total_cost_per_part, 0),
        COALESCE(NEW.total_cost_per_part, 0),
        COALESCE(NEW.total_cost_per_part, 0),
        COALESCE(NEW.total_cost_per_part, 0)
    )
    ON CONFLICT (bom_item_id, user_id)
    DO UPDATE SET
        process_cost = COALESCE(NEW.total_cost_per_part, 0),
        own_cost = COALESCE(bom_item_costs.raw_material_cost, 0) + COALESCE(NEW.total_cost_per_part, 0),
        total_cost = COALESCE(bom_item_costs.raw_material_cost, 0) + COALESCE(NEW.total_cost_per_part, 0) + COALESCE(bom_item_costs.direct_children_cost, 0),
        unit_cost = COALESCE(bom_item_costs.raw_material_cost, 0) + COALESCE(NEW.total_cost_per_part, 0) + COALESCE(bom_item_costs.direct_children_cost, 0),
        is_stale = false,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. Fix BOM Totals Update Trigger (Defensive version)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_bom_totals_inr()
RETURNS TRIGGER AS $$
DECLARE
    target_bom_id UUID;
BEGIN
    -- Get the bom_id safely
    IF TG_OP = 'DELETE' THEN
        target_bom_id := OLD.bom_id;
    ELSE
        target_bom_id := NEW.bom_id;
    END IF;
    
    -- Skip if bom_id is NULL
    IF target_bom_id IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    
    -- Check if BOM still exists (defensive programming for deletion scenarios)
    IF NOT EXISTS(SELECT 1 FROM boms WHERE id = target_bom_id) THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    
    -- Update BOM totals safely
    UPDATE boms
    SET
        total_material_cost_inr = COALESCE((
            SELECT SUM(COALESCE(bic.raw_material_cost, 0) * COALESCE(bi.quantity, 1))
            FROM bom_items bi
            LEFT JOIN bom_item_costs bic ON bi.id = bic.bom_item_id
            WHERE bi.bom_id = target_bom_id
        ), 0),
        total_process_cost_inr = COALESCE((
            SELECT SUM(COALESCE(bic.process_cost, 0) * COALESCE(bi.quantity, 1))
            FROM bom_items bi
            LEFT JOIN bom_item_costs bic ON bi.id = bic.bom_item_id
            WHERE bi.bom_id = target_bom_id
        ), 0),
        updated_at = NOW()
    WHERE id = target_bom_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. Clean up any existing NULL records
-- ============================================================================
-- Clean up existing NULL records that may have been created by the old triggers
DELETE FROM bom_item_costs WHERE bom_item_id IS NULL;
DELETE FROM production_lot_materials WHERE bom_item_id IS NULL;

-- Add helpful comments
COMMENT ON FUNCTION sync_raw_material_cost_to_bom_item() IS 'Syncs raw material costs to BOM items with deletion safety checks';
COMMENT ON FUNCTION sync_packaging_logistics_cost_to_bom_item() IS 'Syncs packaging costs to BOM items with deletion safety checks';
COMMENT ON FUNCTION sync_procured_parts_cost_to_bom_item() IS 'Syncs procured parts costs to BOM items with deletion safety checks';
COMMENT ON FUNCTION sync_child_part_cost_to_bom_item() IS 'Syncs child part costs to BOM items with deletion safety checks';
COMMENT ON FUNCTION sync_process_cost_to_bom_item() IS 'Syncs process costs to BOM items with deletion safety checks';
COMMENT ON FUNCTION update_bom_totals_inr() IS 'Updates BOM totals with defensive deletion handling';