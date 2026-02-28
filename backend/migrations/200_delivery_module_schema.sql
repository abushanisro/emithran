-- =====================================================
-- Delivery Module Database Schema
-- Production-Ready Implementation
-- =====================================================

-- Enable UUID extension if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Delivery status enum
CREATE TYPE delivery_status AS ENUM (
  'draft',
  'pending_approval',
  'approved', 
  'in_transit',
  'out_for_delivery',
  'delivered',
  'failed_delivery',
  'returned',
  'cancelled'
);

-- Delivery priority enum
CREATE TYPE delivery_priority AS ENUM (
  'low',
  'standard', 
  'high',
  'urgent'
);

-- Invoice status enum
CREATE TYPE invoice_status AS ENUM (
  'draft',
  'pending',
  'sent',
  'paid',
  'overdue',
  'cancelled'
);

-- Carriers table
CREATE TABLE carriers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  code VARCHAR(20) UNIQUE NOT NULL, -- FDX, UPS, DHL, etc.
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  api_endpoint VARCHAR(500),
  api_credentials JSONB, -- encrypted credentials
  service_areas JSONB, -- supported regions/countries
  capabilities JSONB, -- express, standard, freight, etc.
  pricing_structure JSONB,
  performance_metrics JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Delivery addresses table
CREATE TABLE delivery_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  address_type VARCHAR(50) DEFAULT 'shipping', -- shipping, billing, warehouse
  company_name VARCHAR(200),
  contact_person VARCHAR(200),
  contact_phone VARCHAR(50),
  contact_email VARCHAR(255),
  address_line1 VARCHAR(500) NOT NULL,
  address_line2 VARCHAR(500),
  city VARCHAR(200) NOT NULL,
  state_province VARCHAR(200),
  postal_code VARCHAR(50) NOT NULL,
  country VARCHAR(100) NOT NULL DEFAULT 'India',
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  special_instructions TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Main delivery orders table (without quality_approved_items reference for now)
CREATE TABLE delivery_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(50) UNIQUE NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  delivery_address_id UUID REFERENCES delivery_addresses(id) NOT NULL,
  billing_address_id UUID REFERENCES delivery_addresses(id),
  carrier_id UUID REFERENCES carriers(id),
  status delivery_status DEFAULT 'draft',
  priority delivery_priority DEFAULT 'standard',
  
  -- Delivery scheduling
  requested_delivery_date DATE,
  estimated_delivery_date DATE,
  actual_delivery_date DATE,
  delivery_window_start TIME,
  delivery_window_end TIME,
  
  -- Package information
  total_weight_kg DECIMAL(10, 3),
  total_volume_m3 DECIMAL(10, 6),
  package_count INTEGER DEFAULT 1,
  special_handling_requirements TEXT,
  delivery_instructions TEXT,
  
  -- Costs
  delivery_cost_inr DECIMAL(12, 2) DEFAULT 0,
  insurance_cost_inr DECIMAL(10, 2) DEFAULT 0,
  handling_cost_inr DECIMAL(10, 2) DEFAULT 0,
  total_delivery_cost_inr DECIMAL(12, 2) DEFAULT 0,
  
  -- Tracking
  tracking_number VARCHAR(100),
  carrier_reference VARCHAR(100),
  pickup_date DATE,
  
  -- Metadata
  created_by VARCHAR(100),
  approved_by VARCHAR(100),
  approved_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_delivery_window CHECK (
    delivery_window_end IS NULL OR 
    delivery_window_start IS NULL OR 
    delivery_window_end > delivery_window_start
  ),
  CONSTRAINT valid_delivery_dates CHECK (
    estimated_delivery_date IS NULL OR 
    requested_delivery_date IS NULL OR 
    estimated_delivery_date >= requested_delivery_date
  )
);

-- Delivery items linking to BOM items (without quality_approved_items reference for now)
CREATE TABLE delivery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_order_id UUID REFERENCES delivery_orders(id) ON DELETE CASCADE,
  bom_item_id UUID REFERENCES bom_items(id) NOT NULL,
  
  -- Quantities
  requested_quantity INTEGER NOT NULL,
  delivery_quantity INTEGER NOT NULL,
  
  -- Physical properties
  unit_weight_kg DECIMAL(8, 3),
  unit_dimensions_cm VARCHAR(50), -- "L x W x H"
  total_weight_kg DECIMAL(10, 3),
  
  -- Packaging
  packaging_type VARCHAR(100),
  packaging_instructions TEXT,
  hazmat_classification VARCHAR(50),
  
  -- Quality references
  qc_certificate_number VARCHAR(100),
  batch_number VARCHAR(100),
  serial_numbers TEXT[], -- array for serialized items
  
  -- Costs
  unit_value_inr DECIMAL(10, 2),
  total_value_inr DECIMAL(12, 2),
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT valid_quantities CHECK (delivery_quantity <= requested_quantity AND delivery_quantity > 0)
);

-- Delivery tracking events
CREATE TABLE delivery_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_order_id UUID REFERENCES delivery_orders(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL, -- pickup, in_transit, out_for_delivery, delivered, etc.
  event_description TEXT NOT NULL,
  event_timestamp TIMESTAMP NOT NULL,
  location_name VARCHAR(200),
  location_address TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  carrier_status_code VARCHAR(50),
  internal_notes TEXT,
  proof_of_delivery JSONB, -- photos, signatures, etc.
  created_at TIMESTAMP DEFAULT NOW()
);

-- Invoice headers
CREATE TABLE delivery_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  delivery_order_id UUID REFERENCES delivery_orders(id) NOT NULL,
  project_id UUID REFERENCES projects(id) NOT NULL,
  
  -- Invoice details
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  status invoice_status DEFAULT 'draft',
  
  -- Amounts
  subtotal_inr DECIMAL(15, 2) NOT NULL DEFAULT 0,
  tax_rate DECIMAL(5, 4) DEFAULT 0.18, -- 18% GST
  tax_amount_inr DECIMAL(15, 2) DEFAULT 0,
  delivery_charges_inr DECIMAL(12, 2) DEFAULT 0,
  total_amount_inr DECIMAL(15, 2) NOT NULL DEFAULT 0,
  
  -- Payment tracking
  payment_terms VARCHAR(100) DEFAULT 'Net 30',
  payment_method VARCHAR(100),
  paid_amount_inr DECIMAL(15, 2) DEFAULT 0,
  payment_date DATE,
  payment_reference VARCHAR(200),
  
  -- Billing information
  bill_to_company VARCHAR(200) NOT NULL,
  bill_to_address TEXT NOT NULL,
  bill_to_gstin VARCHAR(50),
  
  -- References
  purchase_order_number VARCHAR(100),
  project_reference VARCHAR(200),
  
  -- Metadata
  created_by VARCHAR(100),
  approved_by VARCHAR(100),
  approved_at TIMESTAMP,
  sent_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Invoice line items
CREATE TABLE delivery_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES delivery_invoices(id) ON DELETE CASCADE,
  delivery_item_id UUID REFERENCES delivery_items(id) NOT NULL,
  
  -- Item details
  item_description TEXT NOT NULL,
  part_number VARCHAR(200),
  quantity INTEGER NOT NULL,
  unit_price_inr DECIMAL(12, 2) NOT NULL,
  line_total_inr DECIMAL(15, 2) NOT NULL,
  
  -- Tax details
  tax_rate DECIMAL(5, 4) DEFAULT 0.18,
  tax_amount_inr DECIMAL(12, 2) DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- Delivery documents (BOL, POD, Invoices, etc.)
CREATE TABLE delivery_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_order_id UUID REFERENCES delivery_orders(id) ON DELETE CASCADE,
  document_type VARCHAR(100) NOT NULL, -- BOL, POD, Invoice, Packing_List, etc.
  document_name VARCHAR(200) NOT NULL,
  file_path VARCHAR(500),
  file_size_bytes BIGINT,
  mime_type VARCHAR(100),
  uploaded_by VARCHAR(100),
  upload_timestamp TIMESTAMP DEFAULT NOW(),
  is_customer_visible BOOLEAN DEFAULT false,
  document_metadata JSONB DEFAULT '{}'
);

-- Performance analytics materialized view
CREATE MATERIALIZED VIEW delivery_performance_metrics AS
SELECT 
  DATE_TRUNC('month', dord.created_at) as month,
  COUNT(*) as total_deliveries,
  COUNT(*) FILTER (WHERE dord.status = 'delivered') as successful_deliveries,
  COUNT(*) FILTER (WHERE dord.actual_delivery_date <= dord.requested_delivery_date) as on_time_deliveries,
  AVG(dord.total_delivery_cost_inr) as avg_delivery_cost,
  AVG(CASE 
    WHEN dord.actual_delivery_date IS NOT NULL AND dord.requested_delivery_date IS NOT NULL 
    THEN EXTRACT(DAY FROM (dord.actual_delivery_date::timestamp - dord.requested_delivery_date::timestamp))
    ELSE NULL
  END) as avg_delay_days,
  dord.carrier_id,
  carriers.name as carrier_name
FROM delivery_orders dord
LEFT JOIN carriers ON dord.carrier_id = carriers.id
WHERE dord.status != 'cancelled'
GROUP BY DATE_TRUNC('month', dord.created_at), dord.carrier_id, carriers.name;

-- Indexes for performance
CREATE INDEX idx_delivery_orders_project_id ON delivery_orders(project_id);
CREATE INDEX idx_delivery_orders_status ON delivery_orders(status);
CREATE INDEX idx_delivery_orders_created_at ON delivery_orders(created_at);
CREATE INDEX idx_delivery_orders_tracking_number ON delivery_orders(tracking_number);
CREATE INDEX idx_delivery_items_delivery_order_id ON delivery_items(delivery_order_id);
CREATE INDEX idx_delivery_items_bom_item_id ON delivery_items(bom_item_id);
CREATE INDEX idx_delivery_tracking_order_id ON delivery_tracking(delivery_order_id);
CREATE INDEX idx_delivery_tracking_timestamp ON delivery_tracking(event_timestamp);
CREATE INDEX idx_delivery_invoices_project_id ON delivery_invoices(project_id);
CREATE INDEX idx_delivery_invoices_status ON delivery_invoices(status);
CREATE INDEX idx_delivery_invoices_due_date ON delivery_invoices(due_date);

-- Row Level Security (RLS)
ALTER TABLE delivery_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_addresses ENABLE ROW LEVEL SECURITY;

-- Triggers for automatic updates
CREATE OR REPLACE FUNCTION update_delivery_order_costs()
RETURNS TRIGGER AS $$
BEGIN
  -- Update total delivery cost when items change
  UPDATE delivery_orders 
  SET 
    total_delivery_cost_inr = delivery_cost_inr + insurance_cost_inr + handling_cost_inr,
    updated_at = NOW()
  WHERE id = NEW.delivery_order_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER delivery_items_cost_update
  AFTER INSERT OR UPDATE OR DELETE ON delivery_items
  FOR EACH ROW EXECUTE FUNCTION update_delivery_order_costs();

-- Function to generate delivery order numbers
CREATE OR REPLACE FUNCTION generate_delivery_order_number()
RETURNS TRIGGER AS $$
DECLARE
  new_number VARCHAR(50);
  year_suffix VARCHAR(4);
  sequence_num INTEGER;
BEGIN
  year_suffix := EXTRACT(YEAR FROM CURRENT_DATE)::VARCHAR;
  
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(order_number FROM 'DO-' || year_suffix || '-(\d+)') AS INTEGER)
  ), 0) + 1 INTO sequence_num
  FROM delivery_orders 
  WHERE order_number LIKE 'DO-' || year_suffix || '-%';
  
  new_number := 'DO-' || year_suffix || '-' || LPAD(sequence_num::VARCHAR, 4, '0');
  NEW.order_number := new_number;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER delivery_order_number_trigger
  BEFORE INSERT ON delivery_orders
  FOR EACH ROW 
  WHEN (NEW.order_number IS NULL)
  EXECUTE FUNCTION generate_delivery_order_number();

-- Function to generate invoice numbers
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
DECLARE
  new_number VARCHAR(50);
  year_suffix VARCHAR(4);
  sequence_num INTEGER;
BEGIN
  year_suffix := EXTRACT(YEAR FROM CURRENT_DATE)::VARCHAR;
  
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(invoice_number FROM 'INV-' || year_suffix || '-(\d+)') AS INTEGER)
  ), 0) + 1 INTO sequence_num
  FROM delivery_invoices 
  WHERE invoice_number LIKE 'INV-' || year_suffix || '-%';
  
  new_number := 'INV-' || year_suffix || '-' || LPAD(sequence_num::VARCHAR, 5, '0');
  NEW.invoice_number := new_number;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_number_trigger
  BEFORE INSERT ON delivery_invoices
  FOR EACH ROW 
  WHEN (NEW.invoice_number IS NULL)
  EXECUTE FUNCTION generate_invoice_number();

-- Insert default carriers
INSERT INTO carriers (name, code, contact_email, active) VALUES
('FedEx India', 'FDX', 'support@fedex.com', true),
('UPS India', 'UPS', 'support@ups.com', true),  
('DHL India', 'DHL', 'support@dhl.com', true),
('Blue Dart', 'BLU', 'support@bluedart.com', true),
('Ecom Express', 'ECM', 'support@ecomexpress.in', true);

-- Refresh materialized view function
CREATE OR REPLACE FUNCTION refresh_delivery_metrics()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW delivery_performance_metrics;
END;
$$ LANGUAGE plpgsql;