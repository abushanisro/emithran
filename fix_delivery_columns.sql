-- Fix missing delivery_orders columns
-- This ensures the transport mode, material type and other workflow data columns exist

DO $$
BEGIN
    -- Add transport and route columns if they don't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'transport_mode') THEN
        ALTER TABLE delivery_orders ADD COLUMN transport_mode VARCHAR(100);
        RAISE NOTICE 'Added transport_mode column';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'material_type') THEN
        ALTER TABLE delivery_orders ADD COLUMN material_type VARCHAR(100);
        RAISE NOTICE 'Added material_type column';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'route_type') THEN
        ALTER TABLE delivery_orders ADD COLUMN route_type VARCHAR(50);
        RAISE NOTICE 'Added route_type column';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'route_distance_km') THEN
        ALTER TABLE delivery_orders ADD COLUMN route_distance_km DECIMAL(10,2);
        RAISE NOTICE 'Added route_distance_km column';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'route_travel_time_minutes') THEN
        ALTER TABLE delivery_orders ADD COLUMN route_travel_time_minutes INTEGER;
        RAISE NOTICE 'Added route_travel_time_minutes column';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'route_data') THEN
        ALTER TABLE delivery_orders ADD COLUMN route_data JSONB;
        RAISE NOTICE 'Added route_data column';
    END IF;
    
    -- Add cost breakdown columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'transport_cost_inr') THEN
        ALTER TABLE delivery_orders ADD COLUMN transport_cost_inr DECIMAL(10,2);
        RAISE NOTICE 'Added transport_cost_inr column';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'loading_cost_inr') THEN
        ALTER TABLE delivery_orders ADD COLUMN loading_cost_inr DECIMAL(10,2);
        RAISE NOTICE 'Added loading_cost_inr column';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'fuel_toll_cost_inr') THEN
        ALTER TABLE delivery_orders ADD COLUMN fuel_toll_cost_inr DECIMAL(10,2);
        RAISE NOTICE 'Added fuel_toll_cost_inr column';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'cost_breakdown') THEN
        ALTER TABLE delivery_orders ADD COLUMN cost_breakdown JSONB;
        RAISE NOTICE 'Added cost_breakdown column';
    END IF;
    
    -- Add documentation columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'parts_photos') THEN
        ALTER TABLE delivery_orders ADD COLUMN parts_photos JSONB;
        RAISE NOTICE 'Added parts_photos column';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'packing_photos') THEN
        ALTER TABLE delivery_orders ADD COLUMN packing_photos JSONB;
        RAISE NOTICE 'Added packing_photos column';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'documents') THEN
        ALTER TABLE delivery_orders ADD COLUMN documents JSONB;
        RAISE NOTICE 'Added documents column';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'dock_audit') THEN
        ALTER TABLE delivery_orders ADD COLUMN dock_audit JSONB;
        RAISE NOTICE 'Added dock_audit column';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'checked_by') THEN
        ALTER TABLE delivery_orders ADD COLUMN checked_by VARCHAR(255);
        RAISE NOTICE 'Added checked_by column';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'checked_at') THEN
        ALTER TABLE delivery_orders ADD COLUMN checked_at TIMESTAMP;
        RAISE NOTICE 'Added checked_at column';
    END IF;
    
    -- Add estimated_delivery_date if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_orders' AND column_name = 'estimated_delivery_date') THEN
        ALTER TABLE delivery_orders ADD COLUMN estimated_delivery_date TIMESTAMP;
        RAISE NOTICE 'Added estimated_delivery_date column';
    END IF;
    
    RAISE NOTICE 'All delivery_orders columns have been verified/added successfully!';
END $$;