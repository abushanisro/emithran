-- Migration: Create tooling_cost_records table
-- Description: Tooling and fixture cost calculations with amortization and usage tracking
-- Author: Manufacturing Cost Engineering Team
-- Version: 1.0.0
-- Date: 2026-03-07

-- Create tooling_cost_records table
CREATE TABLE IF NOT EXISTS tooling_cost_records (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tooling Information
  tooling_type VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  specifications TEXT,

  -- Cost Information
  unit_cost NUMERIC(12,6) NOT NULL CHECK (unit_cost >= 0),
  quantity NUMERIC(8,2) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  currency VARCHAR(10) DEFAULT 'INR',

  -- Amortization and Usage
  amortization_parts NUMERIC(12,0) NOT NULL DEFAULT 1 CHECK (amortization_parts >= 1),
  usage_percentage NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (usage_percentage > 0 AND usage_percentage <= 100),

  -- Calculated Costs (Stored for quick retrieval)
  total_cost NUMERIC(12,6),
  total_tooling_investment NUMERIC(12,6),

  -- Supplier and Lead Time
  supplier TEXT,
  lead_time NUMERIC(8,2), -- Days

  -- Flags
  is_custom BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  notes TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Links to other entities
  bom_item_id UUID REFERENCES bom_items(id) ON DELETE CASCADE,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tooling_cost_records_user_id
  ON tooling_cost_records(user_id);

CREATE INDEX IF NOT EXISTS idx_tooling_cost_records_bom_item_id
  ON tooling_cost_records(bom_item_id);

CREATE INDEX IF NOT EXISTS idx_tooling_cost_records_tooling_type
  ON tooling_cost_records(tooling_type);

CREATE INDEX IF NOT EXISTS idx_tooling_cost_records_is_active
  ON tooling_cost_records(is_active);

CREATE INDEX IF NOT EXISTS idx_tooling_cost_records_created_at
  ON tooling_cost_records(created_at DESC);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_tooling_cost_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists (for idempotency)
DROP TRIGGER IF EXISTS trigger_tooling_cost_records_updated_at ON tooling_cost_records;

CREATE TRIGGER trigger_tooling_cost_records_updated_at
  BEFORE UPDATE ON tooling_cost_records
  FOR EACH ROW
  EXECUTE FUNCTION update_tooling_cost_records_updated_at();

-- Row Level Security (RLS)
ALTER TABLE tooling_cost_records ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view own tooling cost records" ON tooling_cost_records;
DROP POLICY IF EXISTS "Users can insert own tooling cost records" ON tooling_cost_records;
DROP POLICY IF EXISTS "Users can update own tooling cost records" ON tooling_cost_records;
DROP POLICY IF EXISTS "Users can delete own tooling cost records" ON tooling_cost_records;

-- Policy: Users can view their own tooling cost records
CREATE POLICY "Users can view own tooling cost records"
  ON tooling_cost_records
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own tooling cost records
CREATE POLICY "Users can insert own tooling cost records"
  ON tooling_cost_records
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own tooling cost records
CREATE POLICY "Users can update own tooling cost records"
  ON tooling_cost_records
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own tooling cost records
CREATE POLICY "Users can delete own tooling cost records"
  ON tooling_cost_records
  FOR DELETE
  USING (auth.uid() = user_id);

-- Add comments for documentation
COMMENT ON TABLE tooling_cost_records IS 'Tooling and fixture cost calculations with amortization and usage tracking';
COMMENT ON COLUMN tooling_cost_records.tooling_type IS 'Type of tooling (cutting_tool, fixture, jig, etc.)';
COMMENT ON COLUMN tooling_cost_records.description IS 'Description of the tooling item';
COMMENT ON COLUMN tooling_cost_records.specifications IS 'Technical specifications of the tooling';
COMMENT ON COLUMN tooling_cost_records.unit_cost IS 'Cost per unit of tooling (currency)';
COMMENT ON COLUMN tooling_cost_records.quantity IS 'Quantity of tooling required';
COMMENT ON COLUMN tooling_cost_records.amortization_parts IS 'Number of parts over which to amortize the tooling cost';
COMMENT ON COLUMN tooling_cost_records.usage_percentage IS 'Percentage of tooling capacity used for this part (0-100)';
COMMENT ON COLUMN tooling_cost_records.total_cost IS 'Total amortized cost per part';
COMMENT ON COLUMN tooling_cost_records.total_tooling_investment IS 'Total tooling investment (unit_cost * quantity)';
COMMENT ON COLUMN tooling_cost_records.supplier IS 'Tooling supplier information';
COMMENT ON COLUMN tooling_cost_records.lead_time IS 'Lead time for tooling acquisition (days)';
COMMENT ON COLUMN tooling_cost_records.is_custom IS 'Whether this is custom tooling';