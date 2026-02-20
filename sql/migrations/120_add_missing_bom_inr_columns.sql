  -- Add missing INR cost columns to boms table
  ALTER TABLE boms
  ADD COLUMN IF NOT EXISTS total_material_cost_inr DECIMAL(20,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_process_cost_inr DECIMAL(20,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_packaging_cost_inr DECIMAL(20,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_labor_cost_inr DECIMAL(20,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_overhead_cost_inr DECIMAL(20,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_logistics_cost_inr DECIMAL(20,4) DEFAULT 0;

  -- Add indexes for performance
  CREATE INDEX IF NOT EXISTS idx_boms_total_material_cost_inr ON
  boms(total_material_cost_inr) WHERE total_material_cost_inr > 0;
  CREATE INDEX IF NOT EXISTS idx_boms_total_process_cost_inr ON
  boms(total_process_cost_inr) WHERE total_process_cost_inr > 0;