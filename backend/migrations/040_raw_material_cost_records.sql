-- ============================================================================
-- Migration: Raw Material Cost Records
-- Purpose: Store raw material costs per BOM item
-- Author: Principal Engineering Team
-- Date: 2026-01-19
-- Version: 1.0.0
-- ============================================================================

-- Drop table if exists (for clean reinstall)
DROP TABLE IF EXISTS raw_material_cost_records CASCADE;

-- Create raw_material_cost_records table
CREATE TABLE raw_material_cost_records (
    -- Primary identifiers
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_item_id UUID NOT NULL REFERENCES bom_items(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Material identification
    material_category_id VARCHAR(50),
    material_type_id VARCHAR(50),
    material_id VARCHAR(50),
    material_name VARCHAR(255),
    material_category VARCHAR(255),
    material_type VARCHAR(255),
    material_group VARCHAR(255),
    material_grade VARCHAR(255),
    location VARCHAR(255),
    quarter VARCHAR(10),

    -- Cost information
    material_cost_id VARCHAR(50),
    cost_name VARCHAR(255),
    unit_cost DECIMAL(15, 4) NOT NULL DEFAULT 0,
    reclaim_rate DECIMAL(15, 4) DEFAULT 0,
    uom VARCHAR(20) DEFAULT 'KG',

    -- Usage parameters
    gross_usage DECIMAL(15, 4) NOT NULL DEFAULT 0,
    net_usage DECIMAL(15, 4) NOT NULL DEFAULT 0,
    scrap DECIMAL(5, 2) DEFAULT 0,
    overhead DECIMAL(5, 2) DEFAULT 0,

    -- Calculated results (stored for quick retrieval)
    total_cost DECIMAL(15, 4) DEFAULT 0,
    gross_material_cost DECIMAL(15, 4) DEFAULT 0,
    reclaim_value DECIMAL(15, 4) DEFAULT 0,
    net_material_cost DECIMAL(15, 4) DEFAULT 0,
    scrap_adjustment DECIMAL(15, 4) DEFAULT 0,
    overhead_cost DECIMAL(15, 4) DEFAULT 0,
    total_cost_per_unit DECIMAL(15, 4) DEFAULT 0,
    effective_cost_per_unit DECIMAL(15, 4) DEFAULT 0,
    material_utilization_rate DECIMAL(15, 4) DEFAULT 0,
    scrap_rate DECIMAL(15, 4) DEFAULT 0,

    -- Full calculation breakdown (JSONB for detailed breakdown)
    calculation_breakdown JSONB DEFAULT '{}'::jsonb,

    -- Links to other entities
    process_route_id UUID,
    project_id UUID,

    -- Metadata
    notes TEXT,
    is_active BOOLEAN DEFAULT true,

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Constraints
    CONSTRAINT positive_unit_cost CHECK (unit_cost >= 0),
    CONSTRAINT positive_gross_usage CHECK (gross_usage >= 0),
    CONSTRAINT positive_net_usage CHECK (net_usage >= 0),
    CONSTRAINT valid_scrap CHECK (scrap >= 0 AND scrap <= 100),
    CONSTRAINT valid_overhead CHECK (overhead >= 0 AND overhead <= 500),
    CONSTRAINT positive_total_cost CHECK (total_cost >= 0)
);

-- Indexes for performance
CREATE INDEX idx_raw_material_cost_bom_item ON raw_material_cost_records(bom_item_id);
CREATE INDEX idx_raw_material_cost_user ON raw_material_cost_records(user_id);
CREATE INDEX idx_raw_material_cost_material ON raw_material_cost_records(material_id);
CREATE INDEX idx_raw_material_cost_active ON raw_material_cost_records(is_active) WHERE is_active = true;
CREATE INDEX idx_raw_material_cost_created ON raw_material_cost_records(created_at DESC);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_raw_material_cost_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists (for idempotency)
DROP TRIGGER IF EXISTS trigger_raw_material_cost_timestamp ON raw_material_cost_records;

CREATE TRIGGER trigger_raw_material_cost_timestamp
    BEFORE UPDATE ON raw_material_cost_records
    FOR EACH ROW
    EXECUTE FUNCTION update_raw_material_cost_timestamp();

-- Note: Cost calculations are performed by the application layer (RawMaterialCostCalculationEngine)
-- before inserting/updating records. No database triggers needed for calculations.

-- Enable Row Level Security (RLS)
ALTER TABLE raw_material_cost_records ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view own raw material costs" ON raw_material_cost_records;
DROP POLICY IF EXISTS "Users can insert own raw material costs" ON raw_material_cost_records;
DROP POLICY IF EXISTS "Users can update own raw material costs" ON raw_material_cost_records;
DROP POLICY IF EXISTS "Users can delete own raw material costs" ON raw_material_cost_records;

-- RLS Policies
CREATE POLICY "Users can view own raw material costs"
    ON raw_material_cost_records FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own raw material costs"
    ON raw_material_cost_records FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own raw material costs"
    ON raw_material_cost_records FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own raw material costs"
    ON raw_material_cost_records FOR DELETE
    USING (auth.uid() = user_id);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON raw_material_cost_records TO authenticated;

-- Add comments for documentation
COMMENT ON TABLE raw_material_cost_records IS 'Stores raw material cost records per BOM item with calculated costs';
COMMENT ON COLUMN raw_material_cost_records.material_id IS 'Material ID from LHR database';
COMMENT ON COLUMN raw_material_cost_records.gross_usage IS 'Total material required including scrap';
COMMENT ON COLUMN raw_material_cost_records.net_usage IS 'Actual material in finished part';
COMMENT ON COLUMN raw_material_cost_records.scrap IS 'Additional scrap/waste percentage (0-100)';
COMMENT ON COLUMN raw_material_cost_records.overhead IS 'Material overhead percentage (0-500)';
COMMENT ON COLUMN raw_material_cost_records.reclaim_rate IS 'Recovery value for scrap material (INR/unit)';
COMMENT ON COLUMN raw_material_cost_records.calculation_breakdown IS 'Complete calculation breakdown with all intermediate values';
