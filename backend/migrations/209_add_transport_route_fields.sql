-- =====================================================
-- Add Transport and Route Fields to Delivery Orders
-- Fixes missing transport_mode and related columns
-- =====================================================

-- Add transport and route columns to delivery_orders table
DO $$
BEGIN
    -- Add transport_mode column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'transport_mode'
    ) THEN
        ALTER TABLE delivery_orders ADD COLUMN transport_mode VARCHAR(50);
        RAISE NOTICE 'Added transport_mode column to delivery_orders';
    END IF;

    -- Add material_type column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'material_type'
    ) THEN
        ALTER TABLE delivery_orders ADD COLUMN material_type VARCHAR(50);
        RAISE NOTICE 'Added material_type column to delivery_orders';
    END IF;

    -- Add route_type column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'route_type'
    ) THEN
        ALTER TABLE delivery_orders ADD COLUMN route_type VARCHAR(50);
        RAISE NOTICE 'Added route_type column to delivery_orders';
    END IF;

    -- Add route_distance_km column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'route_distance_km'
    ) THEN
        ALTER TABLE delivery_orders ADD COLUMN route_distance_km DECIMAL(10,2);
        RAISE NOTICE 'Added route_distance_km column to delivery_orders';
    END IF;

    -- Add route_travel_time_minutes column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'route_travel_time_minutes'
    ) THEN
        ALTER TABLE delivery_orders ADD COLUMN route_travel_time_minutes INTEGER;
        RAISE NOTICE 'Added route_travel_time_minutes column to delivery_orders';
    END IF;

    -- Add route_data column (for storing complete route information)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'route_data'
    ) THEN
        ALTER TABLE delivery_orders ADD COLUMN route_data JSONB;
        RAISE NOTICE 'Added route_data column to delivery_orders';
    END IF;

    -- Add transport_cost_inr column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'transport_cost_inr'
    ) THEN
        ALTER TABLE delivery_orders ADD COLUMN transport_cost_inr DECIMAL(12,2);
        RAISE NOTICE 'Added transport_cost_inr column to delivery_orders';
    END IF;

    -- Add loading_cost_inr column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'loading_cost_inr'
    ) THEN
        ALTER TABLE delivery_orders ADD COLUMN loading_cost_inr DECIMAL(12,2);
        RAISE NOTICE 'Added loading_cost_inr column to delivery_orders';
    END IF;

    -- Add fuel_toll_cost_inr column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'fuel_toll_cost_inr'
    ) THEN
        ALTER TABLE delivery_orders ADD COLUMN fuel_toll_cost_inr DECIMAL(12,2);
        RAISE NOTICE 'Added fuel_toll_cost_inr column to delivery_orders';
    END IF;

    -- Add cost_breakdown column (for detailed cost information)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'cost_breakdown'
    ) THEN
        ALTER TABLE delivery_orders ADD COLUMN cost_breakdown JSONB;
        RAISE NOTICE 'Added cost_breakdown column to delivery_orders';
    END IF;

    -- Add documentation and quality columns
    -- Add parts_photos column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'parts_photos'
    ) THEN
        ALTER TABLE delivery_orders ADD COLUMN parts_photos JSONB;
        RAISE NOTICE 'Added parts_photos column to delivery_orders';
    END IF;

    -- Add packing_photos column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'packing_photos'
    ) THEN
        ALTER TABLE delivery_orders ADD COLUMN packing_photos JSONB;
        RAISE NOTICE 'Added packing_photos column to delivery_orders';
    END IF;

    -- Add documents column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'documents'
    ) THEN
        ALTER TABLE delivery_orders ADD COLUMN documents JSONB;
        RAISE NOTICE 'Added documents column to delivery_orders';
    END IF;

    -- Add dock_audit column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'dock_audit'
    ) THEN
        ALTER TABLE delivery_orders ADD COLUMN dock_audit JSONB;
        RAISE NOTICE 'Added dock_audit column to delivery_orders';
    END IF;

    -- Add checked_by column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'checked_by'
    ) THEN
        ALTER TABLE delivery_orders ADD COLUMN checked_by VARCHAR(200);
        RAISE NOTICE 'Added checked_by column to delivery_orders';
    END IF;

    -- Add checked_at column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'checked_at'
    ) THEN
        ALTER TABLE delivery_orders ADD COLUMN checked_at TIMESTAMP WITH TIME ZONE;
        RAISE NOTICE 'Added checked_at column to delivery_orders';
    END IF;

END $$;

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_delivery_orders_transport_mode ON delivery_orders(transport_mode);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_material_type ON delivery_orders(material_type);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_route_type ON delivery_orders(route_type);

-- Add comments for documentation
COMMENT ON COLUMN delivery_orders.transport_mode IS 'Mode of transport: road, air, ship';
COMMENT ON COLUMN delivery_orders.material_type IS 'Type of material being transported: box, metal, bulk, fragile';
COMMENT ON COLUMN delivery_orders.route_type IS 'Route optimization preference: fastest, shortest, balanced';
COMMENT ON COLUMN delivery_orders.route_distance_km IS 'Calculated route distance in kilometers';
COMMENT ON COLUMN delivery_orders.route_travel_time_minutes IS 'Estimated travel time in minutes';
COMMENT ON COLUMN delivery_orders.route_data IS 'Complete route information from route calculation service';
COMMENT ON COLUMN delivery_orders.transport_cost_inr IS 'Base transport cost in INR';
COMMENT ON COLUMN delivery_orders.loading_cost_inr IS 'Loading and unloading cost in INR';
COMMENT ON COLUMN delivery_orders.fuel_toll_cost_inr IS 'Fuel and toll charges in INR';
COMMENT ON COLUMN delivery_orders.cost_breakdown IS 'Detailed cost breakdown from route calculation';
COMMENT ON COLUMN delivery_orders.parts_photos IS 'Photos of parts for documentation';
COMMENT ON COLUMN delivery_orders.packing_photos IS 'Photos of packing process';
COMMENT ON COLUMN delivery_orders.documents IS 'Associated documents and files';
COMMENT ON COLUMN delivery_orders.dock_audit IS 'Dock audit checklist data';
COMMENT ON COLUMN delivery_orders.checked_by IS 'Person who performed the final check';
COMMENT ON COLUMN delivery_orders.checked_at IS 'Timestamp of final check';