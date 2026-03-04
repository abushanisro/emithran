-- Add missing inspection_id column to delivery_orders table
-- This fixes the schema cache error when creating delivery orders

DO $$
BEGIN
    -- Check if the column already exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_orders' 
        AND column_name = 'inspection_id'
    ) THEN
        -- Add the inspection_id column
        ALTER TABLE delivery_orders 
        ADD COLUMN inspection_id UUID;
        
        RAISE NOTICE 'Added inspection_id column to delivery_orders table';
    ELSE
        RAISE NOTICE 'inspection_id column already exists in delivery_orders table';
    END IF;
END $$;