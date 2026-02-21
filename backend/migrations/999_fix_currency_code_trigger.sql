-- ============================================================================
-- Migration: Fix Currency Code Trigger Issue
-- Purpose: Fix trigger that references non-existent currency_code field
-- Author: System Maintenance
-- Date: 2026-02-21
-- Version: 1.0.0
-- ============================================================================

-- Problem: The sync_raw_material_cost_to_bom_item trigger is trying to access
-- NEW.currency_code which doesn't exist in the raw_material_cost_records table

-- ============================================================================
-- 1. UPDATE RAW MATERIAL COST SYNC TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_raw_material_cost_to_bom_item()
RETURNS TRIGGER AS $$
DECLARE
    v_aggregated_cost DECIMAL(15, 4);
BEGIN
    -- Aggregate all active raw material costs for this bom_item
    SELECT COALESCE(SUM(total_cost), 0)
    INTO v_aggregated_cost
    FROM raw_material_cost_records
    WHERE bom_item_id = NEW.bom_item_id
      AND user_id = NEW.user_id
      AND is_active = true;

    -- Update or insert the bom_item_cost record
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
        v_aggregated_cost,
        v_aggregated_cost,
        v_aggregated_cost,
        v_aggregated_cost
    )
    ON CONFLICT (bom_item_id, user_id)
    DO UPDATE SET
        raw_material_cost = v_aggregated_cost,
        own_cost = (
            v_aggregated_cost +
            bom_item_costs.process_cost +
            bom_item_costs.packaging_logistics_cost +
            bom_item_costs.procured_parts_cost
        ),
        total_cost = (
            v_aggregated_cost +
            bom_item_costs.process_cost +
            bom_item_costs.packaging_logistics_cost +
            bom_item_costs.procured_parts_cost +
            bom_item_costs.direct_children_cost
        ),
        unit_cost = (
            v_aggregated_cost +
            bom_item_costs.process_cost +
            bom_item_costs.packaging_logistics_cost +
            bom_item_costs.procured_parts_cost +
            bom_item_costs.direct_children_cost
        ),
        is_stale = false,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. RECREATE THE TRIGGER
-- ============================================================================

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_sync_raw_material_cost ON raw_material_cost_records;

-- Create trigger
CREATE TRIGGER trigger_sync_raw_material_cost
    AFTER INSERT OR UPDATE ON raw_material_cost_records
    FOR EACH ROW
    EXECUTE FUNCTION sync_raw_material_cost_to_bom_item();

-- ============================================================================
-- MIGRATION COMPLETED
-- ============================================================================

COMMENT ON FUNCTION sync_raw_material_cost_to_bom_item IS 'Fixed: Removes currency_code reference that caused trigger failures';