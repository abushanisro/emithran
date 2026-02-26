-- COMPREHENSIVE FIX: Run this SQL to fix ALL cost sync trigger issues

-- ============================================================================
-- OPTION 1: DISABLE ALL PROBLEMATIC TRIGGERS (Quick Fix)
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_sync_raw_material_cost ON raw_material_cost_records;
DROP TRIGGER IF EXISTS trigger_sync_packaging_logistics_cost ON packaging_logistics_cost_records;
DROP TRIGGER IF EXISTS trigger_sync_procured_parts_cost ON procured_parts_cost_records;

-- ============================================================================
-- OPTION 2: RECREATE FIXED TRIGGER FUNCTIONS (Complete Fix)
-- ============================================================================

-- 1. Fix Raw Material Cost Sync
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
        raw_material_cost
    )
    VALUES (
        NEW.bom_item_id,
        NEW.user_id,
        v_aggregated_cost
    )
    ON CONFLICT (bom_item_id, user_id)
    DO UPDATE SET
        raw_material_cost = v_aggregated_cost,
        is_stale = false,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Fix Packaging/Logistics Cost Sync
CREATE OR REPLACE FUNCTION sync_packaging_logistics_cost_to_bom_item()
RETURNS TRIGGER AS $$
DECLARE
    v_aggregated_cost DECIMAL(15, 4);
BEGIN
    -- Aggregate all active packaging/logistics costs for this bom_item
    SELECT COALESCE(SUM(total_cost), 0)
    INTO v_aggregated_cost
    FROM packaging_logistics_cost_records
    WHERE bom_item_id = NEW.bom_item_id
      AND user_id = NEW.user_id
      AND is_active = true;

    -- Update or insert the bom_item_cost record
    INSERT INTO bom_item_costs (
        bom_item_id,
        user_id,
        packaging_logistics_cost
    )
    VALUES (
        NEW.bom_item_id,
        NEW.user_id,
        v_aggregated_cost
    )
    ON CONFLICT (bom_item_id, user_id)
    DO UPDATE SET
        packaging_logistics_cost = v_aggregated_cost,
        is_stale = false,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Fix Procured Parts Cost Sync
CREATE OR REPLACE FUNCTION sync_procured_parts_cost_to_bom_item()
RETURNS TRIGGER AS $$
DECLARE
    v_aggregated_cost DECIMAL(15, 4);
BEGIN
    -- Aggregate all active procured parts costs for this bom_item
    SELECT COALESCE(SUM(total_cost), 0)
    INTO v_aggregated_cost
    FROM procured_parts_cost_records
    WHERE bom_item_id = NEW.bom_item_id
      AND user_id = NEW.user_id
      AND is_active = true;

    -- Update or insert the bom_item_cost record
    INSERT INTO bom_item_costs (
        bom_item_id,
        user_id,
        procured_parts_cost
    )
    VALUES (
        NEW.bom_item_id,
        NEW.user_id,
        v_aggregated_cost
    )
    ON CONFLICT (bom_item_id, user_id)
    DO UPDATE SET
        procured_parts_cost = v_aggregated_cost,
        is_stale = false,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- RECREATE TRIGGERS (Only if you want to keep sync functionality)
-- ============================================================================

CREATE TRIGGER trigger_sync_raw_material_cost
    AFTER INSERT OR UPDATE ON raw_material_cost_records
    FOR EACH ROW
    EXECUTE FUNCTION sync_raw_material_cost_to_bom_item();

CREATE TRIGGER trigger_sync_packaging_logistics_cost
    AFTER INSERT OR UPDATE ON packaging_logistics_cost_records
    FOR EACH ROW
    EXECUTE FUNCTION sync_packaging_logistics_cost_to_bom_item();

CREATE TRIGGER trigger_sync_procured_parts_cost
    AFTER INSERT OR UPDATE ON procured_parts_cost_records
    FOR EACH ROW
    EXECUTE FUNCTION sync_procured_parts_cost_to_bom_item();