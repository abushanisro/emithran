-- Delivery Tracking Schema for Supabase
-- Run this in Supabase SQL Editor to create the required tables

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis"; -- For geographical data

-- Create delivery_addresses table (if not exists)
CREATE TABLE IF NOT EXISTS public.delivery_addresses (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    project_id UUID,
    address_type TEXT DEFAULT 'delivery',
    company_name TEXT,
    contact_person TEXT NOT NULL,
    contact_phone TEXT,
    contact_email TEXT,
    street TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT,
    postal_code TEXT NOT NULL,
    country TEXT DEFAULT 'India',
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    special_instructions TEXT,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create carriers table (if not exists)
CREATE TABLE IF NOT EXISTS public.carriers (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    contact_email TEXT,
    contact_phone TEXT,
    tracking_url_template TEXT,
    supported_countries JSONB DEFAULT '["IN"]',
    estimated_delivery_days INTEGER DEFAULT 3,
    cost_per_km DECIMAL(10, 2),
    base_cost DECIMAL(10, 2),
    max_weight_kg DECIMAL(10, 2),
    service_areas JSONB,
    capabilities JSONB,
    performance_metrics JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create delivery_orders table (if not exists)
CREATE TABLE IF NOT EXISTS public.delivery_orders (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    order_number TEXT UNIQUE NOT NULL,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    project_name TEXT,
    inspection_id UUID, -- Reference to inspection if applicable
    status TEXT NOT NULL DEFAULT 'draft',
    priority TEXT NOT NULL DEFAULT 'standard',
    
    -- Dates
    requested_delivery_date TIMESTAMPTZ,
    estimated_delivery_date TIMESTAMPTZ,
    actual_delivery_date TIMESTAMPTZ,
    delivery_window_start TIMESTAMPTZ,
    delivery_window_end TIMESTAMPTZ,
    pickup_date TIMESTAMPTZ,
    
    -- Physical attributes
    total_weight_kg DECIMAL(10, 3),
    total_volume_m3 DECIMAL(10, 3),
    package_count INTEGER DEFAULT 1,
    special_handling_requirements TEXT,
    delivery_instructions TEXT,
    
    -- Costs (in INR)
    delivery_cost_inr DECIMAL(12, 2),
    insurance_cost_inr DECIMAL(12, 2),
    handling_cost_inr DECIMAL(12, 2),
    transport_cost_inr DECIMAL(12, 2),
    loading_cost_inr DECIMAL(12, 2),
    fuel_toll_cost_inr DECIMAL(12, 2),
    total_delivery_cost_inr DECIMAL(12, 2),
    
    -- Carrier and tracking
    carrier_id UUID REFERENCES public.carriers(id),
    tracking_number TEXT,
    carrier_reference TEXT,
    driver_name TEXT,
    driver_phone TEXT,
    vehicle_number TEXT,
    
    -- Addresses
    delivery_address_id UUID REFERENCES public.delivery_addresses(id),
    billing_address_id UUID REFERENCES public.delivery_addresses(id),
    
    -- Route and transport data
    transport_mode TEXT,
    material_type TEXT,
    route_type TEXT,
    route_distance_km DECIMAL(10, 2),
    route_travel_time_minutes INTEGER,
    route_data JSONB,
    cost_breakdown JSONB,
    
    -- Items and audit data
    items JSONB NOT NULL DEFAULT '[]',
    items_count INTEGER DEFAULT 0,
    total_quantity INTEGER DEFAULT 0,
    dock_audit JSONB,
    
    -- Documentation
    parts_photos JSONB,
    packing_photos JSONB,
    documents JSONB,
    
    -- Audit fields
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    checked_by TEXT,
    checked_at TIMESTAMPTZ,
    last_location_update TIMESTAMPTZ,
    
    -- Constraints
    CONSTRAINT valid_status CHECK (status IN ('draft', 'pending_approval', 'approved', 'in_transit', 'out_for_delivery', 'delivered', 'failed_delivery', 'returned', 'cancelled')),
    CONSTRAINT valid_priority CHECK (priority IN ('low', 'standard', 'high', 'urgent')),
    CONSTRAINT valid_transport_mode CHECK (transport_mode IS NULL OR transport_mode IN ('car', 'truck', 'bike', 'air', 'rail', 'sea')),
    CONSTRAINT positive_costs CHECK (
        (delivery_cost_inr IS NULL OR delivery_cost_inr >= 0) AND
        (insurance_cost_inr IS NULL OR insurance_cost_inr >= 0) AND
        (handling_cost_inr IS NULL OR handling_cost_inr >= 0) AND
        (total_delivery_cost_inr IS NULL OR total_delivery_cost_inr >= 0)
    )
);

-- Create delivery_tracking table for real-time location updates
CREATE TABLE IF NOT EXISTS public.delivery_tracking (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    delivery_order_id UUID REFERENCES public.delivery_orders(id) ON DELETE CASCADE,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    address TEXT,
    status TEXT NOT NULL,
    notes TEXT,
    event_timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_coordinates CHECK (
        latitude BETWEEN -90 AND 90 AND 
        longitude BETWEEN -180 AND 180
    )
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_delivery_orders_project_id ON public.delivery_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_status ON public.delivery_orders(status);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_priority ON public.delivery_orders(priority);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_created_at ON public.delivery_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_delivery_date ON public.delivery_orders(estimated_delivery_date);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_tracking_number ON public.delivery_orders(tracking_number);

CREATE INDEX IF NOT EXISTS idx_delivery_tracking_order_id ON public.delivery_tracking(delivery_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_timestamp ON public.delivery_tracking(event_timestamp);

CREATE INDEX IF NOT EXISTS idx_delivery_addresses_project_id ON public.delivery_addresses(project_id);
CREATE INDEX IF NOT EXISTS idx_delivery_addresses_active ON public.delivery_addresses(is_active);

CREATE INDEX IF NOT EXISTS idx_carriers_code ON public.carriers(code);
CREATE INDEX IF NOT EXISTS idx_carriers_active ON public.carriers(is_active);

-- Create updated_at trigger function if not exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_delivery_orders_updated_at ON public.delivery_orders;
CREATE TRIGGER update_delivery_orders_updated_at
    BEFORE UPDATE ON public.delivery_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_delivery_addresses_updated_at ON public.delivery_addresses;
CREATE TRIGGER update_delivery_addresses_updated_at
    BEFORE UPDATE ON public.delivery_addresses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_carriers_updated_at ON public.carriers;
CREATE TRIGGER update_carriers_updated_at
    BEFORE UPDATE ON public.carriers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create RLS policies (adjust based on your auth setup)
ALTER TABLE public.delivery_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carriers ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies (customize based on your auth requirements)
CREATE POLICY "Users can view delivery orders for their projects"
    ON public.delivery_orders FOR SELECT
    USING (true); -- Adjust based on your auth logic

CREATE POLICY "Users can insert delivery orders for their projects"
    ON public.delivery_orders FOR INSERT
    WITH CHECK (true); -- Adjust based on your auth logic

CREATE POLICY "Users can update delivery orders for their projects"
    ON public.delivery_orders FOR UPDATE
    USING (true); -- Adjust based on your auth logic

CREATE POLICY "Users can view delivery tracking"
    ON public.delivery_tracking FOR SELECT
    USING (true); -- Adjust based on your auth logic

CREATE POLICY "Users can insert delivery tracking"
    ON public.delivery_tracking FOR INSERT
    WITH CHECK (true); -- Adjust based on your auth logic

-- Insert default carriers
INSERT INTO public.carriers (name, code, contact_email, contact_phone, tracking_url_template, supported_countries, estimated_delivery_days, is_active)
VALUES 
    ('Delhivery', 'delhivery', 'support@delhivery.com', '+91-11-4757-4777', 'https://www.delhivery.com/track/package/${trackingNumber}', '["IN"]', 3, true),
    ('DTDC', 'dtdc', 'customercare@dtdc.in', '+91-11-4040-3000', 'https://www.dtdc.in/trace.asp?id=${trackingNumber}', '["IN"]', 4, true),
    ('Blue Dart', 'bluedart', 'care@bluedart.com', '+91-22-2829-4444', 'https://www.bluedart.com/tracking?trackFor=${trackingNumber}', '["IN"]', 2, true),
    ('FedEx', 'fedex', 'customercare@fedex.com', '+91-22-6126-6126', 'https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}', '["US", "IN", "GB", "DE", "FR", "CA"]', 3, true),
    ('DHL', 'dhl', 'customer.service@dhl.com', '+91-124-4567-555', 'https://www.dhl.com/en/express/tracking.html?brand=DHL&AWB=${trackingNumber}', '["US", "IN", "GB", "DE", "FR", "CA", "AU"]', 4, true)
ON CONFLICT (code) DO NOTHING;

-- Create view for delivery orders with tracking data
CREATE OR REPLACE VIEW public.delivery_orders_with_tracking AS
SELECT 
    delivery_order.*,
    da.company_name as delivery_company_name,
    da.contact_person as delivery_contact_person,
    da.contact_phone as delivery_contact_phone,
    da.street as delivery_street,
    da.city as delivery_city,
    da.state as delivery_state,
    da.country as delivery_country,
    da.postal_code as delivery_postal_code,
    da.latitude as delivery_latitude,
    da.longitude as delivery_longitude,
    c.name as carrier_name,
    c.code as carrier_code,
    c.contact_phone as carrier_contact_phone,
    c.tracking_url_template,
    COALESCE(
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'lat', dt.latitude,
                    'lng', dt.longitude,
                    'timestamp', dt.event_timestamp,
                    'address', dt.address,
                    'status', dt.status,
                    'notes', dt.notes
                )
                ORDER BY dt.event_timestamp DESC
            )
            FROM public.delivery_tracking dt 
            WHERE dt.delivery_order_id = delivery_order.id
        ), 
        '[]'::jsonb
    ) as tracking_data,
    (
        SELECT jsonb_build_object(
            'latitude', dt.latitude,
            'longitude', dt.longitude,
            'timestamp', dt.event_timestamp,
            'status', dt.status
        )
        FROM public.delivery_tracking dt 
        WHERE dt.delivery_order_id = delivery_order.id
        ORDER BY dt.event_timestamp DESC
        LIMIT 1
    ) as current_location
FROM public.delivery_orders delivery_order
LEFT JOIN public.delivery_addresses da ON delivery_order.delivery_address_id = da.id
LEFT JOIN public.carriers c ON delivery_order.carrier_id = c.id;

-- Grant permissions (adjust based on your needs)
GRANT SELECT, INSERT, UPDATE ON public.delivery_orders TO authenticated;
GRANT SELECT, INSERT ON public.delivery_tracking TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.delivery_addresses TO authenticated;
GRANT SELECT ON public.carriers TO authenticated;
GRANT SELECT ON public.delivery_orders_with_tracking TO authenticated;

-- Grant usage on sequences
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;