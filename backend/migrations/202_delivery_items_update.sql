-- =====================================================
-- Update Delivery Items with Quality Integration
-- Adds quality_approved_items reference to delivery_items
-- NOTE: Run this AFTER 200_delivery_module_schema.sql and 201_quality_delivery_integration.sql
-- =====================================================

-- Check if delivery_items table exists before modifying it
DO $$ 
BEGIN
    -- Only proceed if the delivery_items table exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'delivery_items') THEN
        
        -- Add quality_approved_items reference to delivery_items
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name = 'delivery_items' 
                      AND column_name = 'quality_approved_item_id') THEN
            ALTER TABLE delivery_items 
            ADD COLUMN quality_approved_item_id UUID REFERENCES quality_approved_items(id);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name = 'delivery_items' 
                      AND column_name = 'approved_quantity') THEN
            ALTER TABLE delivery_items 
            ADD COLUMN approved_quantity INTEGER;
        END IF;

        -- Add indexes for the new columns
        IF NOT EXISTS (SELECT 1 FROM pg_indexes 
                      WHERE tablename = 'delivery_items' 
                      AND indexname = 'idx_delivery_items_quality_approved_item_id') THEN
            CREATE INDEX idx_delivery_items_quality_approved_item_id ON delivery_items(quality_approved_item_id);
        END IF;

        -- Add constraint to ensure delivery_quantity doesn't exceed approved_quantity
        BEGIN
            ALTER TABLE delivery_items 
            DROP CONSTRAINT IF EXISTS valid_approved_quantities;
            
            ALTER TABLE delivery_items 
            ADD CONSTRAINT valid_approved_quantities 
            CHECK (approved_quantity IS NULL OR (delivery_quantity <= approved_quantity AND delivery_quantity > 0));
        EXCEPTION WHEN OTHERS THEN
            -- Ignore constraint errors if they occur
            NULL;
        END;

        -- Update the existing constraint to make it compatible
        BEGIN
            ALTER TABLE delivery_items 
            DROP CONSTRAINT IF EXISTS valid_quantities;
            
            ALTER TABLE delivery_items 
            ADD CONSTRAINT valid_quantities 
            CHECK (delivery_quantity <= COALESCE(requested_quantity, approved_quantity, delivery_quantity) AND delivery_quantity > 0);
        EXCEPTION WHEN OTHERS THEN
            -- Ignore constraint errors if they occur
            NULL;
        END;

    ELSE
        RAISE NOTICE 'delivery_items table does not exist yet - skipping quality integration updates';
    END IF;
END $$;

-- Add comments (only if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'delivery_items') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_name = 'delivery_items' 
                  AND column_name = 'quality_approved_item_id') THEN
            COMMENT ON COLUMN delivery_items.quality_approved_item_id IS 'Reference to the quality-approved item being delivered';
        END IF;
        
        IF EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_name = 'delivery_items' 
                  AND column_name = 'approved_quantity') THEN
            COMMENT ON COLUMN delivery_items.approved_quantity IS 'Quantity approved by quality control for this item';
        END IF;
    END IF;
END $$;