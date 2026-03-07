-- Migration: Add tooling cost to bom_item_costs table
-- Description: Add tooling_cost field and update cost calculations to include tooling
-- Author: Manufacturing Cost Engineering Team
-- Version: 1.0.0
-- Date: 2026-03-07

-- Add tooling_cost column if it doesn't exist
DO $$
BEGIN
    -- Add tooling_cost column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bom_item_costs'
        AND column_name = 'tooling_cost'
    ) THEN
        ALTER TABLE bom_item_costs
        ADD COLUMN tooling_cost DECIMAL(15,4) DEFAULT 0 CHECK (tooling_cost >= 0);

        RAISE NOTICE 'Added tooling_cost column to bom_item_costs';
    END IF;
END $$;

-- Create function to sync tooling costs to BOM items
CREATE OR REPLACE FUNCTION sync_tooling_cost_to_bom_item()
RETURNS TRIGGER AS $$
BEGIN
    -- Handle INSERT and UPDATE
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        -- Calculate total tooling cost for this BOM item
        INSERT INTO bom_item_costs (
            bom_item_id, 
            user_id, 
            tooling_cost,
            own_cost, 
            total_cost, 
            unit_cost
        ) 
        VALUES (
            NEW.bom_item_id, 
            NEW.user_id, 
            COALESCE(NEW.total_cost, 0),
            COALESCE(NEW.total_cost, 0),
            COALESCE(NEW.total_cost, 0),
            COALESCE(NEW.total_cost, 0)
        )
        ON CONFLICT (bom_item_id) DO UPDATE SET
            tooling_cost = (
                SELECT COALESCE(SUM(total_cost), 0)
                FROM tooling_cost_records 
                WHERE bom_item_id = NEW.bom_item_id 
                AND user_id = NEW.user_id 
                AND is_active = true
            ),
            own_cost = COALESCE(bom_item_costs.raw_material_cost, 0) + 
                      COALESCE(bom_item_costs.process_cost, 0) + 
                      (SELECT COALESCE(SUM(total_cost), 0)
                       FROM tooling_cost_records 
                       WHERE bom_item_id = NEW.bom_item_id 
                       AND user_id = NEW.user_id 
                       AND is_active = true),
            total_cost = COALESCE(bom_item_costs.raw_material_cost, 0) + 
                        COALESCE(bom_item_costs.process_cost, 0) + 
                        (SELECT COALESCE(SUM(total_cost), 0)
                         FROM tooling_cost_records 
                         WHERE bom_item_id = NEW.bom_item_id 
                         AND user_id = NEW.user_id 
                         AND is_active = true) + 
                        COALESCE(bom_item_costs.direct_children_cost, 0),
            unit_cost = COALESCE(bom_item_costs.raw_material_cost, 0) + 
                       COALESCE(bom_item_costs.process_cost, 0) + 
                       (SELECT COALESCE(SUM(total_cost), 0)
                        FROM tooling_cost_records 
                        WHERE bom_item_id = NEW.bom_item_id 
                        AND user_id = NEW.user_id 
                        AND is_active = true) + 
                       COALESCE(bom_item_costs.direct_children_cost, 0),
            is_stale = false,
            updated_at = NOW();

        RETURN NEW;
    END IF;

    -- Handle DELETE
    IF TG_OP = 'DELETE' THEN
        -- Recalculate costs after deletion
        UPDATE bom_item_costs SET
            tooling_cost = (
                SELECT COALESCE(SUM(total_cost), 0)
                FROM tooling_cost_records 
                WHERE bom_item_id = OLD.bom_item_id 
                AND user_id = OLD.user_id 
                AND is_active = true
            ),
            own_cost = COALESCE(raw_material_cost, 0) + 
                      COALESCE(process_cost, 0) + 
                      (SELECT COALESCE(SUM(total_cost), 0)
                       FROM tooling_cost_records 
                       WHERE bom_item_id = OLD.bom_item_id 
                       AND user_id = OLD.user_id 
                       AND is_active = true),
            total_cost = COALESCE(raw_material_cost, 0) + 
                        COALESCE(process_cost, 0) + 
                        (SELECT COALESCE(SUM(total_cost), 0)
                         FROM tooling_cost_records 
                         WHERE bom_item_id = OLD.bom_item_id 
                         AND user_id = OLD.user_id 
                         AND is_active = true) + 
                        COALESCE(direct_children_cost, 0),
            unit_cost = COALESCE(raw_material_cost, 0) + 
                       COALESCE(process_cost, 0) + 
                       (SELECT COALESCE(SUM(total_cost), 0)
                        FROM tooling_cost_records 
                        WHERE bom_item_id = OLD.bom_item_id 
                        AND user_id = OLD.user_id 
                        AND is_active = true) + 
                       COALESCE(direct_children_cost, 0),
            is_stale = false,
            updated_at = NOW()
        WHERE bom_item_id = OLD.bom_item_id;

        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_sync_tooling_cost_to_bom_item ON tooling_cost_records;

-- Create trigger for tooling cost sync
CREATE TRIGGER trigger_sync_tooling_cost_to_bom_item
    AFTER INSERT OR UPDATE OR DELETE ON tooling_cost_records
    FOR EACH ROW
    EXECUTE FUNCTION sync_tooling_cost_to_bom_item();

-- Update existing cost calculations to include tooling costs
UPDATE bom_item_costs SET 
    tooling_cost = COALESCE((
        SELECT SUM(total_cost)
        FROM tooling_cost_records tcr
        WHERE tcr.bom_item_id = bom_item_costs.bom_item_id 
        AND tcr.user_id = bom_item_costs.user_id 
        AND tcr.is_active = true
    ), 0),
    own_cost = COALESCE(raw_material_cost, 0) + 
              COALESCE(process_cost, 0) + 
              COALESCE((
                  SELECT SUM(total_cost)
                  FROM tooling_cost_records tcr
                  WHERE tcr.bom_item_id = bom_item_costs.bom_item_id 
                  AND tcr.user_id = bom_item_costs.user_id 
                  AND tcr.is_active = true
              ), 0),
    total_cost = COALESCE(raw_material_cost, 0) + 
                COALESCE(process_cost, 0) + 
                COALESCE((
                    SELECT SUM(total_cost)
                    FROM tooling_cost_records tcr
                    WHERE tcr.bom_item_id = bom_item_costs.bom_item_id 
                    AND tcr.user_id = bom_item_costs.user_id 
                    AND tcr.is_active = true
                ), 0) + 
                COALESCE(direct_children_cost, 0),
    unit_cost = COALESCE(raw_material_cost, 0) + 
               COALESCE(process_cost, 0) + 
               COALESCE((
                   SELECT SUM(total_cost)
                   FROM tooling_cost_records tcr
                   WHERE tcr.bom_item_id = bom_item_costs.bom_item_id 
                   AND tcr.user_id = bom_item_costs.user_id 
                   AND tcr.is_active = true
               ), 0) + 
               COALESCE(direct_children_cost, 0),
    updated_at = NOW()
WHERE EXISTS (
    SELECT 1 FROM tooling_cost_records tcr
    WHERE tcr.bom_item_id = bom_item_costs.bom_item_id 
    AND tcr.user_id = bom_item_costs.user_id 
    AND tcr.is_active = true
);

-- Add comments for documentation
COMMENT ON COLUMN bom_item_costs.tooling_cost IS 'Total tooling and fixture costs for this BOM item (INR)';
COMMENT ON FUNCTION sync_tooling_cost_to_bom_item() IS 'Syncs tooling costs to BOM item cost aggregation table';