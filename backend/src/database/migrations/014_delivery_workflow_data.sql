-- Add columns to delivery_orders table for storing complete workflow data
-- Migration: 014_delivery_workflow_data.sql

-- Add route and transport information
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS transport_mode VARCHAR(100);
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS material_type VARCHAR(100);
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS route_type VARCHAR(50); -- fastest, shortest, balanced
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS route_distance_km DECIMAL(10,2);
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS route_travel_time_minutes INTEGER;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS route_data JSONB; -- Store complete route information

-- Add cost breakdown details (based on actual user route calculation)
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS transport_cost_inr DECIMAL(10,2);
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS loading_cost_inr DECIMAL(10,2);
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS fuel_toll_cost_inr DECIMAL(10,2);
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS cost_breakdown JSONB; -- Store detailed cost breakdown

-- Add workflow documentation
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS parts_photos JSONB; -- Array of photo metadata
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS packing_photos JSONB; -- Array of photo metadata
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS documents JSONB; -- Array of document metadata
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS dock_audit JSONB; -- Dock audit checklist data
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS checked_by VARCHAR(255);
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS checked_at TIMESTAMP;

-- Add estimated delivery date that was missing
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS estimated_delivery_date TIMESTAMP;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_delivery_orders_transport_mode ON delivery_orders(transport_mode);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_material_type ON delivery_orders(material_type);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_route_distance ON delivery_orders(route_distance_km);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_checked_by ON delivery_orders(checked_by);