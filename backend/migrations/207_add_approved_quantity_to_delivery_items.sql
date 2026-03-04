-- Add missing approved_quantity column to delivery_items table
-- This fixes the schema cache error when creating delivery items

DO $$
BEGIN
    -- Check if the column already exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_items' 
        AND column_name = 'approved_quantity'
    ) THEN
        -- Add the approved_quantity column
        ALTER TABLE delivery_items 
        ADD COLUMN approved_quantity INTEGER NOT NULL DEFAULT 0;
        
        RAISE NOTICE 'Added approved_quantity column to delivery_items table';
    ELSE
        RAISE NOTICE 'approved_quantity column already exists in delivery_items table';
    END IF;
END $$;