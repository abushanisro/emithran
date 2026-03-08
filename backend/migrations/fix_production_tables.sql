-- Fix Production Planning Tables for BOM Part-wise Data
-- Run this SQL to restore missing tables and relationships

-- 1. Create production_lot_bom_items table if it doesn't exist
CREATE TABLE IF NOT EXISTS production_lot_bom_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    production_lot_id UUID NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
    bom_item_id UUID NOT NULL REFERENCES bom_items(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure no duplicate combinations
    UNIQUE(production_lot_id, bom_item_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_production_lot_bom_items_lot_id ON production_lot_bom_items(production_lot_id);
CREATE INDEX IF NOT EXISTS idx_production_lot_bom_items_bom_item_id ON production_lot_bom_items(bom_item_id);

-- 2. Create subtask_bom_requirements table if it doesn't exist
CREATE TABLE IF NOT EXISTS subtask_bom_requirements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subtask_id UUID NOT NULL REFERENCES process_subtasks(id) ON DELETE CASCADE,
    bom_item_id UUID NOT NULL REFERENCES bom_items(id) ON DELETE CASCADE,
    required_quantity DECIMAL(12, 3) NOT NULL CHECK (required_quantity > 0),
    unit VARCHAR(20) NOT NULL DEFAULT 'pcs',
    requirement_status VARCHAR(50) DEFAULT 'pending' CHECK (
        requirement_status IN ('pending', 'allocated', 'fulfilled', 'shortage')
    ),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for subtask BOM requirements
CREATE INDEX IF NOT EXISTS idx_subtask_bom_requirements_subtask_id ON subtask_bom_requirements(subtask_id);
CREATE INDEX IF NOT EXISTS idx_subtask_bom_requirements_bom_item_id ON subtask_bom_requirements(bom_item_id);

-- 3. Enable RLS on new tables
ALTER TABLE production_lot_bom_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE subtask_bom_requirements ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS policies for production_lot_bom_items
CREATE POLICY "Users can manage production lot BOM items for their BOMs" ON production_lot_bom_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM production_lots pl
            JOIN boms b ON pl.bom_id = b.id
            WHERE pl.id = production_lot_bom_items.production_lot_id
            AND b.user_id = auth.uid()
        )
    );

-- 5. Create RLS policies for subtask_bom_requirements
CREATE POLICY "Users can manage subtask BOM requirements for their lots" ON subtask_bom_requirements
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM process_subtasks ps
            JOIN production_processes pp ON ps.production_process_id = pp.id
            JOIN production_lots pl ON pp.production_lot_id = pl.id
            JOIN boms b ON pl.bom_id = b.id
            WHERE ps.id = subtask_bom_requirements.subtask_id
            AND b.user_id = auth.uid()
        )
    );

-- 6. Create trigger to update updated_at column for subtask_bom_requirements
CREATE TRIGGER update_subtask_bom_requirements_updated_at 
    BEFORE UPDATE ON subtask_bom_requirements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. Refresh schema cache (if supported)
NOTIFY pgrst, 'reload schema';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Successfully created production planning tables for BOM part-wise data:';
    RAISE NOTICE '- production_lot_bom_items: Links production lots to specific BOM items';
    RAISE NOTICE '- subtask_bom_requirements: Links subtasks to required BOM parts';
    RAISE NOTICE 'Your existing APIs should now work with BOM part-wise data!';
END$$;