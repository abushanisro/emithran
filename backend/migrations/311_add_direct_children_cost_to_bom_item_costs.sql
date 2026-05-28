-- Migration 311: Add direct_children_cost column to bom_item_costs
-- This column tracks the sum of immediate children costs for cost rollup.

ALTER TABLE bom_item_costs
ADD COLUMN IF NOT EXISTS direct_children_cost DECIMAL(15, 4) DEFAULT 0;
