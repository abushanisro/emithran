-- =====================================================
-- Critical Delivery Schema Fixes - Principal Engineer Solution
-- Fixes missing columns and relationship conflicts
-- =====================================================

-- Step 1: Fix delivery_items table structure
DO $$
BEGIN
    -- Check if delivery_items table exists, create if not
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_items') THEN
        CREATE TABLE delivery_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            delivery_order_id UUID NOT NULL,
            quality_approved_item_id UUID NOT NULL,
            bom_item_id UUID NOT NULL,
            approved_quantity INTEGER NOT NULL,
            delivery_quantity INTEGER NOT NULL,
            unit_weight_kg DECIMAL(10,3),
            unit_dimensions_cm VARCHAR(100),
            packaging_type VARCHAR(100),
            packaging_instructions TEXT,
            hazmat_classification VARCHAR(50),
            qc_certificate_number VARCHAR(100),
            batch_number VARCHAR(100),
            serial_numbers TEXT[],
            unit_value_inr DECIMAL(12,2),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        RAISE NOTICE 'Created delivery_items table';
    ELSE
        -- Add missing columns to existing table
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'delivery_items' 
            AND column_name = 'quality_approved_item_id'
        ) THEN
            ALTER TABLE delivery_items ADD COLUMN quality_approved_item_id UUID NOT NULL;
            RAISE NOTICE 'Added quality_approved_item_id column to delivery_items';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'delivery_items' 
            AND column_name = 'bom_item_id'
        ) THEN
            ALTER TABLE delivery_items ADD COLUMN bom_item_id UUID NOT NULL;
            RAISE NOTICE 'Added bom_item_id column to delivery_items';
        END IF;
    END IF;
END $$;

-- Step 2: Fix delivery_orders table structure
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_orders') THEN
        CREATE TABLE delivery_orders (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            order_number VARCHAR(100) UNIQUE NOT NULL,
            project_id UUID NOT NULL,
            inspection_id UUID,
            delivery_address_id UUID NOT NULL,
            billing_address_id UUID,
            carrier_id UUID,
            status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'in_transit', 'out_for_delivery', 'delivered', 'failed_delivery', 'returned', 'cancelled')),
            priority VARCHAR(20) DEFAULT 'standard' CHECK (priority IN ('low', 'standard', 'high', 'urgent')),
            requested_delivery_date TIMESTAMP WITH TIME ZONE,
            estimated_delivery_date TIMESTAMP WITH TIME ZONE,
            actual_delivery_date TIMESTAMP WITH TIME ZONE,
            delivery_window_start TIME,
            delivery_window_end TIME,
            total_weight_kg DECIMAL(10,3),
            total_volume_m3 DECIMAL(10,3),
            package_count INTEGER DEFAULT 1,
            special_handling_requirements TEXT,
            delivery_instructions TEXT,
            delivery_cost_inr DECIMAL(12,2),
            insurance_cost_inr DECIMAL(12,2),
            handling_cost_inr DECIMAL(12,2),
            total_delivery_cost_inr DECIMAL(12,2),
            tracking_number VARCHAR(100),
            carrier_reference VARCHAR(100),
            pickup_date TIMESTAMP WITH TIME ZONE,
            notes TEXT,
            created_by VARCHAR(100) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            approved_by VARCHAR(100),
            approved_at TIMESTAMP WITH TIME ZONE
        );
        
        RAISE NOTICE 'Created delivery_orders table';
    END IF;
END $$;

-- Step 3: Fix delivery_addresses table structure
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_addresses') THEN
        CREATE TABLE delivery_addresses (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID NOT NULL,
            address_type VARCHAR(50) DEFAULT 'shipping',
            company_name VARCHAR(200),
            contact_person VARCHAR(200) NOT NULL,
            contact_phone VARCHAR(50),
            contact_email VARCHAR(100),
            address_line1 VARCHAR(500) NOT NULL,
            address_line2 VARCHAR(500),
            city VARCHAR(200) NOT NULL,
            state_province VARCHAR(200),
            postal_code VARCHAR(50) NOT NULL,
            country VARCHAR(100) DEFAULT 'India',
            latitude DECIMAL(10,8),
            longitude DECIMAL(11,8),
            special_instructions TEXT,
            is_default BOOLEAN DEFAULT false,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        RAISE NOTICE 'Created delivery_addresses table';
    END IF;
END $$;

-- Step 4: Create foreign key constraints (with proper naming to fix relationship conflicts)
DO $$
BEGIN
    -- Add foreign key for delivery_orders -> delivery_addresses (delivery address)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_delivery_orders_delivery_address'
    ) THEN
        ALTER TABLE delivery_orders 
        ADD CONSTRAINT fk_delivery_orders_delivery_address 
        FOREIGN KEY (delivery_address_id) REFERENCES delivery_addresses(id);
        
        RAISE NOTICE 'Added delivery address foreign key constraint';
    END IF;

    -- Add foreign key for delivery_orders -> delivery_addresses (billing address)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_delivery_orders_billing_address'
    ) THEN
        ALTER TABLE delivery_orders 
        ADD CONSTRAINT fk_delivery_orders_billing_address 
        FOREIGN KEY (billing_address_id) REFERENCES delivery_addresses(id);
        
        RAISE NOTICE 'Added billing address foreign key constraint';
    END IF;

    -- Add foreign key for delivery_items -> delivery_orders
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_delivery_items_delivery_order'
    ) THEN
        ALTER TABLE delivery_items 
        ADD CONSTRAINT fk_delivery_items_delivery_order 
        FOREIGN KEY (delivery_order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE;
        
        RAISE NOTICE 'Added delivery items foreign key constraint';
    END IF;

    -- Add foreign key for delivery_items -> quality_approved_items
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_delivery_items_quality_approved'
    ) THEN
        ALTER TABLE delivery_items 
        ADD CONSTRAINT fk_delivery_items_quality_approved 
        FOREIGN KEY (quality_approved_item_id) REFERENCES quality_approved_items(id);
        
        RAISE NOTICE 'Added quality approved items foreign key constraint';
    END IF;
END $$;

-- Step 5: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_delivery_orders_project_id ON delivery_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_status ON delivery_orders(status);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_tracking_number ON delivery_orders(tracking_number);
CREATE INDEX IF NOT EXISTS idx_delivery_items_delivery_order_id ON delivery_items(delivery_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_items_quality_approved_item_id ON delivery_items(quality_approved_item_id);
CREATE INDEX IF NOT EXISTS idx_delivery_addresses_project_id ON delivery_addresses(project_id);

-- Step 6: Create updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
DROP TRIGGER IF EXISTS update_delivery_orders_updated_at ON delivery_orders;
CREATE TRIGGER update_delivery_orders_updated_at 
    BEFORE UPDATE ON delivery_orders 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_delivery_items_updated_at ON delivery_items;
CREATE TRIGGER update_delivery_items_updated_at 
    BEFORE UPDATE ON delivery_items 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_delivery_addresses_updated_at ON delivery_addresses;
CREATE TRIGGER update_delivery_addresses_updated_at 
    BEFORE UPDATE ON delivery_addresses 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Step 7: Add comments for documentation
COMMENT ON TABLE delivery_orders IS 'Main delivery orders table with proper foreign key relationships';
COMMENT ON TABLE delivery_items IS 'Items within delivery orders, linked to quality approved items';
COMMENT ON TABLE delivery_addresses IS 'Delivery and billing addresses for projects';

COMMENT ON COLUMN delivery_orders.delivery_address_id IS 'Reference to delivery address';
COMMENT ON COLUMN delivery_orders.billing_address_id IS 'Reference to billing address (optional, can be same as delivery)';
COMMENT ON COLUMN delivery_items.quality_approved_item_id IS 'Reference to quality approved item from QC module';
COMMENT ON COLUMN delivery_items.bom_item_id IS 'Direct reference to BOM item for easier queries';

RAISE NOTICE 'Delivery schema migration completed successfully';